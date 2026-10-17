from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_db, oauth2_scheme
from app.core.security import decode_token
from app.models.user import User, Role, Permission
from app.models.order import Order
from app.models.table import DiningSession
from app.schemas.order import OrderCreate, OrderResponse
from app.services.order_service import OrderService

router = APIRouter(prefix="/orders", tags=["Orders"])


@router.post("", response_model=OrderResponse, status_code=201)
async def create_order(data: OrderCreate, db: AsyncSession = Depends(get_db)):
    return await OrderService.place_order(db, data)


@router.get("/{id}", response_model=OrderResponse)
async def get_order(
    id: int,
    db: AsyncSession = Depends(get_db),
    x_session_token: Optional[str] = Header(None, alias="X-Session-Token"),
    token: Optional[str] = Depends(oauth2_scheme),
):
    query = select(Order).where(Order.id == id)
    result = await db.execute(query)
    order = result.scalar_one_or_none()

    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Order #{id} not found.",
        )

    # 1. Staff check
    if token:
        try:
            payload = decode_token(token)
            if payload and payload.get("type") == "access":
                uid = payload.get("sub")
                if uid and str(uid).isdigit():
                    u_res = await db.execute(select(User).where(User.id == int(uid), User.is_active == True))
                    user = u_res.scalar_one_or_none()
                    if user:
                        if user.tenant_id != order.tenant_id:
                            raise HTTPException(
                                status_code=status.HTTP_403_FORBIDDEN,
                                detail="Access denied: Cannot access an order belonging to another tenant.",
                            )
                        role = getattr(user, "role", None)
                        if not role and user.role_id:
                            r_res = await db.execute(select(Role).where(Role.id == user.role_id))
                            role = r_res.scalar_one_or_none()
                        if role and role.name and role.name.lower() in ["admin", "owner", "pos", "cashier", "manager"]:
                            return order
                        rid = user.role_id or (role.id if role else 0)
                        if rid:
                            q = select(Permission.code).join(Role.permissions).where(Role.id == rid)
                            perms = (await db.execute(q)).scalars().all()
                            if "pos:access" in perms:
                                return order
        except HTTPException:
            raise
        except Exception:
            pass

    # 2. Customer check
    if not x_session_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session authentication required. Provide X-Session-Token header.",
        )

    session = await db.get(DiningSession, order.dining_session_id)
    if not session or session.session_token != x_session_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Cannot access order from another table session.",
        )

    return order
