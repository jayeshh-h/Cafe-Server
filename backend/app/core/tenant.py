import logging
import uuid
from typing import Optional
from fastapi import Request, HTTPException, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.models.tenant import Tenant
from app.core.config import settings

logger = logging.getLogger("restrova.tenant")

DEFAULT_TENANT_SLUG = "restrova-default"
DEFAULT_TENANT_ID = uuid.UUID("23395d5e-16e5-4eb6-9214-cc63f05c3210")


def extract_tenant_slug(request: Request, x_tenant_slug: Optional[str] = None) -> Optional[str]:
    """Extract tenant slug from Host subdomain, custom domain, or development overrides."""
    host = request.headers.get("host", "").lower().split(":")[0]

    # 1. Handle standard subdomain: e.g. "luna.restrova.com"
    if ".restrova.com" in host:
        subdomain = host.split(".restrova.com")[0]
        if subdomain and subdomain not in ("www", "api", "app", "demo-api", "status"):
            return subdomain

    is_dev = settings.APP_ENV == "development" or host in ("localhost", "127.0.0.1", "testserver", "test")

    # 2. In development / testing environments, allow header and query parameter overrides
    if is_dev:
        if x_tenant_slug:
            return x_tenant_slug.strip().lower()
        header_slug = request.headers.get("x-tenant-slug")
        if header_slug:
            return header_slug.strip().lower()
        query_slug = request.query_params.get("tenant")
        if query_slug:
            return query_slug.strip().lower()
        return DEFAULT_TENANT_SLUG

    # 3. In production, never silently fall back to default tenant and never accept untrusted client headers
    return None


async def get_current_tenant(
    request: Request,
    x_tenant_slug: Optional[str] = Header(None, alias="X-Tenant-Slug"),
    db: AsyncSession = Depends(get_db),
) -> Tenant:
    """Dependency that mandates an active, valid Tenant context."""
    slug = extract_tenant_slug(request, x_tenant_slug)
    tenant = None

    if slug:
        res = await db.execute(select(Tenant).where(Tenant.slug == slug))
        tenant = res.scalar_one_or_none()

    if not tenant:
        # Check custom domain fallback
        host = request.headers.get("host", "").lower().split(":")[0]
        if host and host not in ("localhost", "127.0.0.1", "restrova.com", "api.restrova.com", "app.restrova.com", "testserver", "test"):
            res_domain = await db.execute(select(Tenant).where(Tenant.custom_domain == host))
            tenant = res_domain.scalar_one_or_none()

    if not tenant:
        raise HTTPException(
            status_code=400 if not slug else 404,
            detail=f"Café tenant '{slug}' not found on Restrova." if slug else "Tenant context required. Visit via tenant subdomain or configure custom domain.",
        )

    if tenant.subscription_status not in ("ACTIVE", "TRIAL"):
        raise HTTPException(
            status_code=402,
            detail="Café subscription expired or inactive. Please contact support to renew.",
        )

    return tenant


async def get_optional_tenant(
    request: Request,
    x_tenant_slug: Optional[str] = Header(None, alias="X-Tenant-Slug"),
    db: AsyncSession = Depends(get_db),
) -> Optional[Tenant]:
    """Dependency that attempts to resolve a tenant if present, otherwise returns None."""
    try:
        return await get_current_tenant(request, x_tenant_slug, db)
    except HTTPException:
        return None
