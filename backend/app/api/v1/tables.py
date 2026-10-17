import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_db, require_permission, verify_dining_session_access, verify_dining_session_close_access
from app.core.tenant import get_current_tenant
from app.models.tenant import Tenant
from app.models.user import User

# Table list and QR tokens are staff-only: a QR token grants access to that table's session and bill
STAFF_ONLY = [Depends(require_permission("pos:access"))]
from app.models.table import Table, TableQR, DiningSession
from app.schemas.table import (
    TableCreate,
    TableResponse,
    TableQRResponse,
    QRValidateRequest,
    QRValidateResponse,
    QRWalkInRequest,
    QRWalkInResponse,
    DiningSessionResponse,
    SessionBillResponse,
    GeneralizedQRResponse,
    GeneralizedQRListResponse,
    ToggleQRStatusRequest,
    ClaimReservationRequest,
    ClaimReservationResponse,
)
from app.services.table_service import TableService

router = APIRouter(prefix="/tables", tags=["Tables & QR Sessions"])
sessions_router = APIRouter(prefix="/sessions", tags=["Dining Sessions"])


@router.get("/qr/generalized", response_model=GeneralizedQRListResponse, dependencies=STAFF_ONLY)
async def get_generalized_qrs(db: AsyncSession = Depends(get_db)):
    return await TableService.get_generalized_qrs(db)


@router.post("/qr/generalized/generate", response_model=GeneralizedQRResponse, dependencies=STAFF_ONLY)
async def generate_fresh_generalized_qr(db: AsyncSession = Depends(get_db)):
    return await TableService.generate_fresh_generalized_qr(db)


@router.post("/qr/generalized/toggle-status", response_model=GeneralizedQRResponse, dependencies=STAFF_ONLY)
async def toggle_qr_status(body: ToggleQRStatusRequest, db: AsyncSession = Depends(get_db)):
    return await TableService.toggle_qr_status(db, qr_token=body.qr_token, qr_id=body.id, is_active=body.is_active)


@router.delete("/qr/generalized", dependencies=STAFF_ONLY)
async def delete_generalized_qr(
    qr_token: str = None,
    id: int = None,
    db: AsyncSession = Depends(get_db)
):
    return await TableService.delete_generalized_qr(db, qr_token=qr_token, qr_id=id)


@router.post("/qr/claim-reservation", response_model=ClaimReservationResponse)
async def claim_reservation(body: ClaimReservationRequest, db: AsyncSession = Depends(get_db)):
    return await TableService.claim_reservation(
        db=db,
        qr_token=body.qr_token,
        session_token=body.session_token,
        reservation_code=body.reservation_code,
    )


@router.get("", response_model=List[TableResponse], dependencies=STAFF_ONLY)
async def list_tables(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("pos:access")),
):
    from sqlalchemy.orm import selectinload
    query = (
        select(Table)
        .options(selectinload(Table.qr_code))
        .where(Table.tenant_id == current_user.tenant_id)
        .order_by(Table.id)
    )
    result = await db.execute(query)
    return result.scalars().all()


@router.post("", response_model=TableResponse, status_code=201, dependencies=STAFF_ONLY)
async def add_table(
    body: TableCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("pos:access")),
):
    import secrets
    from sqlalchemy.orm import selectinload
    from app.models.branch import Branch

    branch = (
        await db.execute(select(Branch).where(Branch.tenant_id == current_user.tenant_id).order_by(Branch.id))
    ).scalars().first()
    if not branch:
        raise HTTPException(status_code=400, detail="No branch is set up yet.")
    tables = (
        await db.execute(select(Table).where(Table.tenant_id == current_user.tenant_id))
    ).scalars().all()
    taken = [t.floor_table_num for t in tables if t.floor_number == body.floor_number]
    all_tables_overall = (await db.execute(select(Table))).scalars().all()
    next_id = max((t.id for t in all_tables_overall), default=0) + 1
    table = Table(
        id=next_id,
        tenant_id=current_user.tenant_id,
        branch_id=branch.id,
        table_number=f"Table {max(taken, default=0) + 1}",
        capacity=body.capacity,
        status="Available",
        floor=body.floor_number,
    )
    db.add(table)
    await db.flush()
    db.add(TableQR(table_id=table.id, qr_token=f"qr_sec_{secrets.token_hex(16)}", is_active=True))
    await db.commit()
    return (await db.execute(select(Table).options(selectinload(Table.qr_code)).where(Table.id == table.id))).scalar_one()


@router.delete("/{id}", dependencies=STAFF_ONLY)
async def remove_table(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("pos:access")),
):
    """Remove a table added from admin by mistake. Only allowed if it was never used, so no bill history is lost."""
    from sqlalchemy import func
    from app.models.kot import KOT
    from app.models.reservation import Reservation

    table = await db.get(Table, id)
    if not table or table.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Table not found.")
    if not table.floor:
        raise HTTPException(status_code=400, detail="The original tables can't be removed.")
    used = sum(
        [
            (await db.execute(select(func.count(DiningSession.id)).where(DiningSession.table_id == id))).scalar() or 0,
            (await db.execute(select(func.count(KOT.id)).where(KOT.table_id == id))).scalar() or 0,
            (await db.execute(select(func.count(Reservation.id)).where(Reservation.table_id == id))).scalar() or 0,
        ]
    )
    if used:
        raise HTTPException(status_code=409, detail=f"{table.table_number} has orders or bookings, so it can't be removed.")
    qr = (await db.execute(select(TableQR).where(TableQR.table_id == id))).scalar_one_or_none()
    if qr:
        await db.delete(qr)
    await db.delete(table)
    await db.commit()
    return {"removed": id}


@router.get("/{id}/qr", response_model=TableQRResponse, dependencies=STAFF_ONLY)
async def get_table_qr(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("pos:access")),
):
    table = await db.get(Table, id)
    if not table or table.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Table not found.")
    query = select(TableQR).where(TableQR.table_id == id, TableQR.is_active == True)
    result = await db.execute(query)
    qr = result.scalar_one_or_none()
    if not qr:
        qr = await TableService.rotate_qr_token(db, id)
    return qr


@router.post("/{id}/qr/rotate", response_model=TableQRResponse, dependencies=STAFF_ONLY)
async def rotate_table_qr(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("pos:access")),
):
    table = await db.get(Table, id)
    if not table or table.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Table not found.")
    return await TableService.rotate_qr_token(db, id)


@router.post("/qr/validate", response_model=QRValidateResponse)
async def validate_qr(
    body: QRValidateRequest,
    db: AsyncSession = Depends(get_db),
    current_tenant: Tenant = Depends(get_current_tenant),
):
    return await TableService.validate_qr_token(db, body.qr_token, expected_tenant_id=current_tenant.id)


# ponytail: walk-in guest registration creates reservation and seats session immediately
@router.post("/qr/walk-in", response_model=QRWalkInResponse)
async def walk_in_qr(
    body: QRWalkInRequest,
    db: AsyncSession = Depends(get_db),
    current_tenant: Tenant = Depends(get_current_tenant),
):
    return await TableService.create_walk_in_reservation(
        db=db,
        qr_token=body.qr_token,
        customer_name=body.customer_name,
        phone_number=body.phone_number,
        guest_count=body.guest_count or 2,
        expected_tenant_id=current_tenant.id,
    )


@router.post("/qr/session", response_model=DiningSessionResponse)
async def get_or_create_session_by_qr(
    body: QRValidateRequest,
    db: AsyncSession = Depends(get_db),
    current_tenant: Tenant = Depends(get_current_tenant),
):
    val = await TableService.validate_qr_token(db, body.qr_token, expected_tenant_id=current_tenant.id)
    session = await TableService.get_or_create_dining_session(db, val.table_id)
    return session


@sessions_router.get("/{id}", response_model=DiningSessionResponse)
async def get_dining_session(
    id: int,
    session: DiningSession = Depends(verify_dining_session_access),
):
    return session


@sessions_router.get("/{id}/bill", response_model=SessionBillResponse)
async def get_session_bill(
    id: int,
    db: AsyncSession = Depends(get_db),
    session: DiningSession = Depends(verify_dining_session_access),
):
    return await TableService.get_session_bill(db, id)


@sessions_router.post("/{id}/close", response_model=DiningSessionResponse)
async def close_session(
    id: int,
    db: AsyncSession = Depends(get_db),
    session: DiningSession = Depends(verify_dining_session_close_access),
):
    return await TableService.close_dining_session(db, id)


router.include_router(sessions_router)

