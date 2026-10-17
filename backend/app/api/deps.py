from typing import AsyncGenerator, Callable, List, Optional
from fastapi import Depends, HTTPException, Header, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import AsyncSessionLocal, get_db
from app.core.security import decode_token
from app.core.tenant import get_current_tenant
from app.models.tenant import Tenant
from app.models.user import User, Role, Permission
from app.models.table import DiningSession, Table

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


async def get_current_user(
    db: AsyncSession = Depends(get_db),
    token: Optional[str] = Depends(oauth2_scheme),
    current_tenant: Tenant = Depends(get_current_tenant),
) -> User:
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials were not provided.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 1. Enforce cross-tenant JWT claim barrier
    token_tenant_id = payload.get("tenant_id")
    if token_tenant_id and str(token_tenant_id) != str(current_tenant.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cross-tenant access forbidden: Token was issued for a different tenant.",
        )

    user_id_str = payload.get("sub")
    if not user_id_str or not user_id_str.isdigit():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload subject.",
        )
    user_id = int(user_id_str)

    # 2. Scope query strictly to the current tenant
    query = (
        select(User)
        .options(selectinload(User.role))
        .where(
            User.id == user_id,
            User.tenant_id == current_tenant.id,
            User.is_active == True,
        )
    )
    result = await db.execute(query)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or account is deactivated for this tenant.",
        )
    return user


def require_permission(required_permission: str) -> Callable:
    async def permission_checker(
        current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
    ) -> User:
        # Check attached role object without triggering lazy load
        role = current_user.__dict__.get("role")
        if not role and current_user.role_id:
            role_query = select(Role).where(Role.id == current_user.role_id)
            role_res = await db.execute(role_query)
            role = role_res.scalar_one_or_none()

        if role and role.name:
            role_name_lower = role.name.lower()
            # Admin, Owner, Cashier, POS, Manager have access to POS operations
            if role_name_lower in ["admin", "owner", "pos", "cashier", "manager"]:
                return current_user

        if not current_user.role_id and not role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: Required permission '{required_permission}'.",
            )

        # Fetch role permissions from DB
        rid = current_user.role_id or (role.id if role else 0)
        try:
            query = (
                select(Permission.code)
                .join(Role.permissions)
                .where(Role.id == rid)
            )
            result = await db.execute(query)
            permissions = result.scalars().all()
        except Exception:
            permissions = []

        if required_permission not in permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: Missing required permission '{required_permission}'.",
            )
        return current_user

    return permission_checker


async def verify_dining_session_access(
    id: int,
    db: AsyncSession = Depends(get_db),
    x_session_token: Optional[str] = Header(None, alias="X-Session-Token"),
    token: Optional[str] = Depends(oauth2_scheme),
) -> DiningSession:
    """
    Ensures authorized session access:
    1. Authenticated staff with POS/Admin permissions can access any dining session.
    2. Customer must present matching X-Session-Token and session must not be closed.
    """
    session = await db.get(DiningSession, id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dining session not found.",
        )

    # 1. Check if caller is authenticated staff member
    if token:
        try:
            payload = decode_token(token)
            if payload and payload.get("type") == "access":
                uid = payload.get("sub")
                if uid and str(uid).isdigit():
                    u_res = await db.execute(
                        select(User).options(selectinload(User.role)).where(User.id == int(uid), User.is_active == True)
                    )
                    user = u_res.scalar_one_or_none()
                    if user:
                        table = await db.get(Table, session.table_id)
                        if table and user.tenant_id != table.tenant_id:
                            raise HTTPException(
                                status_code=status.HTTP_403_FORBIDDEN,
                                detail="Access denied: Cannot access another tenant's dining session.",
                            )
                        role = user.__dict__.get("role")
                        if not role and user.role_id:
                            r_res = await db.execute(select(Role).where(Role.id == user.role_id))
                            role = r_res.scalar_one_or_none()
                        if role and role.name and role.name.lower() in ["admin", "owner", "pos", "cashier", "manager"]:
                            return session
                        rid = user.role_id or (role.id if role else 0)
                        if rid:
                            q = select(Permission.code).join(Role.permissions).where(Role.id == rid)
                            perms = (await db.execute(q)).scalars().all()
                            if "pos:access" in perms:
                                return session
        except HTTPException:
            raise
        except Exception:
            pass

    # 2. Customer access verification via X-Session-Token
    if not x_session_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session authentication required. Please provide X-Session-Token header.",
        )

    if session.session_token != x_session_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Invalid session token for this dining session.",
        )

    if session.status == "CLOSED":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="SESSION_EXPIRED: Dining session is closed or expired.",
        )

    return session


async def verify_dining_session_close_access(
    id: int,
    db: AsyncSession = Depends(get_db),
    x_session_token: Optional[str] = Header(None, alias="X-Session-Token"),
    token: Optional[str] = Depends(oauth2_scheme),
) -> DiningSession:
    """
    Ensures authorized session close:
    1. Authenticated staff with POS/Admin permissions can close any session.
    2. Customer can only close their OWN active dining session (matching X-Session-Token).
    3. Customer attempting to close another session receives 403 Forbidden.
    """
    session = await db.get(DiningSession, id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dining session not found.",
        )

    if token:
        try:
            payload = decode_token(token)
            if payload and payload.get("type") == "access":
                uid = payload.get("sub")
                if uid and str(uid).isdigit():
                    u_res = await db.execute(
                        select(User).options(selectinload(User.role)).where(User.id == int(uid), User.is_active == True)
                    )
                    user = u_res.scalar_one_or_none()
                    if user:
                        table = await db.get(Table, session.table_id)
                        if table and user.tenant_id != table.tenant_id:
                            raise HTTPException(
                                status_code=status.HTTP_403_FORBIDDEN,
                                detail="Access denied: Cannot close another tenant's dining session.",
                            )
                        role = user.__dict__.get("role")
                        if not role and user.role_id:
                            r_res = await db.execute(select(Role).where(Role.id == user.role_id))
                            role = r_res.scalar_one_or_none()
                        if role and role.name and role.name.lower() in ["admin", "owner", "pos", "cashier", "manager"]:
                            return session
                        rid = user.role_id or (role.id if role else 0)
                        if rid:
                            q = select(Permission.code).join(Role.permissions).where(Role.id == rid)
                            perms = (await db.execute(q)).scalars().all()
                            if "pos:access" in perms:
                                return session
        except HTTPException:
            raise
        except Exception:
            pass

    if not x_session_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session authentication required. Please provide X-Session-Token header.",
        )

    if session.session_token != x_session_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Cannot close another table's dining session.",
        )

    return session
