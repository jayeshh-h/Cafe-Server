import datetime
from app.utils.helpers import utc_now
from decimal import Decimal
from typing import Optional, List, Dict, Any
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException, status
from app.core.config import settings
from app.models.reservation import Reservation, ReservationCapacityRule
from app.models.customer import Customer
from app.models.table import Table, DiningSession
from app.models.bank_transaction import VerifiedBankCredit
import hmac
import hashlib
import uuid
from app.schemas.reservation import (
    ReservationCreate,
    ReservationUpdate,
    ReservationStatusUpdate,
    ReservationHoldRequest,
    ReservationHoldResponse,
    ReservationVerifyUpiRequest,
    RazorpayCreateOrderRequest,
    RazorpayCreateOrderResponse,
    RazorpayVerifyPaymentRequest,
)
from app.services.payment_verification_service import PaymentVerificationService
from app.services.settings_service import SettingsService
from app.workers.celery_app import celery_app, send_reservation_reminder
from app.services.whatsapp_service import notify_booking_cancelled, notify_booking_confirmed

# Strict Allowed State Machine Map
ALLOWED_STATE_TRANSITIONS = {
    "HOLD": {"PAYMENT_PENDING", "CONFIRMED", "CANCELLED", "EXPIRED"},
    "PAYMENT_PENDING": {"CONFIRMED", "CANCELLED", "EXPIRED"},
    "PENDING": {"CONFIRMED", "CANCELLED", "EXPIRED"},
    "CONFIRMED": {"ARRIVED", "CANCELLED", "NO_SHOW"},
    "ARRIVED": {"SEATED", "CANCELLED"},
    "SEATED": {"COMPLETED"},
    "COMPLETED": set(),
    "CANCELLED": set(),
    "EXPIRED": set(),
    "NO_SHOW": set(),
}


RAZORPAY_API = "https://api.razorpay.com/v1"
# Repo default placeholders: never valid for real payments
_PLACEHOLDER_RAZORPAY_KEYS = {"rzp_test_JaadooCafe10", "jaadoo_secret_test_2026", ""}


def validate_booking_request(reservation_date, time_slot: str, phone: str) -> None:
    """Reject bookings no real guest could make: past dates, closed days, bad times, bad phones."""
    if not settings.BOOKING_RULES_ENFORCED:
        return
    from app.utils.helpers import ist_now, parse_time_slot_to_datetime

    now = ist_now()
    if reservation_date < now.date():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="INVALID_DATE: Bookings can't be made for a past date.")
    closed = {int(d) for d in settings.RESERVATION_CLOSED_WEEKDAYS.split(",") if d.strip().isdigit()}
    if reservation_date.weekday() in closed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CLOSED_DAY: The cafe is closed on this day.")

    slot_dt = parse_time_slot_to_datetime(reservation_date, time_slot or "")
    if not slot_dt:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="INVALID_TIME: Choose a valid time slot.")
    open_t = datetime.datetime.strptime(settings.RESERVATION_OPEN_TIME, "%H:%M").time()
    last_t = datetime.datetime.strptime(settings.RESERVATION_LAST_SLOT_TIME, "%H:%M").time()
    if not open_t <= slot_dt.time() <= last_t:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="INVALID_TIME: That time is outside booking hours.")
    if slot_dt <= now:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="INVALID_TIME: That time slot has already passed.")

    raw = (phone or "").strip()
    digits = "".join(ch for ch in raw if ch.isdigit())
    # ponytail: handle international numbers with country code prefix while maintaining Indian mobile rules
    is_explicit_intl = raw.startswith("+") and not raw.startswith("+91")
    if not is_explicit_intl:
        if len(digits) == 12 and digits.startswith("91"):
            digits = digits[2:]
        elif len(digits) == 11 and digits.startswith("0"):
            digits = digits[1:]
        if len(digits) != 10 or digits[0] not in "6789":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="INVALID_PHONE: Enter a valid 10-digit Indian mobile number.")
    else:
        if not (7 <= len(digits) <= 15) or len(set(digits)) == 1:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="INVALID_PHONE: Enter a valid international phone number.")



def test_payments_allowed() -> bool:
    return settings.APP_ENV == "development" or settings.ALLOW_TEST_PAYMENTS


def razorpay_configured() -> bool:
    return (settings.RAZORPAY_KEY_ID or "") not in _PLACEHOLDER_RAZORPAY_KEYS and (
        settings.RAZORPAY_KEY_SECRET or ""
    ) not in _PLACEHOLDER_RAZORPAY_KEYS


class ReservationService:
    @staticmethod
    def get_seven_day_cutoff() -> datetime.date:
        """
        Calculates the 7-day cutoff date in Asia/Kolkata timezone.
        Recent reservations are within the previous 7 calendar days including current business date.
        Example: If today is Oct 10, cutoff is Oct 4 (covers Oct 4 through Oct 10, inclusive).
        """
        from app.utils.helpers import ist_now
        return ist_now().date() - datetime.timedelta(days=6)

    @staticmethod
    def format_canonical_booking_id(reservation: Reservation) -> str:
        """Booking ID shown everywhere; see Reservation.booking_id for the format."""
        return reservation.booking_id

    @staticmethod
    def sanitize_reservation_response(reservation: Reservation, cutoff_date: Optional[datetime.date] = None):
        """
        Applies client 7-day privacy & display policy:
        1. Last 7 calendar days (reservation_date >= cutoff_date): Full reservation details.
        2. Older than 7 calendar days (reservation_date < cutoff_date): Restricted strictly to:
           - Reservation/Booking ID
           - Customer name
           - Total number of guests
           (All other fields: phone, email, time_slot, notes, payment info stripped on backend).
        """
        from app.schemas.reservation import ReservationResponse, CustomerResponse
        if cutoff_date is None:
            cutoff_date = ReservationService.get_seven_day_cutoff()

        booking_id = ReservationService.format_canonical_booking_id(reservation)
        is_recent = reservation.reservation_date >= cutoff_date

        if is_recent:
            customer_resp = None
            if reservation.customer:
                customer_resp = CustomerResponse(
                    id=reservation.customer.id,
                    name=reservation.customer.name,
                    phone=reservation.customer.phone,
                    email=reservation.customer.email,
                    created_at=reservation.customer.created_at,
                )
            return ReservationResponse(
                id=reservation.id,
                booking_id=booking_id,
                branch_id=reservation.branch_id,
                customer_id=reservation.customer_id,
                guest_count=reservation.guest_count,
                reservation_date=reservation.reservation_date,
                time_slot=reservation.time_slot,
                table_id=reservation.table_id,
                floor_number=reservation.floor_number,
                table_name=reservation.table_name,
                status=reservation.status,
                payment_status=reservation.payment_status,
                advance_amount=float(reservation.advance_amount or 0),
                payment_reference=reservation.payment_reference,
                payment_method=reservation.payment_method,
                hold_expires_at=reservation.hold_expires_at,
                upi_id=reservation.upi_id,
                upi_utr=reservation.upi_utr,
                is_deposit_credited=reservation.is_deposit_credited,
                credited_bill_id=reservation.credited_bill_id,
                cancellation_refund_amount=float(reservation.cancellation_refund_amount or 0),
                cancellation_refund_status=reservation.cancellation_refund_status,
                celery_task_id=reservation.celery_task_id,
                created_at=reservation.created_at,
                customer=customer_resp,
                is_historical_limited=False,
            )
        else:
            # Historical reservation older than 7 days - STRICT RESTRICTION
            customer_resp = CustomerResponse(
                id=reservation.customer_id or 0,
                name=reservation.customer.name if reservation.customer else "Guest",
                phone="",
                email=None,
                created_at=None,
            )
            return ReservationResponse(
                id=reservation.id,
                booking_id=booking_id,
                branch_id=1,
                customer_id=reservation.customer_id,
                guest_count=reservation.guest_count,
                reservation_date=reservation.reservation_date,
                time_slot="",
                table_id=None,
                floor_number=None,
                table_name=None,
                status=reservation.status or "COMPLETED",
                payment_status=None,
                advance_amount=None,
                payment_reference=None,
                payment_method=None,
                hold_expires_at=None,
                upi_id=None,
                upi_utr=None,
                is_deposit_credited=False,
                credited_bill_id=None,
                cancellation_refund_amount=None,
                cancellation_refund_status=None,
                celery_task_id=None,
                created_at=None,
                customer=customer_resp,
                is_historical_limited=True,
            )

    @staticmethod
    async def _broadcast_reservation_event(reservation: Reservation, event_type: str = "RESERVATION_UPDATED", tenant_slug: Optional[str] = None):
        try:
            from app.api.websocket import ws_manager
            slug = tenant_slug
            if not slug and getattr(reservation, "tenant_id", None):
                tenant = reservation.__dict__.get("tenant")
                if tenant and getattr(tenant, "slug", None):
                    slug = tenant.slug
            if not slug:
                slug = "restrova-default"
            payload = {
                "event": event_type,
                "id": reservation.id,
                "status": reservation.status,
                "table_id": reservation.table_id,
                "table_name": reservation.table_name,
                "reservation_date": str(reservation.reservation_date) if reservation.reservation_date else None,
                "time_slot": reservation.time_slot,
                "guest_count": reservation.guest_count,
                "tenant_slug": slug,
            }
            await ws_manager.broadcast("pos", payload, tenant_slug=slug)
            await ws_manager.broadcast("tables", payload, tenant_slug=slug)
            await ws_manager.broadcast("admin", payload, tenant_slug=slug)
        except Exception:
            pass

    @staticmethod
    async def check_capacity(
        db: AsyncSession, branch_id: int, reservation_date: datetime.date, time_slot: str, new_guests: int, tenant_id: Optional[uuid.UUID] = None
    ) -> bool:
        # Fetch capacity rule for branch & time_slot with pessimistic row locking
        rule_query = (
            select(ReservationCapacityRule)
            .where(
                ReservationCapacityRule.branch_id == branch_id,
                ReservationCapacityRule.time_slot == time_slot,
                ReservationCapacityRule.is_active == True,
            )
        )
        if tenant_id:
            rule_query = rule_query.where(ReservationCapacityRule.tenant_id == tenant_id)
        rule_query = rule_query.with_for_update()
        rule_result = await db.execute(rule_query)
        rule = rule_result.scalar_one_or_none()

        max_capacity = rule.max_guest_capacity if rule else 80

        now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)

        # Calculate booked count considering only active statuses
        # Exclude expired holds and cancelled/completed/no-show reservations
        booked_query = select(Reservation).where(
            Reservation.branch_id == branch_id,
            Reservation.reservation_date == reservation_date,
            Reservation.time_slot == time_slot,
            Reservation.status.in_(["HOLD", "PAYMENT_PENDING", "PENDING", "CONFIRMED", "ARRIVED", "SEATED"]),
        )
        if tenant_id:
            booked_query = booked_query.where(Reservation.tenant_id == tenant_id)
        booked_result = await db.execute(booked_query)
        active_reservations = booked_result.scalars().all()

        current_booked = 0
        for r in active_reservations:
            if r.status in ["HOLD", "PAYMENT_PENDING"] and r.hold_expires_at and r.hold_expires_at <= now:
                continue
            current_booked += r.guest_count

        if current_booked + new_guests > max_capacity:
            return False
        return True

    @staticmethod
    async def create_reservation(db: AsyncSession, data: ReservationCreate, tenant_id: Optional[uuid.UUID] = None) -> Reservation:
        t_id = tenant_id or uuid.UUID("23395d5e-16e5-4eb6-9214-cc63f05c3210")
        validate_booking_request(data.reservation_date, data.time_slot, data.customer_phone)
        # Check capacity
        has_capacity = await ReservationService.check_capacity(
            db, data.branch_id, data.reservation_date, data.time_slot, data.guest_count, tenant_id=t_id
        )
        if not has_capacity:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="RESERVATION_CAPACITY_EXCEEDED: Requested time slot is fully booked.",
            )

        # Get or create customer by phone and tenant_id
        cust_query = select(Customer).where(Customer.phone == data.customer_phone, Customer.tenant_id == t_id)
        cust_result = await db.execute(cust_query)
        customer = cust_result.scalar_one_or_none()

        if not customer:
            customer = Customer(
                tenant_id=t_id,
                name=data.customer_name,
                phone=data.customer_phone,
                email=data.customer_email,
            )
            db.add(customer)
            await db.flush()

        # Validate optional table_id
        valid_table_id = data.table_id
        if valid_table_id is not None:
            tbl_check = await db.execute(select(Table.id).where(Table.id == valid_table_id))
            if not tbl_check.scalar_one_or_none():
                valid_table_id = None
        if valid_table_id is None and data.table_name:
            floor_table_ids = {
                1: [1, 2, 3],
                2: [4, 5, 6],
                3: [7, 8],
                4: [9, 10],
                5: [11, 12, 13],
            }
            tbl_stmt = select(Table.id).where(Table.table_number == data.table_name)
            if data.floor_number and data.floor_number in floor_table_ids:
                tbl_stmt = tbl_stmt.where(Table.id.in_(floor_table_ids[data.floor_number]))
            tbl_match = await db.execute(tbl_stmt)
            valid_table_id = tbl_match.scalars().first()

        if valid_table_id is None:
            floor_table_ids = {
                1: [1, 2, 3],
                2: [4, 5, 6],
                3: [7, 8],
                4: [9, 10],
                5: [11, 12, 13],
            }
            target_fl = data.floor_number or 1
            if target_fl in floor_table_ids:
                valid_table_id = floor_table_ids[target_fl][0]

        # Backend independently calculates the exact deposit from guest count
        deposit_per_guest = await SettingsService.get_deposit_per_guest(db, tenant_id=t_id)
        exact_deposit = Decimal(str(data.guest_count)) * deposit_per_guest

        reservation = Reservation(
            tenant_id=t_id,
            branch_id=data.branch_id,
            customer_id=customer.id,
            guest_count=data.guest_count,
            reservation_date=data.reservation_date,
            time_slot=data.time_slot,
            table_id=valid_table_id,
            floor_number=data.floor_number or 1,
            table_name=data.table_name or "Table 1",
            status="CONFIRMED",
            payment_status=data.payment_status or "PAID",
            advance_amount=exact_deposit,
            payment_reference=data.payment_reference,
            payment_method=data.payment_method or "UPI",
        )
        db.add(reservation)
        await db.flush()

        # Create protected dough allocation for this confirmed reservation
        from app.services.capacity_service import CapacityService
        await CapacityService.create_reservation_dough_allocation(
            db=db,
            reservation_id=reservation.id,
            branch_id=reservation.branch_id,
            reservation_date=reservation.reservation_date,
            guest_count=reservation.guest_count,
            expected_pizza_count=reservation.expected_pizza_count,
        )

        # Schedule Celery booking reminder task
        try:
            task_result = send_reservation_reminder.apply_async(
                args=[reservation.id],
                countdown=3600,
            )
            reservation.celery_task_id = getattr(task_result, "id", None)
        except Exception:
            reservation.celery_task_id = None

        await db.commit()

        from sqlalchemy.orm import selectinload
        res = await db.execute(
            select(Reservation).options(selectinload(Reservation.customer)).where(Reservation.id == reservation.id)
        )
        saved = res.scalar_one()
        await ReservationService._broadcast_reservation_event(saved, "RESERVATION_CREATED")
        return saved

    @staticmethod
    async def update_reservation_status(
        db: AsyncSession, reservation_id: int, new_status: str, tenant_id: Optional[uuid.UUID] = None
    ) -> Reservation:
        reservation = await db.get(Reservation, reservation_id)
        if not reservation or (tenant_id and reservation.tenant_id != tenant_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reservation not found")

        current_status = reservation.status
        allowed = ALLOWED_STATE_TRANSITIONS.get(current_status, set())

        if new_status not in allowed:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"INVALID_STATUS_TRANSITION: Cannot transition reservation status from '{current_status}' to '{new_status}'.",
            )

        reservation.status = new_status

        # Release dough allocation for terminal statuses
        if new_status in ["CANCELLED", "NO_SHOW", "EXPIRED", "COMPLETED"]:
            from app.services.capacity_service import CapacityService
            await CapacityService.release_reservation_dough_allocation(
                db=db, reservation_id=reservation_id
            )

        # If cancelled or no-show, revoke Celery reminder task if present
        if new_status in ["CANCELLED", "NO_SHOW"] and reservation.celery_task_id:
            try:
                celery_app.control.revoke(reservation.celery_task_id, terminate=True)
            except Exception:
                pass
            reservation.celery_task_id = None

        await db.commit()

        from sqlalchemy.orm import selectinload
        res = await db.execute(
            select(Reservation).options(selectinload(Reservation.customer)).where(Reservation.id == reservation.id)
        )
        saved = res.scalar_one()
        await ReservationService._broadcast_reservation_event(saved, "RESERVATION_UPDATED")
        return saved

    @staticmethod
    async def update_reservation(
        db: AsyncSession, reservation_id: int, data: ReservationUpdate, tenant_id: Optional[uuid.UUID] = None
    ) -> Reservation:
        reservation = await db.get(Reservation, reservation_id)
        if not reservation or (tenant_id and reservation.tenant_id != tenant_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reservation not found")

        # If date, time slot, or guest count changes, re-check capacity
        new_date = data.reservation_date or reservation.reservation_date
        new_slot = data.time_slot or reservation.time_slot
        new_guests = data.guest_count or reservation.guest_count

        if new_date != reservation.reservation_date or new_slot != reservation.time_slot or new_guests != reservation.guest_count:
            rule_query = (
                select(ReservationCapacityRule)
                .where(
                    ReservationCapacityRule.branch_id == reservation.branch_id,
                    ReservationCapacityRule.time_slot == new_slot,
                    ReservationCapacityRule.is_active == True,
                )
            )
            if reservation.tenant_id:
                rule_query = rule_query.where(ReservationCapacityRule.tenant_id == reservation.tenant_id)
            rule_query = rule_query.with_for_update()
            rule_res = await db.execute(rule_query)
            rule = rule_res.scalar_one_or_none()
            max_capacity = rule.max_guest_capacity if rule else 80

            booked_query = select(func.coalesce(func.sum(Reservation.guest_count), 0)).where(
                Reservation.branch_id == reservation.branch_id,
                Reservation.reservation_date == new_date,
                Reservation.time_slot == new_slot,
                Reservation.status.in_(["HOLD", "PAYMENT_PENDING", "PENDING", "CONFIRMED", "ARRIVED", "SEATED"]),
                Reservation.id != reservation_id,
            )
            if reservation.tenant_id:
                booked_query = booked_query.where(Reservation.tenant_id == reservation.tenant_id)
            booked_res = await db.execute(booked_query)
            current_booked = booked_res.scalar() or 0

            if current_booked + new_guests > max_capacity:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="RESERVATION_CAPACITY_EXCEEDED: Rescheduled time slot is fully booked.",
                )

            # Update deposit if guest count changed
            deposit_per_guest = await SettingsService.get_deposit_per_guest(db, tenant_id=reservation.tenant_id)
            reservation.advance_amount = Decimal(str(new_guests)) * deposit_per_guest

            if reservation.celery_task_id:
                try:
                    celery_app.control.revoke(reservation.celery_task_id, terminate=True)
                except Exception:
                    pass
                reservation.celery_task_id = None

            reservation.reservation_date = new_date
            reservation.time_slot = new_slot
            reservation.guest_count = new_guests

            try:
                task_res = send_reservation_reminder.apply_async(args=[reservation.id], countdown=3600)
                reservation.celery_task_id = getattr(task_res, "id", None)
            except Exception:
                pass

        if data.status:
            return await ReservationService.update_reservation_status(db, reservation_id, data.status, tenant_id=reservation.tenant_id)

        await db.commit()
        from sqlalchemy.orm import selectinload
        res = await db.execute(
            select(Reservation).options(selectinload(Reservation.customer)).where(Reservation.id == reservation_id)
        )
        return res.scalar_one()

    @staticmethod
    async def cancel_reservation(db: AsyncSession, reservation_id: int, tenant_id: Optional[uuid.UUID] = None) -> Reservation:
        reservation = await db.get(Reservation, reservation_id)
        if not reservation or (tenant_id and reservation.tenant_id != tenant_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reservation not found")

        if reservation.status == "CANCELLED":
            from sqlalchemy.orm import selectinload
            res = await db.execute(
                select(Reservation).options(selectinload(Reservation.customer)).where(Reservation.id == reservation.id)
            )
            return res.scalar_one()
        if "CANCELLED" not in ALLOWED_STATE_TRANSITIONS.get(reservation.status, set()):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"INVALID_STATUS_TRANSITION: A reservation that is '{reservation.status}' cannot be cancelled.",
            )

        # Apply configurable cancellation policy
        cancellation_policy = await SettingsService.get_cancellation_policy(db, tenant_id=reservation.tenant_id)
        policy_type = cancellation_policy["policy"]
        cutoff_hours = cancellation_policy["cutoff_hours"]
        refund_pct = cancellation_policy["refund_percentage"]

        advance = Decimal(str(reservation.advance_amount or "0.00"))
        cancellation_charge = Decimal("54.00")
        refund_amount = Decimal("0.00")

        if reservation.payment_status == "PAID" and advance > Decimal("0.00"):
            if policy_type == "FULL_REFUND":
                refund_amount = max(Decimal("0.00"), advance - cancellation_charge)
            elif policy_type == "REFUND_BEFORE_CUTOFF":
                from app.utils.helpers import calculate_reservation_window
                win = calculate_reservation_window(reservation.reservation_date, reservation.time_slot)
                # diff_minutes is IST-aware and only present when the time slot parses; unparseable => no refund
                diff_minutes = win.get("diff_minutes")
                hours_until = diff_minutes / 60.0 if diff_minutes is not None else 0.0

                if hours_until >= cutoff_hours:
                    refund_amount = max(Decimal("0.00"), (advance * (refund_pct / Decimal("100"))).quantize(Decimal("0.01")) - cancellation_charge)
                else:
                    refund_amount = Decimal("0.00")
            else:  # NO_REFUND
                refund_amount = Decimal("0.00")

        reservation.cancellation_refund_amount = refund_amount
        reservation.cancellation_refund_status = "REFUND_PENDING" if refund_amount > Decimal("0.00") else "NO_REFUND"
        reservation.status = "CANCELLED"
        reservation.payment_status = "REFUNDED" if refund_amount > Decimal("0.00") else "CANCELLED"

        # Release unused protected dough allocation on cancellation
        from app.services.capacity_service import CapacityService
        await CapacityService.release_reservation_dough_allocation(
            db=db, reservation_id=reservation_id
        )

        if reservation.celery_task_id:
            try:
                celery_app.control.revoke(reservation.celery_task_id, terminate=True)
            except Exception:
                pass
            reservation.celery_task_id = None

        await db.commit()
        notify_booking_cancelled(reservation_id)

        from sqlalchemy.orm import selectinload
        res = await db.execute(
            select(Reservation).options(selectinload(Reservation.customer)).where(Reservation.id == reservation.id)
        )
        return res.scalar_one()

    @staticmethod
    async def assign_table(
        db: AsyncSession,
        reservation_id: int,
        table_id: int,
        table_name: Optional[str] = None,
        floor_number: Optional[int] = None,
        tenant_id: Optional[uuid.UUID] = None,
    ) -> Reservation:
        """
        Allows café host/cashier to assign a physical table to a confirmed reservation.
        """
        reservation = await db.get(Reservation, reservation_id)
        if not reservation or (tenant_id and reservation.tenant_id != tenant_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reservation not found")

        table = await db.get(Table, table_id)
        if not table or (reservation.tenant_id and getattr(table, "tenant_id", None) and table.tenant_id != reservation.tenant_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Table #{table_id} not found.")

        reservation.table_id = table.id
        reservation.table_name = table_name or table.table_number
        reservation.floor_number = floor_number or getattr(table, "floor_number", 1)
        table.status = "Occupied"

        # Sync active dining session if one exists for this reservation
        from app.models.table import DiningSession
        sess_stmt = (
            select(DiningSession)
            .where(
                DiningSession.reservation_id == reservation.id,
                DiningSession.status.in_(["OPENED", "ACTIVE", "CHECKOUT"]),
            )
        )
        sess_res = await db.execute(sess_stmt)
        active_sess = sess_res.scalar_one_or_none()
        if active_sess:
            active_sess.table_id = table.id

        await db.commit()

        from sqlalchemy.orm import selectinload
        res = await db.execute(
            select(Reservation).options(selectinload(Reservation.customer)).where(Reservation.id == reservation.id)
        )
        saved = res.scalar_one()
        await ReservationService._broadcast_reservation_event(saved, "RESERVATION_UPDATED")
        return saved

    @staticmethod
    async def checkin_reservation(
        db: AsyncSession,
        reservation_id: int,
        session_token: Optional[str] = None,
        table_id: Optional[int] = None,
        tenant_id: Optional[uuid.UUID] = None,
    ) -> Reservation:
        """
        Check-In:
        Transitions reservation from CONFIRMED -> ARRIVED -> SEATED.
        Links customer and reservation deposit to active DiningSession for bill credit.
        """
        from app.services.table_service import TableService

        reservation = await db.get(Reservation, reservation_id)
        if not reservation or (tenant_id and reservation.tenant_id != tenant_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reservation not found")

        if reservation.status not in ["CONFIRMED", "ARRIVED", "SEATED"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot check in reservation with status '{reservation.status}'.",
            )

        # Assign table if table_id is specified during check-in
        target_table_id = table_id or reservation.table_id
        if target_table_id:
            reservation.table_id = target_table_id
            tbl = await db.get(Table, target_table_id)
            if tbl:
                reservation.table_name = tbl.table_number

        # Staff check-in (no QR session token) must seat the guest at a real table with a bill session
        if not session_token and not reservation.table_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="TABLE_REQUIRED: Assign a table before checking the guest in.",
            )

        # Link to DiningSession
        dining_session = None
        if session_token:
            if reservation.tenant_id:
                sess_stmt = (
                    select(DiningSession)
                    .join(Table, DiningSession.table_id == Table.id)
                    .where(
                        DiningSession.session_token == session_token,
                        Table.tenant_id == reservation.tenant_id,
                    )
                )
            else:
                sess_stmt = select(DiningSession).where(DiningSession.session_token == session_token)
            sess_res = await db.execute(sess_stmt)
            dining_session = sess_res.scalar_one_or_none()
        elif reservation.table_id:
            dining_session = await TableService.get_or_create_dining_session(db, reservation.table_id, tenant_id=reservation.tenant_id)
            # Never merge into another party's running bill
            other_reservation = dining_session.reservation_id not in (None, reservation.id)
            other_walk_in = dining_session.reservation_id is None and dining_session.status in ("ACTIVE", "CHECKOUT")
            if other_reservation or other_walk_in:
                table_label = reservation.table_name or "This table"  # read before rollback expires attributes
                await db.rollback()
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"TABLE_OCCUPIED: {table_label} still has another party's open bill. Settle it or choose a different table.",
                )

        reservation.status = "SEATED"

        if dining_session:
            dining_session.reservation_id = reservation.id
            dining_session.customer_id = reservation.customer_id
            if dining_session.status == "OPENED":
                dining_session.status = "ACTIVE"
                dining_session.opened_at = utc_now()  # clock starts when the party is seated

        await db.commit()

        from sqlalchemy.orm import selectinload
        res = await db.execute(
            select(Reservation).options(selectinload(Reservation.customer)).where(Reservation.id == reservation.id)
        )
        saved = res.scalar_one()
        await ReservationService._broadcast_reservation_event(saved, "RESERVATION_UPDATED")
        return saved

    @staticmethod
    async def auto_release_expired_no_shows(db: AsyncSession, tenant_id: Optional[uuid.UUID] = None) -> int:
        """
        Grace Period & Auto-Release (No-Show Protection):
        Finds CONFIRMED reservations where grace period has elapsed,
        transitions them to NO_SHOW, and applies configurable no-show policy.
        """
        from app.utils.helpers import calculate_reservation_window

        stmt = select(Reservation).where(Reservation.status == "CONFIRMED")
        if tenant_id:
            stmt = stmt.where(Reservation.tenant_id == tenant_id)
        res = await db.execute(stmt)
        reservations = res.scalars().all()
        released_count = 0

        from app.services.capacity_service import CapacityService
        for r in reservations:
            calc = calculate_reservation_window(r.reservation_date, r.time_slot)
            if calc.get("grace_exceeded"):
                r.status = "NO_SHOW"
                # Release unused dough protection for no-show
                await CapacityService.release_reservation_dough_allocation(
                    db=db, reservation_id=r.id
                )
                if r.celery_task_id:
                    try:
                        celery_app.control.revoke(r.celery_task_id, terminate=True)
                    except Exception:
                        pass
                    r.celery_task_id = None
                released_count += 1

        if released_count > 0:
            await db.commit()

        return released_count

    @staticmethod
    async def cleanup_expired_holds(db: AsyncSession, tenant_id: Optional[uuid.UUID] = None) -> int:
        """
        Releases any HOLD reservations whose temporary hold_expires_at timer has elapsed.
        Transitions them to EXPIRED and payment_status to EXPIRED, instantly releasing capacity.
        """
        now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
        stmt = select(Reservation).where(
            Reservation.status.in_(["HOLD", "PAYMENT_PENDING"]),
            Reservation.hold_expires_at <= now,
        )
        if tenant_id:
            stmt = stmt.where(Reservation.tenant_id == tenant_id)
        res = await db.execute(stmt)
        expired_holds = res.scalars().all()
        count = len(expired_holds)
        from app.services.capacity_service import CapacityService
        for h in expired_holds:
            h.status = "EXPIRED"
            h.payment_status = "EXPIRED"
            # Release dough allocation for expired holds (if any was ever created)
            await CapacityService.release_reservation_dough_allocation(
                db=db, reservation_id=h.id
            )
        if count > 0:
            await db.commit()
        return count

    @staticmethod
    async def hold_reservation(
        db: AsyncSession,
        data: ReservationHoldRequest,
        tenant_id: Optional[uuid.UUID] = None,
        tenant_slug: Optional[str] = None,
    ) -> ReservationHoldResponse:
        """
        Temporarily holds capacity for 7 minutes for direct 0% UPI payment.
        Backend strictly calculates ₹200/person deposit using Decimal.
        Customer-specified table is optional preference.
        """
        t_id = tenant_id or uuid.UUID("23395d5e-16e5-4eb6-9214-cc63f05c3210")
        validate_booking_request(data.reservation_date, data.time_slot, data.customer_phone)
        # 1. Clean up any expired holds first
        await ReservationService.cleanup_expired_holds(db, tenant_id=t_id)

        now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)

        # 2. Check if a specific table preference was specified and if it's already held or booked
        if data.floor_number and data.table_name:
            conflict_query = (
                select(Reservation)
                .where(
                    Reservation.tenant_id == t_id,
                    Reservation.branch_id == data.branch_id,
                    Reservation.reservation_date == data.reservation_date,
                    Reservation.time_slot == data.time_slot,
                    Reservation.floor_number == data.floor_number,
                    Reservation.table_name == data.table_name,
                    Reservation.status.in_(["HOLD", "PAYMENT_PENDING", "CONFIRMED", "ARRIVED", "SEATED"]),
                )
                .with_for_update()
            )
            conflict_res = await db.execute(conflict_query)
            conflict = conflict_res.scalar_one_or_none()

            if conflict:
                if conflict.status in ["HOLD", "PAYMENT_PENDING"] and conflict.hold_expires_at and conflict.hold_expires_at > now:
                    remaining = int((conflict.hold_expires_at - now).total_seconds())
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=f"SLOT_HELD: {data.table_name} on Floor {data.floor_number} is currently held by another guest. Hold expires in {remaining}s.",
                    )
                elif conflict.status not in ["HOLD", "PAYMENT_PENDING"]:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=f"SLOT_BOOKED: {data.table_name} on Floor {data.floor_number} is already confirmed for {data.time_slot}.",
                    )

        # 3. Check overall branch capacity
        capacity_ok = await ReservationService.check_capacity(
            db, data.branch_id, data.reservation_date, data.time_slot, data.guest_count, tenant_id=t_id
        )
        if not capacity_ok:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="CAPACITY_EXCEEDED: This time slot is fully booked across the restaurant.",
            )

        # 4. Resolve table_id preference if provided
        valid_table_id = data.table_id
        if valid_table_id is not None:
            tbl_check = await db.execute(select(Table.id).where(Table.id == valid_table_id, Table.tenant_id == t_id))
            if not tbl_check.scalar_one_or_none():
                valid_table_id = None

        if valid_table_id is None and data.table_name:
            floor_table_ids = {
                1: [1, 2, 3],
                2: [4, 5, 6],
                3: [7, 8],
                4: [9, 10],
                5: [11, 12, 13],
            }
            tbl_stmt = select(Table.id).where(Table.table_number == data.table_name, Table.tenant_id == t_id)
            if data.floor_number and data.floor_number in floor_table_ids:
                tbl_stmt = tbl_stmt.where(Table.id.in_(floor_table_ids[data.floor_number]))
            tbl_match = await db.execute(tbl_stmt)
            valid_table_id = tbl_match.scalars().first()

        # 5. Get or create Customer
        cust_query = select(Customer).where(Customer.phone == data.customer_phone, Customer.tenant_id == t_id)
        cust_result = await db.execute(cust_query)
        customer = cust_result.scalar_one_or_none()
        if not customer:
            customer = Customer(
                tenant_id=t_id,
                name=data.customer_name,
                phone=data.customer_phone,
                email=data.customer_email,
            )
            db.add(customer)
            await db.flush()

        # 6. Backend independently calculates deposit: guest_count × ₹200.00
        deposit_per_guest = await SettingsService.get_deposit_per_guest(db, tenant_id=t_id)
        advance_amount = Decimal(str(data.guest_count)) * deposit_per_guest

        # 7. Set 7-minute hold expiration
        hold_duration_seconds = settings.RESERVATION_HOLD_MINUTES * 60
        hold_expires_at = now + datetime.timedelta(seconds=hold_duration_seconds)
        upi_merchant_id = settings.MERCHANT_UPI_ID
        merchant_encoded = settings.MERCHANT_NAME.replace(" ", "%20")

        reservation = Reservation(
            tenant_id=t_id,
            branch_id=data.branch_id,
            customer_id=customer.id,
            guest_count=data.guest_count,
            reservation_date=data.reservation_date,
            time_slot=data.time_slot,
            table_id=valid_table_id,
            floor_number=data.floor_number,
            table_name=data.table_name,
            status="HOLD",
            payment_status="PENDING",
            advance_amount=advance_amount,
            payment_method="UPI",
            upi_id=upi_merchant_id,
            hold_expires_at=hold_expires_at,
        )
        db.add(reservation)
        await db.commit()
        await db.refresh(reservation)

        # Standard NPCI UPI URI Scheme (works in GPay, PhonePe, Paytm, BHIM)
        upi_uri = f"upi://pay?pa={upi_merchant_id}&pn={merchant_encoded}&am={advance_amount:.2f}&cu=INR&tn=TableRes_{reservation.id}"

        return ReservationHoldResponse(
            reservation_id=reservation.id,
            hold_expires_at=hold_expires_at,
            seconds_remaining=hold_duration_seconds,
            advance_amount=float(advance_amount),
            guest_count=data.guest_count,
            deposit_per_guest=float(deposit_per_guest),
            upi_id=upi_merchant_id,
            upi_uri=upi_uri,
            qr_code_content=upi_uri,
            status="HOLD",
            floor_number=data.floor_number,
            table_name=data.table_name,
            reservation_date=data.reservation_date,
            time_slot=data.time_slot,
        )

    @staticmethod
    async def verify_upi_payment(
        db: AsyncSession, reservation_id: int, data: ReservationVerifyUpiRequest, tenant_id: Optional[uuid.UUID] = None
    ) -> Reservation:
        """
        Customer enters UPI transaction reference / UTR.
        VULNERABILITY FIX: Customer-entered UTR NEVER self-confirms reservations.
        Confirmation strictly requires independent bank/acquirer settlement verification.
        UTR is recorded as customer reconciliation reference while status is transitioned
        to PAYMENT_PENDING until verified bank credit arrives or hold elapses.
        """
        from sqlalchemy.orm import selectinload

        # 1. Clean up expired holds
        await ReservationService.cleanup_expired_holds(db, tenant_id=tenant_id)

        # 2. Acquire atomic row-level lock on reservation
        stmt = (
            select(Reservation)
            .options(selectinload(Reservation.customer))
            .where(Reservation.id == reservation_id)
        )
        if tenant_id:
            stmt = stmt.where(Reservation.tenant_id == tenant_id)
        stmt = stmt.with_for_update()
        res = await db.execute(stmt)
        reservation = res.scalar_one_or_none()

        if not reservation:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reservation not found")

        # Idempotent return if already confirmed
        if reservation.status == "CONFIRMED":
            return reservation

        now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
        if reservation.status == "EXPIRED" or (
            reservation.status in ["HOLD", "PAYMENT_PENDING"]
            and reservation.hold_expires_at
            and reservation.hold_expires_at <= now
        ):
            reservation.status = "EXPIRED"
            reservation.payment_status = "EXPIRED"
            await db.commit()
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="HOLD_EXPIRED: Temporary hold elapsed before payment was verified. The table slot has been released.",
            )

        if reservation.status not in ["HOLD", "PAYMENT_PENDING", "PENDING"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot confirm reservation in status '{reservation.status}'.",
            )

        clean_utr = data.upi_utr.strip().replace(" ", "").replace("-", "")
        if len(clean_utr) < 4:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="INVALID_UTR: Please enter a valid UPI reference number / 12-digit UTR.",
            )

        # 3. Check if UTR has already been confirmed/used by another reservation (prevent replay attacks)
        existing_utr_stmt = select(Reservation).where(
            Reservation.id != reservation.id,
            Reservation.tenant_id == reservation.tenant_id,
            or_(
                func.lower(Reservation.upi_utr) == clean_utr.lower(),
                func.lower(Reservation.payment_reference) == clean_utr.lower(),
            ),
            Reservation.payment_status == "PAID",
        )
        existing_utr_res = await db.execute(existing_utr_stmt)
        existing_booking = existing_utr_res.scalars().first()
        if existing_booking:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"UTR_ALREADY_USED: This UPI Reference / UTR '{clean_utr}' has already been used and exhausted for Booking #{existing_booking.id}. Each table reservation requires its own unique payment transaction.",
            )

        # 4. Transition to PAYMENT_PENDING and record customer UTR as reconciliation reference
        reservation.status = "PAYMENT_PENDING"
        reservation.payment_status = "PENDING_VERIFICATION"
        reservation.payment_reference = clean_utr
        reservation.upi_utr = clean_utr
        await db.flush()

        # 5. Strictly verify against trusted independent bank credit ledger
        try:
            await PaymentVerificationService.verify_and_claim_credit(
                db=db,
                reservation=reservation,
                utr=clean_utr,
            )
        except HTTPException:
            await db.commit()
            raise

        # 6. Authentic bank credit confirmed! Transition to CONFIRMED & PAID
        reservation.status = "CONFIRMED"
        reservation.payment_status = "PAID"
        reservation.hold_expires_at = None

        await db.commit()
        await db.refresh(reservation)

        try:
            task_result = send_reservation_reminder.apply_async(args=[reservation.id], countdown=3600)
            tid = getattr(task_result, "id", None)
            reservation.celery_task_id = str(tid) if tid is not None else None
            await db.commit()
        except Exception:
            pass

        await ReservationService._broadcast_reservation_event(reservation, "RESERVATION_UPDATED")
        notify_booking_confirmed(reservation.id)
        return reservation

    @staticmethod
    async def cancel_hold(db: AsyncSession, reservation_id: int, tenant_id: Optional[uuid.UUID] = None) -> Reservation:
        from sqlalchemy.orm import selectinload
        stmt = select(Reservation).options(selectinload(Reservation.customer)).where(Reservation.id == reservation_id)
        if tenant_id:
            stmt = stmt.where(Reservation.tenant_id == tenant_id)
        res = await db.execute(stmt)
        reservation = res.scalar_one_or_none()

        if not reservation:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reservation not found")

        if reservation.status in ["HOLD", "PAYMENT_PENDING"]:
            reservation.status = "CANCELLED"
            reservation.payment_status = "CANCELLED"
            reservation.hold_expires_at = None
            await db.commit()
            await db.refresh(reservation)

        return reservation

    @staticmethod
    async def get_unavailable_tables(
        db: AsyncSession, branch_id: int, reservation_date: datetime.date, time_slot: str, tenant_id: Optional[uuid.UUID] = None
    ) -> List[dict]:
        await ReservationService.cleanup_expired_holds(db, tenant_id=tenant_id)
        now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)

        stmt = select(Reservation).where(
            Reservation.branch_id == branch_id,
            Reservation.reservation_date == reservation_date,
            Reservation.time_slot == time_slot,
            Reservation.status.in_(["HOLD", "PAYMENT_PENDING", "CONFIRMED", "ARRIVED", "SEATED"]),
        )
        if tenant_id:
            stmt = stmt.where(Reservation.tenant_id == tenant_id)
        res = await db.execute(stmt)
        active_res = res.scalars().all()

        unavailable = []
        for r in active_res:
            if not r.table_name or not r.floor_number:
                continue
            is_held = r.status in ["HOLD", "PAYMENT_PENDING"] and r.hold_expires_at and r.hold_expires_at > now
            if r.status in ["CONFIRMED", "ARRIVED", "SEATED"] or is_held:
                unavailable.append({
                    "floor_number": r.floor_number,
                    "table_name": r.table_name,
                    "table_id": r.table_id,
                    "status": "HELD" if is_held else "BOOKED",
                    "seconds_remaining": int((r.hold_expires_at - now).total_seconds()) if is_held and r.hold_expires_at else 0,
                })
        return unavailable

    @staticmethod
    async def process_bank_webhook(
        db: AsyncSession,
        utr: str,
        amount: Decimal,
        merchant_vpa: str = settings.MERCHANT_UPI_ID,
        payer_vpa: Optional[str] = None,
        tx_status: str = "SETTLED",
        provider_source: str = "BANK_WEBHOOK",
        tenant_id: Optional[uuid.UUID] = None,
    ) -> dict:
        t_id = tenant_id or uuid.UUID("23395d5e-16e5-4eb6-9214-cc63f05c3210")
        clean_utr = utr.strip().replace(" ", "").replace("-", "")
        dec_amount = Decimal(str(amount))

        credit = await PaymentVerificationService.record_verified_bank_credit(
            db=db,
            utr=clean_utr,
            amount=dec_amount,
            merchant_vpa=merchant_vpa,
            payer_vpa=payer_vpa,
            tx_status=tx_status,
            provider_source=provider_source,
            tenant_id=t_id,
        )

        # Check if there is a reservation in PAYMENT_PENDING waiting for this UTR
        stmt = (
            select(Reservation)
            .where(
                Reservation.tenant_id == t_id,
                Reservation.status == "PAYMENT_PENDING",
                func.lower(Reservation.upi_utr) == clean_utr.lower(),
            )
            .with_for_update()
        )
        res = await db.execute(stmt)
        reservation = res.scalars().first()

        confirmed_reservation_id = None
        if reservation and not credit.is_claimed and tx_status == "SETTLED":
            if credit.amount >= Decimal(str(reservation.advance_amount or "0.00")):
                credit.is_claimed = True
                credit.claimed_reservation_id = reservation.id
                reservation.status = "CONFIRMED"
                reservation.payment_status = "PAID"
                reservation.hold_expires_at = None
                await db.commit()
                confirmed_reservation_id = reservation.id
                notify_booking_confirmed(reservation.id)

        return {
            "status": "SUCCESS",
            "utr": clean_utr,
            "credit_id": credit.id,
            "confirmed_reservation_id": confirmed_reservation_id,
        }

    @staticmethod
    async def process_android_payment_event(
        db: AsyncSession,
        event_id: Optional[str],
        utr: str,
        amount: Any,
        merchant_vpa: str,
        payer_vpa: Optional[str] = None,
        event_timestamp: Optional[datetime.datetime] = None,
    ) -> Dict[str, Any]:
        """
        Receives payment event from the registered payment listener.
        """
        return await PaymentVerificationService.process_android_payment_event(
            db=db,
            event_id=event_id,
            utr=utr,
            amount=amount,
            merchant_vpa=merchant_vpa,
            payer_vpa=payer_vpa,
            event_timestamp=event_timestamp,
        )

    @staticmethod
    async def staff_verify_payment(
        db: AsyncSession,
        reservation_id: int,
        utr: str,
        staff_username: str,
        tenant_id: Optional[uuid.UUID] = None,
    ) -> Reservation:
        """
        Authorized staff/cashier manual reconciliation from POS.
        """
        clean_utr = utr.strip().replace(" ", "").replace("-", "")
        stmt = select(Reservation).where(Reservation.id == reservation_id)
        if tenant_id:
            stmt = stmt.where(Reservation.tenant_id == tenant_id)
        stmt = stmt.with_for_update()
        res = await db.execute(stmt)
        reservation = res.scalars().first()
        if not reservation:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reservation not found")

        advance = Decimal(str(reservation.advance_amount or "0.00"))
        await PaymentVerificationService.record_verified_bank_credit(
            db=db,
            utr=clean_utr,
            amount=advance,
            provider_source=f"STAFF_VERIFIED:{staff_username}",
            tx_status="SETTLED",
            tenant_id=reservation.tenant_id,
        )
        return await ReservationService.verify_upi_payment(
            db=db,
            reservation_id=reservation_id,
            data=ReservationVerifyUpiRequest(upi_utr=clean_utr),
            tenant_id=reservation.tenant_id,
        )

    @staticmethod
    async def get_pending_payment_reviews(db: AsyncSession, tenant_id: Optional[uuid.UUID] = None) -> List[dict]:
        """
        Lists bank credits flagged with PAYMENT_REVIEW_REQUIRED and any pending reservations.
        """
        stmt = (
            select(VerifiedBankCredit)
            .where(VerifiedBankCredit.status == "PAYMENT_REVIEW_REQUIRED")
        )
        if tenant_id:
            stmt = stmt.where(VerifiedBankCredit.tenant_id == tenant_id)
        stmt = stmt.order_by(VerifiedBankCredit.verified_at.desc())
        res = await db.execute(stmt)
        credits = res.scalars().all()

        results = []
        for c in credits:
            results.append({
                "credit_id": c.id,
                "utr": c.utr,
                "amount": c.amount,
                "merchant_vpa": c.merchant_vpa,
                "provider_source": c.provider_source,
                "status": c.status,
                "review_reason": c.review_reason,
                "raw_event_payload": c.raw_event_payload,
                "verified_at": c.verified_at,
            })
        return results

    @staticmethod
    async def create_razorpay_order(
        db: AsyncSession, data: RazorpayCreateOrderRequest, tenant_id: Optional[uuid.UUID] = None
    ) -> RazorpayCreateOrderResponse:
        """
        Creates a Razorpay order in test mode or live mode.
        Calculates the reservation deposit and generates Razorpay Order ID.
        """
        t_id = tenant_id or uuid.UUID("23395d5e-16e5-4eb6-9214-cc63f05c3210")
        try:
            deposit_per_guest = await SettingsService.get_deposit_per_guest(db, tenant_id=t_id)
        except TypeError:
            deposit_per_guest = await SettingsService.get_deposit_per_guest(db)
        if deposit_per_guest <= 0:
            deposit_per_guest = Decimal("150.00")

        total_deposit = deposit_per_guest * Decimal(str(data.guest_count))
        amount_paise = int(total_deposit * 100)
        timestamp_part = int(datetime.datetime.now().timestamp())
        unique_suffix = uuid.uuid4().hex[:6]
        is_test = test_payments_allowed()
        if is_test:
            order_id = f"order_test_{timestamp_part}_{unique_suffix}"
        else:
            if not razorpay_configured():
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="PAYMENTS_NOT_CONFIGURED: Online payment is unavailable right now. Please call the cafe to book.",
                )
            import httpx
            try:
                async with httpx.AsyncClient(timeout=20) as client:
                    rz = await client.post(
                        f"{RAZORPAY_API}/orders",
                        auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET),
                        json={
                            "amount": amount_paise,
                            "currency": "INR",
                            "receipt": f"rsv_{timestamp_part}_{unique_suffix}",
                            "notes": {
                                "reservation_date": str(data.reservation_date),
                                "time_slot": data.time_slot,
                                "guest_count": str(data.guest_count),
                            },
                        },
                    )
            except httpx.HTTPError:
                raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach the payment gateway. Please try again.")
            if rz.status_code >= 400:
                raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="The payment gateway rejected the order. Please try again.")
            order_id = rz.json()["id"]

        return RazorpayCreateOrderResponse(
            order_id=order_id,
            amount=amount_paise,
            currency="INR",
            key_id=settings.RAZORPAY_KEY_ID,
            guest_count=data.guest_count,
            deposit_per_guest=float(deposit_per_guest),
            total_amount=float(total_deposit),
            customer_name=data.customer_name,
            customer_phone=data.customer_phone,
            customer_email=data.customer_email,
            is_test_mode=is_test,
        )

    @staticmethod
    async def _assert_razorpay_payment(
        db: AsyncSession, data: RazorpayVerifyPaymentRequest, tenant_id: Optional[uuid.UUID] = None
    ) -> None:
        """Ask Razorpay whether this payment really succeeded, on this order, for the full deposit."""
        import httpx
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                rp = await client.get(
                    f"{RAZORPAY_API}/payments/{data.razorpay_payment_id}",
                    auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET),
                )
        except httpx.HTTPError:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not confirm the payment with the gateway. Please contact the cafe.")
        if rp.status_code >= 400:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PAYMENT_NOT_FOUND: The payment could not be confirmed.")
        payment = rp.json()
        if payment.get("order_id") != data.razorpay_order_id or payment.get("status") not in ("authorized", "captured"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PAYMENT_NOT_COMPLETED: The payment did not complete.")
        try:
            deposit_per_guest = await SettingsService.get_deposit_per_guest(db, tenant_id=tenant_id)
        except TypeError:
            deposit_per_guest = await SettingsService.get_deposit_per_guest(db)
        if deposit_per_guest <= 0:
            deposit_per_guest = Decimal("150.00")
        expected_paise = int(deposit_per_guest * Decimal(str(data.guest_count)) * 100)
        if int(payment.get("amount") or 0) < expected_paise:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="PAYMENT_AMOUNT_MISMATCH: The amount paid does not cover the deposit for this booking.",
            )

    @staticmethod
    async def verify_razorpay_payment(
        db: AsyncSession, data: RazorpayVerifyPaymentRequest, tenant_id: Optional[uuid.UUID] = None
    ) -> Reservation:
        """
        Verifies Razorpay payment signature or test simulator credentials.
        Instantly confirms table reservation, allocates dough, and registers bank credit.
        """
        t_id = tenant_id or uuid.UUID("23395d5e-16e5-4eb6-9214-cc63f05c3210")
        validate_booking_request(data.reservation_date, data.time_slot, data.customer_phone)
        # Validate HMAC signature if non-simulated and live keys configured
        signature_verified = False  # only genuinely verified payments trigger WhatsApp messages
        test_payments_allowed = settings.APP_ENV == "development" or settings.ALLOW_TEST_PAYMENTS
        is_simulated = data.is_test_simulation or data.razorpay_payment_id.startswith("pay_test_")
        if is_simulated and not test_payments_allowed:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="TEST_PAYMENT_REJECTED: Simulated payments are not accepted.",
            )
        if not is_simulated:
            message = f"{data.razorpay_order_id}|{data.razorpay_payment_id}"
            expected_sig = hmac.new(
                settings.RAZORPAY_KEY_SECRET.encode("utf-8"),
                message.encode("utf-8"),
                hashlib.sha256,
            ).hexdigest()
            if not hmac.compare_digest(data.razorpay_signature or "", expected_sig):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="INVALID_RAZORPAY_SIGNATURE: Payment verification failed.",
                )
            signature_verified = True
            if razorpay_configured():
                await ReservationService._assert_razorpay_payment(db, data, tenant_id=t_id)

        # Get or create customer
        clean_phone = "".join(filter(str.isdigit, data.customer_phone))
        cust_query = select(Customer).where(Customer.phone == clean_phone, Customer.tenant_id == t_id)
        cust_result = await db.execute(cust_query)
        customer = cust_result.scalar_one_or_none()

        if not customer:
            customer = Customer(
                tenant_id=t_id,
                name=data.customer_name.strip(),
                phone=clean_phone or data.customer_phone,
                email=data.customer_email,
            )
            db.add(customer)
            await db.flush()

        # Find matching table if needed
        floor_table_ids = {
            1: [1, 2, 3],
            2: [4, 5, 6],
            3: [7, 8],
            4: [9, 10],
            5: [11, 12, 13],
        }
        target_floor = data.floor_number or 1

        valid_table_id = data.table_id
        if valid_table_id is not None:
            tbl_check = await db.execute(select(Table.id).where(Table.id == valid_table_id, Table.tenant_id == t_id))
            if not tbl_check.scalar_one_or_none():
                valid_table_id = None

        if valid_table_id is None and data.table_name:
            tbl_stmt = select(Table.id).where(Table.table_number == data.table_name, Table.tenant_id == t_id)
            if target_floor in floor_table_ids:
                tbl_stmt = tbl_stmt.where(Table.id.in_(floor_table_ids[target_floor]))
            tbl_match = await db.execute(tbl_stmt)
            valid_table_id = tbl_match.scalars().first()

        if valid_table_id is None and target_floor in floor_table_ids:
            # Check default table for tenant
            default_match = await db.execute(select(Table.id).where(Table.tenant_id == t_id, Table.id.in_(floor_table_ids[target_floor])))
            valid_table_id = default_match.scalars().first()
            if valid_table_id is None:
                valid_table_id = floor_table_ids[target_floor][0]

        deposit_per_guest = await SettingsService.get_deposit_per_guest(db, tenant_id=t_id)
        if deposit_per_guest <= 0:
            deposit_per_guest = Decimal("150.00")
        total_deposit = deposit_per_guest * Decimal(str(data.guest_count))

        reservation = Reservation(
            tenant_id=t_id,
            branch_id=data.branch_id,
            customer_id=customer.id,
            guest_count=data.guest_count,
            reservation_date=data.reservation_date,
            time_slot=data.time_slot,
            table_id=valid_table_id,
            floor_number=data.floor_number or 1,
            table_name=data.table_name or "Table 1",
            status="CONFIRMED",
            payment_status="PAID",
            advance_amount=total_deposit,
            payment_reference=data.razorpay_payment_id,
            payment_method="RAZORPAY",
        )
        db.add(reservation)
        await db.flush()

        # Log verified credit record for POS ledger and Razorpay portal
        try:
            source = "RAZORPAY_TEST_SIMULATOR" if data.is_test_simulation else "RAZORPAY_GATEWAY"
            bank_credit = VerifiedBankCredit(
                tenant_id=t_id,
                utr=data.razorpay_payment_id,
                amount=total_deposit,
                merchant_vpa=settings.MERCHANT_UPI_ID,
                provider_source=source,
                status="SETTLED",
                reservation_id=reservation.id,
                raw_event_payload={
                    "order_id": data.razorpay_order_id,
                    "payment_id": data.razorpay_payment_id,
                    "signature": data.razorpay_signature,
                    "is_test": data.is_test_simulation,
                },
            )
            db.add(bank_credit)
        except Exception:
            pass

        # Create protected dough allocation for this confirmed reservation
        try:
            from app.services.capacity_service import CapacityService
            await CapacityService.create_reservation_dough_allocation(
                db=db,
                reservation_id=reservation.id,
                branch_id=reservation.branch_id,
                reservation_date=reservation.reservation_date,
                guest_count=reservation.guest_count,
                expected_pizza_count=getattr(reservation, "expected_pizza_count", None),
            )
        except Exception:
            pass

        await db.commit()

        from sqlalchemy.orm import selectinload
        res = await db.execute(
            select(Reservation).options(selectinload(Reservation.customer)).where(Reservation.id == reservation.id)
        )
        saved = res.scalar_one()
        await ReservationService._broadcast_reservation_event(saved, "RESERVATION_CREATED")
        if signature_verified:
            notify_booking_confirmed(saved.id)
        return saved

    @staticmethod
    async def get_razorpay_transactions(db: AsyncSession, tenant_id: Optional[uuid.UUID] = None) -> List[dict]:
        """
        Retrieves recent Razorpay transactions for the Admin Razorpay Testing Portal.
        """
        from sqlalchemy.orm import selectinload
        stmt = (
            select(Reservation)
            .options(selectinload(Reservation.customer))
            .where(Reservation.payment_method == "RAZORPAY")
        )
        if tenant_id:
            stmt = stmt.where(Reservation.tenant_id == tenant_id)
        stmt = stmt.order_by(Reservation.created_at.desc()).limit(50)
        res = await db.execute(stmt)
        reservations = res.scalars().all()

        results = []
        for r in reservations:
            results.append({
                "reservation_id": r.id,
                "customer_name": r.customer.name if r.customer else "Guest",
                "customer_phone": r.customer.phone if r.customer else "",
                "party_size": r.guest_count,
                "amount": float(r.advance_amount or 0),
                "payment_id": r.payment_reference,
                "status": r.status,
                "payment_status": r.payment_status,
                "date": str(r.reservation_date),
                "time_slot": r.time_slot,
                "created_at": str(r.created_at),
            })
        return results

