from fastapi import APIRouter, Depends, Header, Query
from typing import List, Optional
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_db, require_permission, verify_dining_session_access, oauth2_scheme
from app.models.user import User
from app.models.table import DiningSession
from app.models.billing import Bill
from app.schemas.billing import BillResponse, PaymentCreate, PaymentResponse
from app.services.billing_service import BillingService

router = APIRouter(prefix="/bills", tags=["POS Billing & Payments"])


@router.get("", response_model=List[dict])
async def list_customer_bills(
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("pos:access")),
):
    """List customer dining bills with session, table, discount, tax and payment info."""
    stmt = (
        select(Bill)
        .where(Bill.tenant_id == current_user.tenant_id)
        .options(
            selectinload(Bill.dining_session).selectinload(DiningSession.table),
            selectinload(Bill.dining_session).selectinload(DiningSession.customer),
            selectinload(Bill.payments),
        )
        .order_by(Bill.created_at.desc())
        .limit(limit)
    )
    res = await db.execute(stmt)
    bills = res.scalars().all()
    results = []
    for b in bills:
        pay = b.payments[-1] if b.payments else None
        tbl = b.dining_session.table if b.dining_session else None
        results.append({
            "id": b.id,
            "bill_id": f"BILL-{b.id:04d}",
            "dining_session_id": b.dining_session_id,
            "table_number": tbl.table_number if tbl else f"#{b.dining_session.table_id}" if b.dining_session else "-",
            "customer_name": b.dining_session.customer.name if (b.dining_session and b.dining_session.customer) else None,
            "subtotal": float(b.subtotal),
            "tax_amount": float(b.tax_amount),
            "discount_amount": float(b.discount_amount),
            "reservation_credit": float(b.reservation_credit),
            "total_amount": float(b.total_amount),
            "is_paid": b.is_paid,
            "payment_method": pay.payment_method if pay else "UNPAID",
            "transaction_reference": pay.transaction_reference if pay else None,
            "created_at": b.created_at.isoformat() if b.created_at else None,
        })
    return results


@router.get("/{dining_session_id}", response_model=BillResponse)
async def get_running_bill(
    dining_session_id: int,
    db: AsyncSession = Depends(get_db),
    x_session_token: Optional[str] = Header(None, alias="X-Session-Token"),
    token: Optional[str] = Depends(oauth2_scheme),
):
    await verify_dining_session_access(
        id=dining_session_id, db=db, x_session_token=x_session_token, token=token
    )
    return await BillingService.get_or_calculate_bill(db, dining_session_id)


@router.post("/{id}/checkout", response_model=PaymentResponse, status_code=201)
async def process_checkout(
    id: int,
    payment_data: PaymentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("pos:access")),
):
    bill = await db.get(Bill, id)
    if not bill or bill.tenant_id != current_user.tenant_id:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Bill not found.")
    return await BillingService.process_checkout(db, id, payment_data)
