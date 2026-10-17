import datetime
from decimal import Decimal
from typing import List, Dict, Any, Optional
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select, func, desc, or_, and_, String
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_permission
from app.models.user import User, Role
from app.models.billing import Bill, Payment
from app.models.bank_transaction import VerifiedBankCredit
from app.models.supplier import PurchaseOrder, Supplier
from app.models.reservation import Reservation
from app.models.menu import MenuItem, MenuCategory
from app.models.order import Order, OrderItem
from app.models.table import DiningSession, Table
from app.utils.helpers import ist_now


IST = ZoneInfo("Asia/Kolkata")


router = APIRouter(
    prefix="/manager",
    tags=["Kunal Manager Portal"],
    dependencies=[Depends(require_permission("pos:access"))],
)


def ist_date_to_utc_bounds(start: datetime.date, end: datetime.date) -> tuple[datetime.datetime, datetime.datetime]:
    """
    Interpret start and end as Asia/Kolkata calendar dates.
    Returns half-open naive UTC datetime boundaries [start_utc, end_exclusive_utc)
    for filtering naive UTC timestamp columns (e.g. created_at, verified_at).
    """
    start_ist = datetime.datetime.combine(start, datetime.time.min, tzinfo=IST)
    end_exclusive_ist = datetime.datetime.combine(end + datetime.timedelta(days=1), datetime.time.min, tzinfo=IST)
    start_utc = start_ist.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    end_exclusive_utc = end_exclusive_ist.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    return start_utc, end_exclusive_utc


async def require_manager_or_admin(
    current_user: User = Depends(require_permission("pos:access")),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Enforce on backend that user holds Manager, Admin, or Owner role."""
    role = current_user.__dict__.get("role")
    if not role and current_user.role_id:
        role_res = await db.execute(select(Role).where(Role.id == current_user.role_id))
        role = role_res.scalar_one_or_none()

    role_name = (role.name.lower() if role and role.name else "")
    if role_name not in ["manager", "admin", "owner"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Manager Portal access requires Manager or Admin authorization.",
        )
    return current_user


def d_quant(val: Any) -> Decimal:
    """Quantize to 2 decimal places safely without floating point artifacts."""
    if val is None:
        return Decimal("0.00")
    if isinstance(val, Decimal):
        return val.quantize(Decimal("0.01"))
    try:
        return Decimal(str(val)).quantize(Decimal("0.01"))
    except Exception:
        return Decimal("0.00")


@router.get("/overview")
async def get_manager_overview(
    start: Optional[datetime.date] = Query(None, description="Start date (YYYY-MM-DD) in IST"),
    end: Optional[datetime.date] = Query(None, description="End date (YYYY-MM-DD) in IST"),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Authoritative Financial Overview for Kunal Manager Portal.
    All monetary sums are strictly calculated with Python Decimal.
    Uses half-open UTC timestamp boundaries [start_utc, end_exclusive_utc)
    derived from Asia/Kolkata business calendar dates.
    """
    today_ist = ist_now().date()
    if not end:
        end = today_ist
    if not start:
        start = end  # Default to single day (today)

    if end < start:
        raise HTTPException(status_code=400, detail="End date must be greater than or equal to start date.")
    if (end - start).days > 366:
        raise HTTPException(status_code=400, detail="Date range cannot exceed 366 days.")

    # Calculate prior equivalent period
    period_days = (end - start).days + 1
    prior_end = start - datetime.timedelta(days=1)
    prior_start = prior_end - datetime.timedelta(days=period_days - 1)

    start_utc, end_exclusive_utc = ist_date_to_utc_bounds(start, end)
    prior_start_utc, prior_end_exclusive_utc = ist_date_to_utc_bounds(prior_start, prior_end)

    # 1. Billed Revenue & Sales (Eligible Paid Bills)
    paid_bills_q = (
        select(Bill)
        .where(
            Bill.tenant_id == current_user.tenant_id,
            Bill.created_at >= start_utc,
            Bill.created_at < end_exclusive_utc,
            Bill.is_paid == True,
        )
    )
    paid_bills = (await db.execute(paid_bills_q)).scalars().all()

    gross_subtotal = d_quant(sum((b.subtotal for b in paid_bills), Decimal("0.00")))
    discounts = d_quant(sum((b.discount_amount for b in paid_bills), Decimal("0.00")))
    taxes = d_quant(sum((b.tax_amount for b in paid_bills), Decimal("0.00")))
    reservation_credits = d_quant(sum((b.reservation_credit for b in paid_bills), Decimal("0.00")))
    
    # Total billed dining consumption (served food & beverage value)
    total_dining_consumption = d_quant(gross_subtotal - discounts + taxes)
    
    # Remaining net checkout balance payable at POS after advance deposit credit
    net_pos_checkout_due = d_quant(sum((b.total_amount for b in paid_bills), Decimal("0.00")))
    completed_bills_count = len(paid_bills)

    # Prior Period Billed Revenue for Comparison
    prior_paid_bills_q = (
        select(Bill)
        .where(
            Bill.tenant_id == current_user.tenant_id,
            Bill.created_at >= prior_start_utc,
            Bill.created_at < prior_end_exclusive_utc,
            Bill.is_paid == True,
        )
    )
    prior_paid_bills = (await db.execute(prior_paid_bills_q)).scalars().all()
    prior_subtotal = d_quant(sum((b.subtotal for b in prior_paid_bills), Decimal("0.00")))
    prior_discounts = d_quant(sum((b.discount_amount for b in prior_paid_bills), Decimal("0.00")))
    prior_taxes = d_quant(sum((b.tax_amount for b in prior_paid_bills), Decimal("0.00")))
    prior_dining_consumption = d_quant(prior_subtotal - prior_discounts + prior_taxes)

    revenue_growth_pct = None
    if prior_dining_consumption > Decimal("0.00"):
        diff = total_dining_consumption - prior_dining_consumption
        revenue_growth_pct = float((diff / prior_dining_consumption * Decimal("100")).quantize(Decimal("0.1")))

    # 2. Payments & Verified Collections
    payments_q = (
        select(Payment)
        .join(Bill, Payment.bill_id == Bill.id)
        .where(
            Bill.tenant_id == current_user.tenant_id,
            Payment.created_at >= start_utc,
            Payment.created_at < end_exclusive_utc,
        )
    )
    payments = (await db.execute(payments_q)).scalars().all()

    collections_by_method = {
        "UPI": Decimal("0.00"),
        "CASH": Decimal("0.00"),
        "CARD": Decimal("0.00"),
        "OTHER": Decimal("0.00"),
    }
    payment_counts = {"UPI": 0, "CASH": 0, "CARD": 0, "OTHER": 0}

    for p in payments:
        method = (p.payment_method or "OTHER").upper()
        amt = d_quant(p.amount_paid)
        if method in collections_by_method:
            collections_by_method[method] += amt
            payment_counts[method] += 1
        else:
            collections_by_method["OTHER"] += amt
            payment_counts["OTHER"] += 1

    net_checkout_collections = sum(collections_by_method.values(), Decimal("0.00"))

    # 3. Verified UPI Banking Metrics (from VerifiedBankCredit)
    vbc_q = (
        select(VerifiedBankCredit)
        .where(
            VerifiedBankCredit.tenant_id == current_user.tenant_id,
            VerifiedBankCredit.verified_at >= start_utc,
            VerifiedBankCredit.verified_at < end_exclusive_utc,
        )
    )
    vbc_list = (await db.execute(vbc_q)).scalars().all()

    upi_settled_amount = Decimal("0.00")
    upi_settled_count = 0
    upi_review_amount = Decimal("0.00")
    upi_review_count = 0
    upi_failed_amount = Decimal("0.00")
    upi_failed_count = 0

    settled_utrs = set()
    for v in vbc_list:
        v_amt = d_quant(v.amount)
        st = (v.status or "").upper()
        if st == "SETTLED":
            upi_settled_amount += v_amt
            upi_settled_count += 1
            if v.utr:
                settled_utrs.add(v.utr.strip().lower())
        elif st in ("PAYMENT_REVIEW_REQUIRED", "PENDING", "REVIEW"):
            upi_review_amount += v_amt
            upi_review_count += 1
        elif st in ("FAILED", "REJECTED"):
            upi_failed_amount += v_amt
            upi_failed_count += 1

    # Check unverified UPI references in Payment ledger
    unverified_upi_records = 0
    for p in payments:
        if (p.payment_method or "").upper() == "UPI":
            ref = (p.transaction_reference or "").strip().lower()
            if not ref or ref not in settled_utrs:
                unverified_upi_records += 1

    # 4. Total Recorded Expenses from Purchase Orders
    po_q = (
        select(PurchaseOrder)
        .options(selectinload(PurchaseOrder.supplier))
        .where(
            PurchaseOrder.tenant_id == current_user.tenant_id,
            or_(
                and_(
                    PurchaseOrder.invoice_date.isnot(None),
                    PurchaseOrder.invoice_date >= start,
                    PurchaseOrder.invoice_date <= end,
                ),
                and_(
                    PurchaseOrder.invoice_date.is_(None),
                    PurchaseOrder.created_at >= start_utc,
                    PurchaseOrder.created_at < end_exclusive_utc,
                ),
            )
        )
    )
    pos = (await db.execute(po_q)).scalars().all()

    received_expenses = Decimal("0.00")
    received_count = 0
    ordered_commitments = Decimal("0.00")
    ordered_count = 0
    supplier_expenses: Dict[str, Decimal] = {}

    for po in pos:
        c = d_quant(po.total_cost)
        st = (po.status or "DRAFT").upper()
        s_name = po.supplier.name if po.supplier else "Uncategorized Supplier"

        if st == "RECEIVED":
            received_expenses += c
            received_count += 1
            supplier_expenses[s_name] = supplier_expenses.get(s_name, Decimal("0.00")) + c
        elif st == "ORDERED":
            ordered_commitments += c
            ordered_count += 1

    # 5. Outstanding Receivables (Unpaid Bills)
    unpaid_bills_q = (
        select(Bill)
        .where(
            Bill.tenant_id == current_user.tenant_id,
            Bill.created_at >= start_utc,
            Bill.created_at < end_exclusive_utc,
            Bill.is_paid == False,
        )
    )
    unpaid_bills = (await db.execute(unpaid_bills_q)).scalars().all()
    outstanding_amount = d_quant(sum((b.total_amount for b in unpaid_bills), Decimal("0.00")))
    unpaid_bills_count = len(unpaid_bills)

    # 6. Reservations & Advance Sales
    res_q = (
        select(Reservation)
        .where(
            Reservation.tenant_id == current_user.tenant_id,
            Reservation.reservation_date >= start,
            Reservation.reservation_date <= end,
        )
    )
    reservations = (await db.execute(res_q)).scalars().all()

    total_res_count = len(reservations)
    res_status_counts: Dict[str, int] = {}
    advance_collected = Decimal("0.00")

    for r in reservations:
        st = (r.status or "CONFIRMED").upper()
        res_status_counts[st] = res_status_counts.get(st, 0) + 1
        if (getattr(r, "payment_status", "") or "").upper() == "PAID":
            advance_collected += d_quant(r.advance_amount)

    aov = Decimal("0.00")
    if completed_bills_count > 0:
        aov = (total_dining_consumption / Decimal(completed_bills_count)).quantize(Decimal("0.01"))

    # 7. Profit & Loss: Strict Accounting Clarity
    # Recipe COGS is pending complete recipe-inventory linking.
    # Provisional operating surplus = Total Dining Consumption minus Received Purchases.
    provisional_surplus = total_dining_consumption - received_expenses

    return {
        "period": {
            "start": start.isoformat(),
            "end": end.isoformat(),
            "duration_days": period_days,
            "prior_start": prior_start.isoformat(),
            "prior_end": prior_end.isoformat(),
        },
        "revenue": {
            "gross_sales": str(gross_subtotal),
            "gross_subtotal": str(gross_subtotal),
            "discounts": str(discounts),
            "taxes": str(taxes),
            "total_dining_consumption": str(total_dining_consumption),
            "reservation_credits_applied": str(reservation_credits),
            "net_pos_checkout_due": str(net_pos_checkout_due),
            "net_sales": str(total_dining_consumption),
            "prior_net_sales": str(prior_dining_consumption),
            "revenue_growth_pct": revenue_growth_pct,
            "completed_bills_count": completed_bills_count,
            "aov": str(aov),
            "accounting_note": "Total Dining Consumption reflects all served orders (₹1,200). When an advance reservation deposit is credited (₹500), Net POS Checkout Due is the remaining balance (₹700).",
        },
        "collections": {
            "net_collections": str(net_checkout_collections),
            "net_checkout_collections": str(net_checkout_collections),
            "advance_deposits_collected": str(advance_collected),
            "total_funds_collected": str(net_checkout_collections + advance_collected),
            "by_method": {k: str(d_quant(v)) for k, v in collections_by_method.items()},
            "counts_by_method": payment_counts,
        },
        "upi_reconciliation": {
            "verified_settled_amount": str(upi_settled_amount),
            "verified_settled_count": upi_settled_count,
            "review_required_amount": str(upi_review_amount),
            "review_required_count": upi_review_count,
            "failed_amount": str(upi_failed_amount),
            "failed_count": upi_failed_count,
            "payment_ledger_upi_amount": str(collections_by_method["UPI"]),
            "unverified_upi_records_count": unverified_upi_records,
        },
        "petty_cash": {
            "is_configured": False,
            "status": "NOT_CONFIGURED",
            "opening_balance": None,
            "closing_balance": None,
            "cash_inflows": None,
            "cash_outflows": None,
            "audit_note": "A dedicated petty cash ledger does not currently exist in the database. Balance is reported as unconfigured without fabricating data.",
        },
        "expenses": {
            "received_expenses": str(received_expenses),
            "received_count": received_count,
            "ordered_commitments": str(ordered_commitments),
            "ordered_count": ordered_count,
            "suppliers_breakdown": {k: str(v) for k, v in supplier_expenses.items()},
        },
        "profit_and_loss": {
            "status": "PROVISIONAL",
            "calculation_basis": "Total Dining Consumption minus Received Supplier Purchases",
            "net_sales": str(total_dining_consumption),
            "cost_basis_amount": str(received_expenses),
            "provisional_surplus": str(provisional_surplus),
            "is_provisional": True,
            "disclosure": "Direct dish-by-dish Recipe Cost of Goods Sold (COGS) is pending comprehensive inventory item linkage. This figure represents operational cash-flow surplus over received purchases, not final audited net profit.",
        },
        "outstanding": {
            "amount": str(outstanding_amount),
            "count": unpaid_bills_count,
        },
        "reservations": {
            "total_count": total_res_count,
            "by_status": res_status_counts,
            "advance_collected": str(advance_collected),
        },
    }


@router.get("/analytics")
async def get_manager_analytics(
    start: Optional[datetime.date] = Query(None, description="Start date (YYYY-MM-DD) in IST"),
    end: Optional[datetime.date] = Query(None, description="End date (YYYY-MM-DD) in IST"),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Analytics timeseries, payment distributions, top-selling items,
    and supplier breakdowns using timezone-accurate half-open UTC boundaries.
    """
    today_ist = ist_now().date()
    if not end:
        end = today_ist
    if not start:
        start = end - datetime.timedelta(days=13)  # Default last 14 days

    if end < start:
        raise HTTPException(status_code=400, detail="End date must be greater than or equal to start date.")
    if (end - start).days > 366:
        raise HTTPException(status_code=400, detail="Date range cannot exceed 366 days.")

    start_utc, end_exclusive_utc = ist_date_to_utc_bounds(start, end)

    # 1. Fetch Paid Bills for the date range
    bills_q = (
        select(Bill)
        .where(
            Bill.tenant_id == current_user.tenant_id,
            Bill.created_at >= start_utc,
            Bill.created_at < end_exclusive_utc,
            Bill.is_paid == True,
        )
    )
    paid_bills = (await db.execute(bills_q)).scalars().all()

    # 2. Fetch Payments for the date range
    payments_q = (
        select(Payment)
        .join(Bill, Payment.bill_id == Bill.id)
        .where(
            Bill.tenant_id == current_user.tenant_id,
            Payment.created_at >= start_utc,
            Payment.created_at < end_exclusive_utc,
        )
    )
    payments = (await db.execute(payments_q)).scalars().all()

    # 3. Fetch Received Purchases for the date range
    po_q = (
        select(PurchaseOrder)
        .options(selectinload(PurchaseOrder.supplier))
        .where(
            PurchaseOrder.tenant_id == current_user.tenant_id,
            or_(
                and_(
                    PurchaseOrder.invoice_date.isnot(None),
                    PurchaseOrder.invoice_date >= start,
                    PurchaseOrder.invoice_date <= end,
                ),
                and_(
                    PurchaseOrder.invoice_date.is_(None),
                    PurchaseOrder.created_at >= start_utc,
                    PurchaseOrder.created_at < end_exclusive_utc,
                ),
            ),
            PurchaseOrder.status == "RECEIVED",
        )
    )
    pos = (await db.execute(po_q)).scalars().all()

    # Map daily entries in Asia/Kolkata
    day_map: Dict[datetime.date, Dict[str, Any]] = {}
    curr = start
    while curr <= end:
        day_map[curr] = {
            "date": curr.isoformat(),
            "formatted_date": curr.strftime("%d %b"),
            "gross_sales": Decimal("0.00"),
            "net_sales": Decimal("0.00"),
            "checkout_due": Decimal("0.00"),
            "collections": Decimal("0.00"),
            "orders_count": 0,
            "expenses": Decimal("0.00"),
        }
        curr += datetime.timedelta(days=1)

    for b in paid_bills:
        if b.created_at:
            b_ist_date = b.created_at.replace(tzinfo=datetime.timezone.utc).astimezone(IST).date()
            if b_ist_date in day_map:
                day_map[b_ist_date]["gross_sales"] += d_quant(b.subtotal)
                day_map[b_ist_date]["net_sales"] += d_quant(b.subtotal - b.discount_amount + b.tax_amount)
                day_map[b_ist_date]["checkout_due"] += d_quant(b.total_amount)
                day_map[b_ist_date]["orders_count"] += 1

    for p in payments:
        if p.created_at:
            p_ist_date = p.created_at.replace(tzinfo=datetime.timezone.utc).astimezone(IST).date()
            if p_ist_date in day_map:
                day_map[p_ist_date]["collections"] += d_quant(p.amount_paid)

    for po in pos:
        po_date = po.invoice_date or (po.created_at.replace(tzinfo=datetime.timezone.utc).astimezone(IST).date() if po.created_at else None)
        if po_date and po_date in day_map:
            day_map[po_date]["expenses"] += d_quant(po.total_cost)

    time_series = [
        {
            "date": v["date"],
            "formatted_date": v["formatted_date"],
            "gross_sales": str(v["gross_sales"]),
            "net_sales": str(v["net_sales"]),
            "checkout_due": str(v["checkout_due"]),
            "collections": str(v["collections"]),
            "orders_count": v["orders_count"],
            "expenses": str(v["expenses"]),
            "provisional_surplus": str(v["net_sales"] - v["expenses"]),
        }
        for k, v in sorted(day_map.items())
    ]

    # Payment method breakdown
    method_totals: Dict[str, Decimal] = {"UPI": Decimal("0.00"), "CASH": Decimal("0.00"), "CARD": Decimal("0.00"), "OTHER": Decimal("0.00")}
    method_counts: Dict[str, int] = {"UPI": 0, "CASH": 0, "CARD": 0, "OTHER": 0}

    for p in payments:
        m = (p.payment_method or "OTHER").upper()
        target = m if m in method_totals else "OTHER"
        method_totals[target] += d_quant(p.amount_paid)
        method_counts[target] += 1

    total_pay = sum(method_totals.values(), Decimal("0.00"))
    payment_methods_summary = []
    for m, val in method_totals.items():
        share = float((val / total_pay * Decimal("100")).quantize(Decimal("0.1"))) if total_pay > Decimal("0.00") else 0.0
        payment_methods_summary.append({
            "method": m,
            "amount": str(val),
            "count": method_counts[m],
            "share_pct": share,
        })

    # Top selling menu items based on actual completed orders
    item_stats_q = (
        select(MenuItem.name, MenuCategory.name.label("category_name"), MenuItem.price, func.sum(OrderItem.quantity).label("total_qty"), func.sum(OrderItem.subtotal).label("total_revenue"))
        .join(OrderItem, OrderItem.menu_item_id == MenuItem.id)
        .join(Order, OrderItem.order_id == Order.id)
        .outerjoin(MenuCategory, MenuItem.category_id == MenuCategory.id)
        .where(
            Order.tenant_id == current_user.tenant_id,
            Order.created_at >= start_utc,
            Order.created_at < end_exclusive_utc,
            Order.status.in_(["SERVED", "COMPLETED", "DELIVERED", "CONFIRMED"]),
        )
        .group_by(MenuItem.id, MenuItem.name, MenuCategory.name, MenuItem.price)
        .order_by(desc("total_revenue"))
        .limit(10)
    )
    items_res = (await db.execute(item_stats_q)).all()

    top_items = []
    for name, cat, price, qty, rev in items_res:
        top_items.append({
            "name": name,
            "category": cat or "General",
            "price": str(d_quant(price)),
            "quantity": int(qty or 0),
            "revenue": str(d_quant(rev)),
        })

    # Expense analysis by supplier
    suppliers_q = (
        select(Supplier.name, func.sum(PurchaseOrder.total_cost).label("total_cost"), func.count(PurchaseOrder.id).label("po_count"))
        .join(PurchaseOrder, PurchaseOrder.supplier_id == Supplier.id)
        .where(
            PurchaseOrder.tenant_id == current_user.tenant_id,
            or_(
                and_(
                    PurchaseOrder.invoice_date.isnot(None),
                    PurchaseOrder.invoice_date >= start,
                    PurchaseOrder.invoice_date <= end,
                ),
                and_(
                    PurchaseOrder.invoice_date.is_(None),
                    PurchaseOrder.created_at >= start_utc,
                    PurchaseOrder.created_at < end_exclusive_utc,
                ),
            ),
            PurchaseOrder.status == "RECEIVED",
        )
        .group_by(Supplier.id, Supplier.name)
        .order_by(desc("total_cost"))
    )
    supp_res = (await db.execute(suppliers_q)).all()
    expense_suppliers = [
        {
            "supplier_name": name,
            "total_cost": str(d_quant(tot)),
            "po_count": int(count or 0),
        }
        for name, tot, count in supp_res
    ]

    # Reservation analytics
    res_analytics_q = (
        select(Reservation.status, func.count(Reservation.id).label("count"), func.sum(Reservation.guest_count).label("guests"))
        .where(
            Reservation.tenant_id == current_user.tenant_id,
            Reservation.reservation_date >= start,
            Reservation.reservation_date <= end,
        )
        .group_by(Reservation.status)
    )
    res_analytics = [
        {"status": row[0] or "UNKNOWN", "count": int(row[1] or 0), "guest_count": int(row[2] or 0)}
        for row in (await db.execute(res_analytics_q)).all()
    ]

    return {
        "period": {"start": start.isoformat(), "end": end.isoformat()},
        "time_series": time_series,
        "payment_methods": payment_methods_summary,
        "top_items": top_items,
        "expense_suppliers": expense_suppliers,
        "reservation_analytics": res_analytics,
    }


@router.get("/payments")
async def get_manager_payments(
    start: Optional[datetime.date] = Query(None, description="Start date (YYYY-MM-DD) in IST"),
    end: Optional[datetime.date] = Query(None, description="End date (YYYY-MM-DD) in IST"),
    method: Optional[str] = Query(None, description="Filter by method: UPI, CASH, CARD"),
    search: Optional[str] = Query(None, description="Search by reference, bill ID, or amount"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Paginated, audited payment ledger with verification matching against VerifiedBankCredit.
    Uses half-open UTC timestamp bounds based on Asia/Kolkata dates.
    """
    today_ist = ist_now().date()
    if not end:
        end = today_ist
    if not start:
        start = end - datetime.timedelta(days=30)  # Default 30 days for payment audit

    start_utc, end_exclusive_utc = ist_date_to_utc_bounds(start, end)

    # Base query on Payment scoped to current tenant via Bill
    conditions = [
        Bill.tenant_id == current_user.tenant_id,
        Payment.created_at >= start_utc,
        Payment.created_at < end_exclusive_utc,
    ]

    if method and method.strip():
        conditions.append(func.upper(Payment.payment_method) == method.strip().upper())

    if search and search.strip():
        s = f"%{search.strip()}%"
        conditions.append(
            or_(
                Payment.transaction_reference.ilike(s),
                Payment.idempotency_key.ilike(s),
                func.cast(Payment.bill_id, String).ilike(s),
            )
        )

    # Count total
    count_q = select(func.count(Payment.id)).join(Bill, Payment.bill_id == Bill.id).where(*conditions)
    total_count = (await db.execute(count_q)).scalar() or 0

    # Paged items
    items_q = (
        select(Payment)
        .join(Bill, Payment.bill_id == Bill.id)
        .options(selectinload(Payment.bill).selectinload(Bill.dining_session))
        .where(*conditions)
        .order_by(desc(Payment.created_at))
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    payments = (await db.execute(items_q)).scalars().all()

    # Pre-fetch VerifiedBankCredit for any transaction references
    refs = [p.transaction_reference.strip().lower() for p in payments if p.transaction_reference]
    vbc_map = {}
    if refs:
        vbc_q = select(VerifiedBankCredit).where(
            VerifiedBankCredit.tenant_id == current_user.tenant_id,
            func.lower(VerifiedBankCredit.utr).in_(refs),
        )
        for v in (await db.execute(vbc_q)).scalars().all():
            vbc_map[v.utr.strip().lower()] = v

    items = []
    for p in payments:
        ref_key = (p.transaction_reference or "").strip().lower()
        matched_vbc = vbc_map.get(ref_key)
        bill = p.bill
        session = bill.dining_session if bill else None

        items.append({
            "id": p.id,
            "bill_id": p.bill_id,
            "dining_session_id": session.id if session else None,
            "table_id": session.table_id if session else None,
            "payment_method": p.payment_method,
            "amount_paid": str(d_quant(p.amount_paid)),
            "transaction_reference": p.transaction_reference,
            "idempotency_key": p.idempotency_key,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "is_bill_paid": bill.is_paid if bill else False,
            "is_verified_bank_credit": matched_vbc is not None,
            "verification_status": matched_vbc.status if matched_vbc else ("VERIFIED_CASH" if (p.payment_method or "").upper() == "CASH" else "UNVERIFIED_REFERENCE"),
            "verification_provider": matched_vbc.provider_source if matched_vbc else None,
            "verified_at": matched_vbc.verified_at.isoformat() if matched_vbc and matched_vbc.verified_at else None,
        })

    # Summary totals for the filtered range
    total_paid_res = (
        await db.execute(
            select(func.coalesce(func.sum(Payment.amount_paid), Decimal("0.00")))
            .join(Bill, Payment.bill_id == Bill.id)
            .where(*conditions)
        )
    ).scalar() or Decimal("0.00")

    return {
        "period": {"start": start.isoformat(), "end": end.isoformat()},
        "total_count": total_count,
        "page": page,
        "page_size": page_size,
        "total_pages": (total_count + page_size - 1) // page_size if page_size > 0 else 1,
        "filtered_total_amount": str(d_quant(total_paid_res)),
        "items": items,
    }


@router.get("/petty-cash")
async def get_petty_cash_status(
    current_user: User = Depends(require_manager_or_admin),
):
    """
    Honest, auditable disclosure of Petty Cash status per Section 7 of instructions.
    No fabricated balances or fake ledger entries.
    """
    return {
        "is_configured": False,
        "status": "NOT_CONFIGURED",
        "opening_balance": None,
        "closing_balance": None,
        "inflows": None,
        "outflows": None,
        "adjustments": None,
        "message": "Petty cash ledger is not configured in the active database schema.",
        "proposed_schema": {
            "table_name": "petty_cash_transactions",
            "columns": [
                {"name": "id", "type": "Integer", "primary_key": True},
                {"name": "transaction_type", "type": "String(20)", "enum": ["INFLOW", "OUTFLOW", "ADJUSTMENT"]},
                {"name": "amount", "type": "Numeric(10, 2)", "nullable": False},
                {"name": "category", "type": "String(50)", "description": "Expense category (Dairy, Veg, Gas, Ice, Misc)"},
                {"name": "description", "type": "String(255)", "nullable": False},
                {"name": "reference_number", "type": "String(100)", "nullable": True},
                {"name": "performed_by_user_id", "type": "Integer", "foreign_key": "users.id"},
                {"name": "created_at", "type": "DateTime", "default": "utc_now"},
            ],
            "migration_required": True,
            "status": "AWAITING_USER_APPROVAL",
        },
    }
