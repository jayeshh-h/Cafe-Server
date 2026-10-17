import re
import hmac
import hashlib
from typing import List, Optional
from datetime import date
from fastapi import APIRouter, Depends, Query, Path, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_db, require_permission, get_current_user
from app.core.config import settings
from app.core.tenant import get_current_tenant, get_optional_tenant
from app.models.reservation import Reservation
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.reservation import (
    ReservationCreate,
    ReservationUpdate,
    ReservationStatusUpdate,
    ReservationResponse,
    ReservationCheckInRequest,
    ReservationHoldRequest,
    ReservationHoldResponse,
    ReservationVerifyUpiRequest,
    ReservationAssignTableRequest,
    BankWebhookPayload,
    PaymentEventPayload,
    PolicySettingsUpdate,
    RazorpayCreateOrderRequest,
    RazorpayCreateOrderResponse,
    RazorpayVerifyPaymentRequest,
)
from app.services.reservation_service import ReservationService
from app.services.settings_service import SettingsService

router = APIRouter(prefix="/reservations", tags=["Reservations Engine"])


_REPO_DEFAULT_DEVICE_CREDENTIALS = {
    "dev_token_jaadoo_android_phone_9460555743",
    "cafe-jaadoo-android-listener-secret-2026",
}


def verify_device_auth(
    x_device_token: Optional[str] = Header(None, alias="X-Device-Token"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
    x_signature: Optional[str] = Header(None, alias="X-Signature"),
):
    """
    Enforces authentication on the payment notification listener webhook.
    Accepts configured device token (via X-Device-Token or Authorization Bearer) or HMAC signature.
    """
    token_candidate = x_device_token
    if not token_candidate and authorization:
        if authorization.lower().startswith("bearer "):
            token_candidate = authorization[7:].strip()
        else:
            token_candidate = authorization.strip()

    # The repo ships placeholder credentials; they only count in local development
    is_dev = settings.APP_ENV == "development"
    device_token = settings.ANDROID_DEVICE_TOKEN if (is_dev or settings.ANDROID_DEVICE_TOKEN not in _REPO_DEFAULT_DEVICE_CREDENTIALS) else None
    device_secret = settings.ANDROID_DEVICE_SECRET if (is_dev or settings.ANDROID_DEVICE_SECRET not in _REPO_DEFAULT_DEVICE_CREDENTIALS) else None

    valid_token = bool(
        token_candidate
        and device_token
        and hmac.compare_digest(token_candidate, device_token)
    )
    valid_signature = False
    if x_signature and device_secret:
        expected = hmac.new(
            device_secret.encode("utf-8"),
            settings.MERCHANT_UPI_ID.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        valid_signature = hmac.compare_digest(x_signature, expected)

    if not (valid_token or valid_signature):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="DEVICE_AUTH_FAILED: Device payment listener is not authenticated with valid token/HMAC signature.",
        )


verify_android_auth = verify_device_auth


@router.post("/hold", response_model=ReservationHoldResponse, status_code=201)
async def hold_reservation_slot(
    data: ReservationHoldRequest,
    db: AsyncSession = Depends(get_db),
    current_tenant: Tenant = Depends(get_current_tenant),
):
    """
    Step 1: Check availability & temporarily lock/HOLD table slot for 7 minutes.
    Backend calculates ₹200/guest deposit with Decimal precision.
    """
    return await ReservationService.hold_reservation(
        db, data, tenant_id=current_tenant.id, tenant_slug=current_tenant.slug
    )


@router.post("/{id}/verify-upi", response_model=ReservationResponse)
async def verify_upi_payment(
    id: int,
    data: ReservationVerifyUpiRequest,
    db: AsyncSession = Depends(get_db),
    current_tenant: Tenant = Depends(get_current_tenant),
):
    """
    Step 2: Customer enters UPI UTR / Transaction reference.
    Customer UTR is only a reconciliation hint. Confirmation strictly requires
    independent bank settlement verification.
    """
    return await ReservationService.verify_upi_payment(db, id, data, tenant_id=current_tenant.id)


@router.post("/payment-event")
@router.post("/android-payment-event")
async def receive_payment_event(
    payload: PaymentEventPayload,
    db: AsyncSession = Depends(get_db),
    _auth: None = Depends(verify_device_auth),
):
    """
    Secure endpoint for payment notification events.
    Matches credit to pending reservation or marks PAYMENT_REVIEW_REQUIRED.
    """
    return await ReservationService.process_android_payment_event(
        db=db,
        event_id=payload.event_id,
        utr=payload.utr or "",
        amount=payload.amount,
        merchant_vpa=payload.merchant_vpa or settings.MERCHANT_UPI_ID,
        payer_vpa=payload.payer_vpa,
        event_timestamp=payload.event_timestamp,
    )




def verify_bank_webhook_secret(x_webhook_secret: Optional[str] = Header(None)) -> None:
    """Bank settlement events confirm bookings, so the sender must prove it knows the shared secret."""
    expected = settings.BANK_WEBHOOK_SECRET
    if not expected:
        if settings.APP_ENV == "development":
            return
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Bank webhook is not configured.")
    if not x_webhook_secret or not hmac.compare_digest(x_webhook_secret, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid webhook secret.")


@router.post("/bank-webhook", dependencies=[Depends(verify_bank_webhook_secret)])
async def receive_bank_payment_webhook(
    payload: BankWebhookPayload,
    db: AsyncSession = Depends(get_db),
    optional_tenant: Optional[Tenant] = Depends(get_optional_tenant),
):
    """
    Authentic Bank / Acquirer / Gateway Webhook.
    Receives verified settlement events and automatically confirms matching reservations.
    """
    t_id = optional_tenant.id if optional_tenant else None
    return await ReservationService.process_bank_webhook(
        db=db,
        utr=payload.utr,
        amount=payload.amount,
        merchant_vpa=payload.merchant_vpa,
        payer_vpa=payload.payer_vpa,
        tx_status=payload.tx_status,
        provider_source=payload.provider_source,
        tenant_id=t_id,
    )


@router.post("/{id}/staff-verify-payment", response_model=ReservationResponse)
async def staff_verify_payment(
    id: int,
    data: ReservationVerifyUpiRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Authorized staff/cashier POS reconciliation.
    Confirms that staff has verified the bank SMS/soundbox/statement for this reservation.
    """
    return await ReservationService.staff_verify_payment(
        db=db,
        reservation_id=id,
        utr=data.upi_utr,
        staff_username=current_user.username,
        tenant_id=current_user.tenant_id,
    )


@router.post("/{id}/assign-table", response_model=ReservationResponse)
async def assign_table_to_reservation(
    id: int,
    data: ReservationAssignTableRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Allows café host/cashier to assign a physical table to a confirmed reservation.
    """
    return await ReservationService.assign_table(
        db=db,
        reservation_id=id,
        table_id=data.table_id,
        table_name=data.table_name,
        floor_number=data.floor_number,
        tenant_id=current_user.tenant_id,
    )


@router.get("/pending-reviews")
async def list_pending_payment_reviews(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Lists bank credits flagged with PAYMENT_REVIEW_REQUIRED for staff review in POS.
    """
    return await ReservationService.get_pending_payment_reviews(db, tenant_id=current_user.tenant_id)


@router.post("/{id}/cancel-hold", response_model=ReservationResponse)
async def cancel_reservation_hold(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_tenant: Tenant = Depends(get_current_tenant),
):
    """
    If customer cancels or changes mind, temporary hold is released immediately.
    """
    return await ReservationService.cancel_hold(db, id, tenant_id=current_tenant.id)


@router.get("/availability/slots")
async def get_slot_availability(
    reservation_date: date = Query(...),
    time_slot: str = Query(...),
    branch_id: int = Query(1),
    db: AsyncSession = Depends(get_db),
    current_tenant: Tenant = Depends(get_current_tenant),
):
    """
    Returns list of tables that are currently locked (HELD or BOOKED) for the given date & time slot.
    """
    return await ReservationService.get_unavailable_tables(
        db, branch_id, reservation_date, time_slot, tenant_id=current_tenant.id
    )


@router.post("", response_model=ReservationResponse, status_code=201)
async def create_reservation(
    data: ReservationCreate,
    current_user: User = Depends(require_permission("pos:access")),
    db: AsyncSession = Depends(get_db),
):
    return await ReservationService.create_reservation(db, data, tenant_id=current_user.tenant_id)


@router.post("/{id}/checkin", response_model=ReservationResponse)
async def checkin_reservation(
    id: int,
    data: Optional[ReservationCheckInRequest] = None,
    db: AsyncSession = Depends(get_db),
    token: Optional[str] = Header(None, alias="Authorization"),
    current_tenant: Tenant = Depends(get_current_tenant),
):
    # ponytail: allow check-in but strip customer PII for unauthenticated callers
    session_token = data.session_token if data else None
    table_id = data.table_id if data else None

    is_staff = False
    if token:
        try:
            auth_token = token[7:].strip() if token.lower().startswith("bearer ") else token.strip()
            from app.api.deps import get_current_user
            user = await get_current_user(db=db, token=auth_token, current_tenant=current_tenant)
            if user:
                is_staff = True
        except Exception:
            is_staff = False

    saved = await ReservationService.checkin_reservation(
        db, id, session_token, table_id, tenant_id=current_tenant.id
    )
    resp = ReservationService.sanitize_reservation_response(saved)
    if not is_staff and resp.customer:
        resp.customer.phone = None
        resp.customer.email = None
    return resp


@router.get("/policies/config")
async def get_policies_config(
    db: AsyncSession = Depends(get_db),
    current_tenant: Tenant = Depends(get_current_tenant),
):
    """
    Returns current owner-configurable policies for deposits, remainders, and cancellations.
    """
    deposit = await SettingsService.get_deposit_per_guest(db, tenant_id=current_tenant.id)
    remainder = await SettingsService.get_deposit_remainder_policy(db, tenant_id=current_tenant.id)
    cancellation = await SettingsService.get_cancellation_policy(db, tenant_id=current_tenant.id)
    return {
        "deposit_per_person": deposit,
        "remainder_policy": remainder,
        "cancellation": cancellation,
    }


@router.patch("/policies/config")
async def update_policies_config(
    data: PolicySettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("pos:access")),
):
    """
    Updates owner policies from POS/Owner Settings.
    """
    t_id = current_user.tenant_id
    if data.deposit_per_person is not None:
        await SettingsService.set_setting(db, "RESERVATION_DEPOSIT_PER_PERSON", str(data.deposit_per_person), tenant_id=t_id)
    if data.remainder_policy is not None:
        await SettingsService.set_setting(db, "RESERVATION_DEPOSIT_REMAINDER_POLICY", data.remainder_policy, tenant_id=t_id)
    if data.cancellation_policy is not None:
        await SettingsService.set_setting(db, "CANCELLATION_REFUND_POLICY", data.cancellation_policy, tenant_id=t_id)
    if data.cancellation_cutoff_hours is not None:
        await SettingsService.set_setting(db, "CANCELLATION_CUTOFF_HOURS", str(data.cancellation_cutoff_hours), tenant_id=t_id)
    if data.cancellation_refund_percentage is not None:
        await SettingsService.set_setting(db, "CANCELLATION_REFUND_PERCENTAGE", str(data.cancellation_refund_percentage), tenant_id=t_id)
    if data.no_show_policy is not None:
        await SettingsService.set_setting(db, "NO_SHOW_POLICY", data.no_show_policy, tenant_id=t_id)

    deposit = await SettingsService.get_deposit_per_guest(db, tenant_id=t_id)
    remainder = await SettingsService.get_deposit_remainder_policy(db, tenant_id=t_id)
    cancellation = await SettingsService.get_cancellation_policy(db, tenant_id=t_id)
    return {
        "deposit_per_person": deposit,
        "remainder_policy": remainder,
        "cancellation": cancellation,
    }


@router.get("/{id}", response_model=ReservationResponse)
async def get_reservation(
    id: int = Path(...),
    current_user: User = Depends(require_permission("pos:access")),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy.orm import selectinload
    stmt = (
        select(Reservation)
        .options(selectinload(Reservation.customer))
        .where(Reservation.id == id, Reservation.tenant_id == current_user.tenant_id)
    )
    res = await db.execute(stmt)
    reservation = res.scalar_one_or_none()
    if not reservation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reservation not found")
    return ReservationService.sanitize_reservation_response(reservation)


@router.patch("/{id}", response_model=ReservationResponse)
async def update_reservation(
    id: int,
    data: ReservationUpdate,
    current_user: User = Depends(require_permission("pos:access")),
    db: AsyncSession = Depends(get_db),
):
    return await ReservationService.update_reservation(db, id, data, tenant_id=current_user.tenant_id)


@router.patch("/{id}/status", response_model=ReservationResponse)
async def update_reservation_status(
    id: int,
    data: ReservationStatusUpdate,
    current_user: User = Depends(require_permission("pos:access")),
    db: AsyncSession = Depends(get_db),
):
    return await ReservationService.update_reservation_status(db, id, data.status, tenant_id=current_user.tenant_id)


@router.delete("/{id}", response_model=ReservationResponse)
async def cancel_reservation(
    id: int,
    current_user: User = Depends(require_permission("pos:access")),
    db: AsyncSession = Depends(get_db),
):
    return await ReservationService.cancel_reservation(db, id, tenant_id=current_user.tenant_id)


@router.get("", response_model=List[ReservationResponse])
async def list_reservations(
    branch_id: Optional[int] = Query(None),
    reservation_date: Optional[date] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    current_user: User = Depends(require_permission("pos:access")),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy.orm import selectinload
    from sqlalchemy import or_
    from app.models.customer import Customer

    query = (
        select(Reservation)
        .join(Reservation.customer)
        .options(selectinload(Reservation.customer))
        .where(Reservation.tenant_id == current_user.tenant_id)
    )
    if branch_id:
        query = query.where(Reservation.branch_id == branch_id)
    if reservation_date:
        query = query.where(Reservation.reservation_date == reservation_date)
    if status:
        query = query.where(Reservation.status == status)

    booking_id_search = None
    if search:
        s = search.strip()
        # Check if searching for canonical ID e.g. "RES-0004", "#4", "4"
        clean_id_str = s.upper().replace("RES-", "").replace("RES", "").replace("#", "").strip()
        conditions = [
            Customer.name.ilike(f"%{s}%"),
            Customer.phone.ilike(f"%{s}%"),
            Reservation.table_name.ilike(f"%{s}%"),
            Reservation.payment_reference.ilike(f"%{s}%"),
            Reservation.upi_utr.ilike(f"%{s}%"),
        ]
        if clean_id_str.isdigit():
            conditions.append(Reservation.id == int(clean_id_str))
        # Booking ID search, e.g. "PRIN5743": narrow by phone suffix in SQL, match exactly below
        id_match = re.fullmatch(r"([A-Za-z]{1,4})(\d{4})", s)
        if id_match:
            booking_id_search = s.upper()
            conditions.append(Customer.phone.like(f"%{id_match.group(2)}"))
        query = query.where(or_(*conditions))

    query = query.order_by(Reservation.created_at.desc())
    result = await db.execute(query)
    raw_list = result.scalars().all()
    if booking_id_search:
        # Drop rows that matched only via the broad phone-suffix condition
        needle = booking_id_search.lower()
        raw_list = [
            r for r in raw_list
            if r.booking_id == booking_id_search
            or any(needle in (v or "").lower() for v in (
                r.customer.name, r.customer.phone, r.table_name, r.payment_reference, r.upi_utr
            ))
        ]

    cutoff_date = ReservationService.get_seven_day_cutoff()
    return [ReservationService.sanitize_reservation_response(r, cutoff_date) for r in raw_list]


@router.get("/razorpay/config")
async def get_razorpay_config(
    db: AsyncSession = Depends(get_db),
    current_tenant: Tenant = Depends(get_current_tenant),
):
    """
    Returns Razorpay key and settings for test mode / frontend integration.
    """
    deposit = await SettingsService.get_deposit_per_guest(db, tenant_id=current_tenant.id)
    if deposit <= 0:
        deposit = 150.0
    return {
        "key_id": settings.RAZORPAY_KEY_ID,
        "is_test_mode": settings.APP_ENV == "development" or settings.ALLOW_TEST_PAYMENTS,
        "currency": "INR",
        "deposit_per_guest": float(deposit),
        "merchant_name": current_tenant.name or "Jaadoo Pizza Project",
        "description": f"{current_tenant.name or 'Artisanal'} Table Reservation Deposit",
    }


@router.post("/razorpay/create-order", response_model=RazorpayCreateOrderResponse, status_code=201)
async def create_razorpay_order(
    data: RazorpayCreateOrderRequest,
    db: AsyncSession = Depends(get_db),
    current_tenant: Tenant = Depends(get_current_tenant),
):
    """
    Generates a Razorpay Order ID for table reservation advance deposit.
    """
    return await ReservationService.create_razorpay_order(db, data, tenant_id=current_tenant.id)


@router.post("/razorpay/verify-payment", response_model=ReservationResponse, status_code=201)
async def verify_razorpay_payment(
    data: RazorpayVerifyPaymentRequest,
    db: AsyncSession = Depends(get_db),
    current_tenant: Tenant = Depends(get_current_tenant),
):
    """
    Verifies Razorpay payment and confirms reservation with instant pass generation.
    """
    return await ReservationService.verify_razorpay_payment(db, data, tenant_id=current_tenant.id)


@router.get("/razorpay/transactions")
async def list_razorpay_transactions(
    current_user: User = Depends(require_permission("pos:access")),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns recent Razorpay payments and simulations for the Admin Testing Portal.
    """
    return await ReservationService.get_razorpay_transactions(db, tenant_id=current_user.tenant_id)

