import os
import asyncio
import pytest
import pytest_asyncio
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.pool import NullPool
from app.core.database import Base
from app.main import app
from app.core.config import settings

# Legacy suite uses fixed calendar dates; booking-rule checks are covered in test_booking_rules.py
settings.BOOKING_RULES_ENFORCED = False
from app.api.deps import get_db
from httpx import AsyncClient, ASGITransport

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "sqlite+aiosqlite:///cafe_test.db"
)

connect_args = {"check_same_thread": False} if "sqlite" in TEST_DATABASE_URL else {}
# NullPool: pytest-asyncio gives every test its own event loop, and pooled connections
# would otherwise be reused on a loop that has already closed ("Event loop is closed").
engine = create_async_engine(TEST_DATABASE_URL, echo=False, connect_args=connect_args, poolclass=NullPool)
TestingSessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)


import uuid
from app.models.tenant import Tenant

DEFAULT_TENANT_ID = uuid.UUID("23395d5e-16e5-4eb6-9214-cc63f05c3210")


@pytest_asyncio.fixture(scope="function")
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with TestingSessionLocal() as session:
        default_tenant = Tenant(
            id=DEFAULT_TENANT_ID,
            name="Restrova Default",
            slug="restrova-default",
            custom_domain="localhost",
            subscription_status="ACTIVE",
            plan_tier="ENTERPRISE",
            primary_color="#2B1810",
        )
        session.add(default_tenant)
        await session.commit()
        yield session

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


from app.api.deps import get_db, get_current_user
from app.models.user import User, Role


@pytest_asyncio.fixture(scope="function")
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    async def override_get_db():
        yield db_session

    async def override_get_current_user():
        return User(
            id=1,
            tenant_id=DEFAULT_TENANT_ID,
            username="test_cashier",
            email="cashier@example.com",
            is_active=True,
            role=Role(id=1, name="Admin"),
        )

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()

from unittest.mock import patch

@pytest.fixture(autouse=True)
def mock_celery_send_task():
    with patch("app.workers.celery_app.celery_app.send_task") as mock:
        yield mock


class _AllowAllRateLimiter:
    """Stand-in for the gateway's Redis counter: the real client is bound to the first test's
    event loop (pytest-asyncio gives each test its own), and all tests would share one budget."""

    async def incr(self, key):
        return 1

    async def expire(self, key, seconds):
        return True


@pytest.fixture(autouse=True)
def isolated_rate_limiter(monkeypatch):
    import app.main as main_module

    monkeypatch.setattr(main_module, "_gateway_redis", _AllowAllRateLimiter())
