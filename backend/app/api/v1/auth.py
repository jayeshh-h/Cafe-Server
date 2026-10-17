from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.api.deps import get_db, get_current_user
from app.core.tenant import get_current_tenant
from app.models.tenant import Tenant
from app.core.security import create_access_token, create_refresh_token, verify_password, decode_token
from app.models.user import User, Role, Permission
from app.schemas.auth import LoginRequest, RefreshRequest, Token, UserResponse, RoleResponse, PermissionResponse

router = APIRouter(prefix="/auth", tags=["Authentication"])


async def _get_user_response(user: User, db: AsyncSession) -> UserResponse:
    role_resp = None
    if user.role_id:
        try:
            r_res = await db.execute(
                select(Role).options(selectinload(Role.permissions)).where(Role.id == user.role_id)
            )
            role = r_res.scalar_one_or_none()
            if role:
                perms = [
                    PermissionResponse(id=p.id, code=p.code, description=p.description)
                    for p in (role.permissions or [])
                ]
                role_resp = RoleResponse(id=role.id, name=role.name, permissions=perms)
        except Exception:
            role_resp = None

    return UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        is_active=user.is_active,
        role=role_resp,
        created_at=user.created_at,
    )


@router.post("/login", response_model=Token)
async def login(
    data: LoginRequest,
    db: AsyncSession = Depends(get_db),
    current_tenant: Tenant = Depends(get_current_tenant),
):
    try:
        uname = (data.username or "").strip()
        result = await db.execute(
            select(User).where(
                or_(User.username.ilike(uname), User.email.ilike(uname)),
                User.tenant_id == current_tenant.id,
            )
        )
        user = result.scalar_one_or_none()

        if not user or not verify_password(data.password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect username or password.",
            )
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account is inactive.",
            )

        access_token = create_access_token(subject=user.id, tenant_id=current_tenant.id)
        refresh_token = create_refresh_token(subject=user.id, tenant_id=current_tenant.id)
        user_response = await _get_user_response(user, db)
        return Token(access_token=access_token, refresh_token=refresh_token, user=user_response)
    except HTTPException:
        raise
    except Exception as e:
        from app.core.logging import logger
        logger.error(f"Login processing error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Login processing error. Please try again.",
        )


@router.post("/refresh", response_model=Token)
async def refresh(
    data: RefreshRequest,
    db: AsyncSession = Depends(get_db),
    current_tenant: Tenant = Depends(get_current_tenant),
):
    # Token comes in the body (not the URL) so it never lands in access logs
    payload = decode_token(data.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token.",
        )
    token_tenant_id = payload.get("tenant_id")
    if token_tenant_id and str(token_tenant_id) != str(current_tenant.id):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Cross-tenant refresh token is not valid for current tenant.",
        )
    user_id = payload.get("sub")
    user = await db.get(User, int(user_id)) if user_id and str(user_id).isdigit() else None
    if not user or not user.is_active or str(user.tenant_id) != str(current_tenant.id):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account not found or inactive in this tenant.",
        )
    new_access = create_access_token(subject=user_id, tenant_id=current_tenant.id)
    new_refresh = create_refresh_token(subject=user_id, tenant_id=current_tenant.id)
    return Token(access_token=new_access, refresh_token=new_refresh)


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await _get_user_response(current_user, db)


