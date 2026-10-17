from decimal import ROUND_HALF_UP, Decimal
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException, status
from app.core.config import settings
from app.utils.helpers import utc_now
from app.models.table import DiningSession, Table
from app.models.order import Order, OrderItem
from app.models.billing import Bill, Payment
from app.models.reservation import Reservation
from app.schemas.billing import PaymentCreate
from app.services.settings_service import SettingsService


# Staff discounts (owner/admin and cashier alike) are capped at this share of the item subtotal
MAX_DISCOUNT_PERCENT = Decimal("10")


def compute_discount_amount(subtotal: Decimal, discount_type: str | None, discount_value) -> Decimal:
    """Rupee discount for a bill, applied to the pre-GST subtotal and never above MAX_DISCOUNT_PERCENT.

    Re-clamped on every recalculation, so removing items after a flat discount can't push it past the cap.
    """
    value = Decimal(str(discount_value or "0"))
    if discount_type not in ("PERCENT", "FLAT") or value <= 0 or subtotal <= 0:
        return Decimal("0.00")
    cap = (subtotal * MAX_DISCOUNT_PERCENT / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if discount_type == "PERCENT":
        amount = subtotal * min(value, MAX_DISCOUNT_PERCENT) / Decimal("100")
    else:
        amount = value
    return min(amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP), cap)


class BillingService:
    @staticmethod
    async def get_or_calculate_bill(db: AsyncSession, dining_session_id: int) -> Bill:
        # Load dining session with customer and reservation
        sess_query = (
            select(DiningSession)
            .options(
                selectinload(DiningSession.reservation),
                selectinload(DiningSession.customer),
            )
            .where(DiningSession.id == dining_session_id)
        )
        sess_res = await db.execute(sess_query)
        dining_session = sess_res.scalar_one_or_none()
        if not dining_session:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Dining session #{dining_session_id} not found.",
            )

        # Check existing bill
        bill_query = select(Bill).options(selectinload(Bill.payments)).where(Bill.dining_session_id == dining_session_id)
        bill_res = await db.execute(bill_query)
        bill = bill_res.scalar_one_or_none()

        # Calculate line items subtotal across all orders in session
        subtotal_query = (
            select(func.coalesce(func.sum(OrderItem.subtotal), Decimal("0.00")))
            .join(Order, OrderItem.order_id == Order.id)
            .where(Order.dining_session_id == dining_session_id, Order.status != "CANCELLED")
        )
        subtotal_res = await db.execute(subtotal_query)
        calc_subtotal = Decimal(str(subtotal_res.scalar() or "0.00"))

        # Discount comes off the subtotal before GST (GST is charged on the discounted value)
        calc_discount = compute_discount_amount(
            calc_subtotal,
            bill.discount_type if bill else None,
            bill.discount_value if bill else 0,
        )
        taxable_value = calc_subtotal - calc_discount

        # Calculate dynamic configurable tax
        tax_rate = Decimal(str(getattr(settings, "DEFAULT_TAX_RATE", "0.05")))
        calc_tax = (taxable_value * tax_rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        gross_total = taxable_value + calc_tax

        # Resolve associated reservation for deposit credit
        reservation = dining_session.reservation
        if not reservation and dining_session.customer_id:
            # Fallback lookup: find seated reservation for this customer and table
            res_query = (
                select(Reservation)
                .where(
                    Reservation.customer_id == dining_session.customer_id,
                    Reservation.status.in_(["ARRIVED", "SEATED", "CONFIRMED"]),
                    Reservation.payment_status == "PAID",
                    Reservation.is_deposit_credited == False,
                )
                .order_by(Reservation.created_at.desc())
            )
            res_res = await db.execute(res_query)
            reservation = res_res.scalars().first()
            if reservation:
                dining_session.reservation_id = reservation.id

        # Calculate reservation credit and remainder
        deposit_paid = Decimal("0.00")
        reservation_credit = Decimal("0.00")
        remainder_action = None
        remainder_amount = Decimal("0.00")

        if reservation and reservation.payment_status == "PAID" and not reservation.is_deposit_credited:
            deposit_paid = Decimal(str(reservation.advance_amount or "0.00"))
            remainder_policy = await SettingsService.get_deposit_remainder_policy(db)

            if gross_total >= deposit_paid:
                reservation_credit = deposit_paid
                remainder_amount = Decimal("0.00")
                remainder_action = None
            else:
                # Gross bill < Deposit (e.g. Deposit ₹600, Gross ₹450)
                excess = deposit_paid - gross_total
                if remainder_policy == "REFUND_REMAINDER":
                    reservation_credit = gross_total
                    remainder_amount = excess
                    remainder_action = "REFUND_REMAINDER"
                elif remainder_policy == "FORFEIT_REMAINDER":
                    reservation_credit = deposit_paid
                    remainder_amount = Decimal("0.00")
                    remainder_action = "FORFEIT_REMAINDER"
                else:  # CUSTOMER_CREDIT
                    reservation_credit = gross_total
                    remainder_amount = excess
                    remainder_action = "CUSTOMER_CREDIT"

        net_due = max(gross_total - reservation_credit, Decimal("0.00"))

        if not bill:
            tbl_res = await db.get(Table, dining_session.table_id)
            bill = Bill(
                tenant_id=tbl_res.tenant_id if tbl_res else None,
                dining_session_id=dining_session_id,
                subtotal=calc_subtotal,
                tax_amount=calc_tax,
                discount_amount=calc_discount,
                reservation_deposit_paid=deposit_paid,
                reservation_credit=reservation_credit,
                remainder_action=remainder_action,
                remainder_amount=remainder_amount,
                total_amount=net_due,
                is_paid=False,
            )
            db.add(bill)
            await db.commit()
            await db.refresh(bill)
        else:
            bill.subtotal = calc_subtotal
            bill.tax_amount = calc_tax
            bill.discount_amount = calc_discount
            bill.reservation_deposit_paid = deposit_paid
            bill.reservation_credit = reservation_credit
            bill.remainder_action = remainder_action
            bill.remainder_amount = remainder_amount
            bill.total_amount = net_due
            await db.commit()
            await db.refresh(bill)

        return bill

    @staticmethod
    async def set_session_discount(
        db: AsyncSession,
        dining_session_id: int,
        discount_type: str | None,
        discount_value: Decimal,
        reason: str | None,
        user_id: int | None,
        tenant_id=None,
    ) -> Bill:
        """Set (or clear, with discount_type=None) the discount on an open session's bill."""
        dining_session = await db.get(DiningSession, dining_session_id)
        if not dining_session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Dining session #{dining_session_id} not found.")

        if tenant_id:
            table = await db.get(Table, dining_session.table_id)
            if not table or str(table.tenant_id) != str(tenant_id):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied: Cannot apply discount to another café's dining session.",
                )

        if dining_session.status not in ("OPENED", "ACTIVE", "CHECKOUT"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="DISCOUNT_LOCKED: This bill is already settled.")

        bill = await BillingService.get_or_calculate_bill(db, dining_session_id)
        if bill.is_paid:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="DISCOUNT_LOCKED: This bill is already paid.")

        value = Decimal(str(discount_value or "0"))
        if discount_type is not None:
            if discount_type not in ("PERCENT", "FLAT"):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Discount type must be PERCENT or FLAT.")
            if value <= 0:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Discount must be greater than zero.")
            max_flat = (bill.subtotal * MAX_DISCOUNT_PERCENT / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            if discount_type == "PERCENT" and value > MAX_DISCOUNT_PERCENT:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"DISCOUNT_LIMIT: Maximum discount is {MAX_DISCOUNT_PERCENT}%.",
                )
            if discount_type == "FLAT" and value > max_flat:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"DISCOUNT_LIMIT: Maximum discount on this bill is ₹{max_flat} ({MAX_DISCOUNT_PERCENT}% of ₹{bill.subtotal}).",
                )

        if discount_type:
            bill.discount_type = discount_type
            bill.discount_value = value
            bill.discount_reason = (reason or "").strip()[:200] or None
            bill.discount_by_user_id = user_id
        else:
            bill.discount_type = None
            bill.discount_value = Decimal("0.00")
            bill.discount_reason = None
            bill.discount_by_user_id = None
        await db.commit()

        # Recalculate subtotal, discount, GST and amount due with the new discount
        return await BillingService.get_or_calculate_bill(db, dining_session_id)

    @staticmethod
    async def process_checkout(db: AsyncSession, bill_id: int, payment_data: PaymentCreate) -> Payment:
        # Check idempotency key first
        if payment_data.idempotency_key:
            idem_query = select(Payment).where(Payment.idempotency_key == payment_data.idempotency_key)
            idem_res = await db.execute(idem_query)
            existing_payment = idem_res.scalar_one_or_none()
            if existing_payment:
                return existing_payment

        # Lock bill for update
        bill_query = select(Bill).where(Bill.id == bill_id).with_for_update()
        bill_res = await db.execute(bill_query)
        bill = bill_res.scalar_one_or_none()

        if not bill:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Bill #{bill_id} not found.",
            )

        if bill.is_paid:
            # Return existing payment if already paid
            pay_query = select(Payment).where(Payment.bill_id == bill.id)
            pay_res = await db.execute(pay_query)
            already_paid = pay_res.scalar_one_or_none()
            if already_paid:
                return already_paid

        # Validate payment amount against remaining bill total
        if Decimal(str(payment_data.amount_paid)) < Decimal(str(bill.total_amount)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"INSUFFICIENT_PAYMENT: Payment amount (₹{payment_data.amount_paid}) is less than total bill amount (₹{bill.total_amount}).",
            )

        # Create payment record
        payment = Payment(
            bill_id=bill.id,
            payment_method=payment_data.payment_method,
            amount_paid=payment_data.amount_paid,
            transaction_reference=payment_data.transaction_reference,
            idempotency_key=payment_data.idempotency_key,
        )
        db.add(payment)

        # Mark bill paid
        bill.is_paid = True

        # Close dining session and reset table availability
        session_query = select(DiningSession).where(DiningSession.id == bill.dining_session_id).with_for_update()
        session_res = await db.execute(session_query)
        dining_session = session_res.scalar_one_or_none()

        if dining_session:
            dining_session.status = "CLOSED"
            dining_session.closed_at = utc_now()

            # Mark associated reservation's deposit as permanently credited
            if dining_session.reservation_id:
                res_stmt = (
                    select(Reservation)
                    .where(Reservation.id == dining_session.reservation_id)
                    .with_for_update()
                )
                res_res = await db.execute(res_stmt)
                reservation = res_res.scalar_one_or_none()
                if reservation:
                    reservation.is_deposit_credited = True
                    reservation.credited_bill_id = bill.id
                    reservation.status = "COMPLETED"

            table_query = select(Table).where(Table.id == dining_session.table_id)
            table_res = await db.execute(table_query)
            table = table_res.scalar_one_or_none()
            if table:
                table.status = "Available"

        try:
            await db.commit()
            await db.refresh(payment)
            return payment
        except IntegrityError:
            await db.rollback()
            if payment_data.idempotency_key:
                idem_query = select(Payment).where(Payment.idempotency_key == payment_data.idempotency_key)
                idem_res = await db.execute(idem_query)
                existing_payment = idem_res.scalar_one_or_none()
                if existing_payment:
                    return existing_payment
            raise

