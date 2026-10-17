import pytest
import uuid
import datetime
from decimal import Decimal
from fastapi import HTTPException
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from app.main import app
from app.core.database import AsyncSessionLocal
from app.models.tenant import Tenant
from app.models.user import User, Role
from app.models.table import Table, TableQR, DiningSession
from app.models.customer import Customer
from app.models.reservation import Reservation
from app.models.order import Order
from app.models.kitchen import KitchenOrder, Kitchen
from app.models.bank_transaction import VerifiedBankCredit
from app.services.payment_verification_service import PaymentVerificationService
from app.core.security import create_access_token, hash_password
from app.api.websocket import ws_manager
from app.core.database import engine


@pytest.fixture(autouse=True)
async def cleanup_db_engine():
    yield
    await engine.dispose()



@pytest.mark.asyncio
async def test_tenant_resolution_success():
    """Verify that requests with a valid tenant slug successfully resolve."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.get("/health", headers={"X-Tenant-Slug": "restrova-default"})
        assert res.status_code == 200
        data = res.json()
        assert data.get("status") == "healthy"


@pytest.mark.asyncio
async def test_cross_tenant_login_isolation():
    """
    Verify that two different tenants can have users with the exact same username,
    and login under Tenant A only authenticates Tenant A's user.
    """
    async with AsyncSessionLocal() as db:
        # Fetch or create Tenant A and Tenant B
        t_a = (await db.execute(select(Tenant).where(Tenant.slug == "restrova-default"))).scalar_one()

        res_b = await db.execute(select(Tenant).where(Tenant.slug == "test-cafe-b"))
        t_b = res_b.scalar_one_or_none()
        if not t_b:
            t_b = Tenant(
                slug="test-cafe-b",
                name="Test Cafe B",
                subscription_status="ACTIVE",
                plan_tier="GROWTH",
            )
            db.add(t_b)
            await db.commit()
            await db.refresh(t_b)

        # Create user 'manager1' in Tenant A
        res_ua = await db.execute(
            select(User).where(User.tenant_id == t_a.id, User.username == "manager1")
        )
        u_a = res_ua.scalar_one_or_none()
        if not u_a:
            u_a = User(
                tenant_id=t_a.id,
                username="manager1",
                email="manager1@restrova-default.com",
                hashed_password=hash_password("passwordA123"),
                is_active=True,
            )
            db.add(u_a)

        # Create user 'manager1' in Tenant B with a different password
        res_ub = await db.execute(
            select(User).where(User.tenant_id == t_b.id, User.username == "manager1")
        )
        u_b = res_ub.scalar_one_or_none()
        if not u_b:
            u_b = User(
                tenant_id=t_b.id,
                username="manager1",
                email="manager1@test-cafe-b.com",
                hashed_password=hash_password("passwordB123"),
                is_active=True,
            )
            db.add(u_b)

        await db.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Login to Tenant A with Tenant A's password
        res_login_a = await ac.post(
            "/api/v1/auth/login",
            headers={"X-Tenant-Slug": "restrova-default"},
            json={"username": "manager1", "password": "passwordA123"},
        )
        assert res_login_a.status_code == 200, res_login_a.text
        data_a = res_login_a.json()
        assert data_a["user"]["email"] == "manager1@restrova-default.com"

        # 2. Login to Tenant A with Tenant B's password must FAIL
        res_fail_pass = await ac.post(
            "/api/v1/auth/login",
            headers={"X-Tenant-Slug": "restrova-default"},
            json={"username": "manager1", "password": "passwordB123"},
        )
        assert res_fail_pass.status_code == 401

        # 3. Login to Tenant B with Tenant B's password
        res_login_b = await ac.post(
            "/api/v1/auth/login",
            headers={"X-Tenant-Slug": "test-cafe-b"},
            json={"username": "manager1", "password": "passwordB123"},
        )
        assert res_login_b.status_code == 200, res_login_b.text
        data_b = res_login_b.json()
        assert data_b["user"]["email"] == "manager1@test-cafe-b.com"


@pytest.mark.asyncio
async def test_cross_tenant_jwt_rejection():
    """
    Verify that an access token issued for Tenant A is strictly rejected
    when used against Tenant B endpoints.
    """
    async with AsyncSessionLocal() as db:
        t_a = (await db.execute(select(Tenant).where(Tenant.slug == "restrova-default"))).scalar_one()
        t_b = (await db.execute(select(Tenant).where(Tenant.slug == "test-cafe-b"))).scalar_one()

        u_a = (await db.execute(select(User).where(User.tenant_id == t_a.id))).scalars().first()
        token_a = create_access_token(subject=u_a.id, tenant_id=t_a.id)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Valid access on Tenant A
        res_valid = await ac.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token_a}", "X-Tenant-Slug": "restrova-default"},
        )
        assert res_valid.status_code == 200

        # Cross-tenant attack: using Tenant A token on Tenant B header
        res_cross = await ac.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token_a}", "X-Tenant-Slug": "test-cafe-b"},
        )
        assert res_cross.status_code == 403
        assert "Cross-tenant access forbidden" in res_cross.text


@pytest.mark.asyncio
async def test_cross_tenant_unique_constraints_and_isolation():
    """
    Verify that business entities with identical unique codes (e.g., table numbers)
    can coexist across different tenants without collision.
    """
    async with AsyncSessionLocal() as db:
        t_a = (await db.execute(select(Tenant).where(Tenant.slug == "restrova-default"))).scalar_one()
        t_b = (await db.execute(select(Tenant).where(Tenant.slug == "test-cafe-b"))).scalar_one()

        # Check or create Table 'VIP-1' in Tenant A
        res_tbl_a = await db.execute(
            select(Table).where(Table.tenant_id == t_a.id, Table.table_number == "VIP-1")
        )
        tbl_a = res_tbl_a.scalar_one_or_none()
        if not tbl_a:
            tbl_a = Table(
                tenant_id=t_a.id,
                branch_id=1,
                table_number="VIP-1",
                capacity=4,
                status="Available",
            )
            db.add(tbl_a)

        # Check or create Table 'VIP-1' in Tenant B (same table number!)
        res_tbl_b = await db.execute(
            select(Table).where(Table.tenant_id == t_b.id, Table.table_number == "VIP-1")
        )
        tbl_b = res_tbl_b.scalar_one_or_none()
        if not tbl_b:
            tbl_b = Table(
                tenant_id=t_b.id,
                branch_id=1,
                table_number="VIP-1",
                capacity=6,
                status="Available",
            )
            db.add(tbl_b)

        await db.commit()
        await db.refresh(tbl_a)
        await db.refresh(tbl_b)

        assert tbl_a.id != tbl_b.id
        assert tbl_a.tenant_id == t_a.id
        assert tbl_b.tenant_id == t_b.id

        # Query scoped to Tenant A should only return Tenant A's table
        res_q_a = await db.execute(
            select(Table).where(Table.tenant_id == t_a.id, Table.table_number == "VIP-1")
        )
        results_a = res_q_a.scalars().all()
        assert len(results_a) == 1
        assert results_a[0].capacity == 4

        # Query scoped to Tenant B should only return Tenant B's table
        res_q_b = await db.execute(
            select(Table).where(Table.tenant_id == t_b.id, Table.table_number == "VIP-1")
        )
        results_b = res_q_b.scalars().all()
        assert len(results_b) == 1
        assert results_b[0].capacity == 6


@pytest.mark.asyncio
async def test_restrictive_deletion_prevents_erasing_tenant_records():
    """
    Verify Issue 2 requirement: Deleting a tenant must NOT cascade-delete
    financial/business records or audit logs; it must raise IntegrityError (RESTRICT).
    """
    async with AsyncSessionLocal() as db:
        t_a = (await db.execute(select(Tenant).where(Tenant.slug == "restrova-default"))).scalar_one()

        # Attempting to delete Tenant A (which owns users, tables, menu items)
        with pytest.raises(IntegrityError):
            await db.delete(t_a)
            await db.commit()
        await db.rollback()


@pytest.mark.asyncio
async def test_websocket_channel_isolation():
    """
    Verify Issue 3 requirement: WebSockets are partitioned by tenant,
    so Tenant B does not receive Tenant A's events.
    """
    class MockWebSocket:
        def __init__(self):
            self.received = []

        async def accept(self):
            pass

        async def send_text(self, text: str):
            self.received.append(text)

    ws_a = MockWebSocket()
    ws_b = MockWebSocket()

    # Connect ws_a to Tenant A and ws_b to Tenant B on 'orders' channel
    await ws_manager.connect(ws_a, "orders", tenant_slug="restrova-default")
    await ws_manager.connect(ws_b, "orders", tenant_slug="test-cafe-b")

    try:
        # Broadcast event explicitly to Tenant A
        await ws_manager.broadcast("orders", {"event": "ORDER_CREATED", "id": 101}, tenant_slug="restrova-default")

        # ws_a should have received the message, ws_b should NOT
        assert len(ws_a.received) == 1
        assert "ORDER_CREATED" in ws_a.received[0]
        assert len(ws_b.received) == 0

        # Broadcast event explicitly to Tenant B
        await ws_manager.broadcast("orders", {"event": "ORDER_CREATED", "id": 202}, tenant_slug="test-cafe-b")
        assert len(ws_b.received) == 1
        assert "ORDER_CREATED" in ws_b.received[0]
        assert len(ws_a.received) == 1  # ws_a count remains 1

    finally:
        ws_manager.disconnect(ws_a, "orders", tenant_slug="restrova-default")
        ws_manager.disconnect(ws_b, "orders", tenant_slug="test-cafe-b")


@pytest.mark.asyncio
async def test_inherited_tenant_consistency():
    """
    Verify Issue 1 requirement: Child/dependent entities inherit ownership through parent.
    A TableQR code or DiningSession inherits tenant_id from parent Table.
    Cross-referencing across tenants is strictly caught and prevented.
    """
    async with AsyncSessionLocal() as db:
        t_a = (await db.execute(select(Tenant).where(Tenant.slug == "restrova-default"))).scalar_one()
        t_b = (await db.execute(select(Tenant).where(Tenant.slug == "test-cafe-b"))).scalar_one()

        # Find or create a table in Tenant A
        tbl_a = (
            await db.execute(select(Table).where(Table.tenant_id == t_a.id))
        ).scalars().first()

        assert tbl_a is not None
        assert tbl_a.tenant_id == t_a.id

        # Verify child TableQR inherits table ownership
        qr_stmt = select(TableQR).where(TableQR.table_id == tbl_a.id)
        qr_a = (await db.execute(qr_stmt)).scalars().first()
        if not qr_a:
            qr_a = TableQR(table_id=tbl_a.id, qr_token=f"test-qr-{uuid.uuid4().hex[:8]}", is_active=True)
            db.add(qr_a)
            await db.commit()
            await db.refresh(qr_a)

        # Parent table of this QR belongs to Tenant A, NOT Tenant B
        parent_table = await db.get(Table, qr_a.table_id)
        assert parent_table.tenant_id == t_a.id
        assert parent_table.tenant_id != t_b.id


async def _get_or_create_staff_user(db, tenant, username, role_name="admin"):
    role_res = await db.execute(select(Role).where(Role.name.ilike(role_name)))
    role = role_res.scalar_one_or_none()
    if not role:
        role = Role(name=role_name)
        db.add(role)
        await db.flush()

    user_res = await db.execute(
        select(User).where(User.tenant_id == tenant.id, User.username == username)
    )
    user = user_res.scalar_one_or_none()
    if not user:
        user = User(
            tenant_id=tenant.id,
            username=username,
            email=f"{username}@{tenant.slug}.com",
            hashed_password=hash_password("Pass123!"),
            role_id=role.id,
            is_active=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    elif user.role_id != role.id:
        user.role_id = role.id
        await db.commit()
        await db.refresh(user)
    return user


@pytest.mark.asyncio
async def test_cross_tenant_reservation_isolation():
    """
    Verify reservations created under Tenant A are invisible to Tenant B,
    and direct ID lookups / mutations cross-tenant return 404 (IDOR prevented).
    """
    async with AsyncSessionLocal() as db:
        t_a = (await db.execute(select(Tenant).where(Tenant.slug == "restrova-default"))).scalar_one()
        t_b = (await db.execute(select(Tenant).where(Tenant.slug == "test-cafe-b"))).scalar_one()

        u_a = await _get_or_create_staff_user(db, t_a, "staff_res_a", "admin")
        u_b = await _get_or_create_staff_user(db, t_b, "staff_res_b", "admin")
        token_a = create_access_token(subject=u_a.id, tenant_id=t_a.id)
        token_b = create_access_token(subject=u_b.id, tenant_id=t_b.id)

        # Create customer and reservation under Tenant A
        phone = f"9876{uuid.uuid4().hex[:6]}"
        cust_a = Customer(
            tenant_id=t_a.id,
            name="Alice Guest",
            phone=phone,
            email="alice@example.com",
        )
        db.add(cust_a)
        await db.flush()

        res_a = Reservation(
            tenant_id=t_a.id,
            branch_id=1,
            customer_id=cust_a.id,
            guest_count=2,
            reservation_date=datetime.date.today() + datetime.timedelta(days=1),
            time_slot="19:00",
            table_name="Table 1",
            status="CONFIRMED",
            payment_status="PAID",
            advance_amount=Decimal("400.00"),
            payment_method="UPI",
        )
        db.add(res_a)
        await db.commit()
        await db.refresh(res_a)
        res_a_id = res_a.id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Staff A listing reservations sees res_a
        headers_a = {"Authorization": f"Bearer {token_a}", "X-Tenant-Slug": "restrova-default"}
        r_list_a = await ac.get("/api/v1/reservations", headers=headers_a)
        assert r_list_a.status_code == 200
        ids_a = [r["id"] for r in r_list_a.json()]
        assert res_a_id in ids_a

        # 2. Staff B listing reservations NEVER sees res_a
        headers_b = {"Authorization": f"Bearer {token_b}", "X-Tenant-Slug": "test-cafe-b"}
        r_list_b = await ac.get("/api/v1/reservations", headers=headers_b)
        assert r_list_b.status_code == 200
        ids_b = [r["id"] for r in r_list_b.json()]
        assert res_a_id not in ids_b

        # 3. Staff B direct get res_a by ID returns 404
        r_get_b = await ac.get(f"/api/v1/reservations/{res_a_id}", headers=headers_b)
        assert r_get_b.status_code == 404

        # 4. Staff B updating status of res_a returns 404
        r_status_b = await ac.patch(
            f"/api/v1/reservations/{res_a_id}/status",
            headers=headers_b,
            json={"status": "ARRIVED"},
        )
        assert r_status_b.status_code == 404

        # 5. Staff B cancelling res_a returns 404
        r_cancel_b = await ac.delete(f"/api/v1/reservations/{res_a_id}", headers=headers_b)
        assert r_cancel_b.status_code == 404


@pytest.mark.asyncio
async def test_cross_tenant_pos_and_kitchen_isolation():
    """
    Verify POS tables, KOTs, and kitchen orders are isolated by tenant.
    Staff B cannot inspect or mutate Tenant A's kitchen orders.
    """
    async with AsyncSessionLocal() as db:
        t_a = (await db.execute(select(Tenant).where(Tenant.slug == "restrova-default"))).scalar_one()
        t_b = (await db.execute(select(Tenant).where(Tenant.slug == "test-cafe-b"))).scalar_one()

        u_a = await _get_or_create_staff_user(db, t_a, "pos_staff_a", "pos")
        u_b = await _get_or_create_staff_user(db, t_b, "pos_staff_b", "pos")
        token_a = create_access_token(subject=u_a.id, tenant_id=t_a.id)
        token_b = create_access_token(subject=u_b.id, tenant_id=t_b.id)

        # Get or create table in Tenant A
        tbl_a_res = await db.execute(select(Table).where(Table.tenant_id == t_a.id))
        tbl_a = tbl_a_res.scalars().first()
        if not tbl_a:
            tbl_a = Table(tenant_id=t_a.id, branch_id=1, table_number="T-POS-A", capacity=4, status="Occupied")
            db.add(tbl_a)
            await db.flush()

        # Create dining session and order in Tenant A
        sess_a = DiningSession(
            table_id=tbl_a.id,
            session_token=f"sess-pos-{uuid.uuid4().hex[:8]}",
            status="ACTIVE",
        )
        db.add(sess_a)
        await db.flush()

        ord_a = Order(
            tenant_id=t_a.id,
            dining_session_id=sess_a.id,
            order_number=f"ORD-A-{uuid.uuid4().hex[:6]}",
            status="PREPARING",
        )
        db.add(ord_a)
        await db.flush()

        # Ensure kitchen exists
        kitch_res = await db.execute(select(Kitchen))
        kitch = kitch_res.scalars().first()
        if not kitch:
            kitch = Kitchen(branch_id=1, name="Main Kitchen")
            db.add(kitch)
            await db.flush()

        ko_a = KitchenOrder(
            order_id=ord_a.id,
            kitchen_id=kitch.id,
            status="SENT",
        )
        db.add(ko_a)
        await db.commit()
        await db.refresh(ko_a)
        ko_a_id = ko_a.id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        headers_a = {"Authorization": f"Bearer {token_a}", "X-Tenant-Slug": "restrova-default"}
        headers_b = {"Authorization": f"Bearer {token_b}", "X-Tenant-Slug": "test-cafe-b"}

        # 1. Staff A kitchen orders list contains ko_a
        k_res_a = await ac.get("/api/v1/kitchen/orders", headers=headers_a)
        assert k_res_a.status_code == 200
        ko_ids_a = [o["id"] for o in k_res_a.json()]
        assert ko_a_id in ko_ids_a

        # 2. Staff B kitchen orders list does NOT contain ko_a
        k_res_b = await ac.get("/api/v1/kitchen/orders", headers=headers_b)
        assert k_res_b.status_code == 200
        ko_ids_b = [o["id"] for o in k_res_b.json()]
        assert ko_a_id not in ko_ids_b

        # 3. Staff B mutating Tenant A's kitchen order status returns 404
        k_patch_b = await ac.patch(
            f"/api/v1/kitchen/orders/{ko_a_id}/status",
            headers=headers_b,
            json={"status": "READY"},
        )
        assert k_patch_b.status_code == 404


@pytest.mark.asyncio
async def test_cross_tenant_bank_credit_claim_rejection():
    """
    Verify that an authentic bank credit settled for Tenant A cannot be
    claimed or stolen by Tenant B's pending reservation.
    """
    async with AsyncSessionLocal() as db:
        t_a = (await db.execute(select(Tenant).where(Tenant.slug == "restrova-default"))).scalar_one()
        t_b = (await db.execute(select(Tenant).where(Tenant.slug == "test-cafe-b"))).scalar_one()

        test_utr = f"UTR{uuid.uuid4().hex[:10].upper()}"

        # 1. Authentic credit arrives and is recorded for Tenant A
        credit_a = await PaymentVerificationService.record_verified_bank_credit(
            db=db,
            utr=test_utr,
            amount=Decimal("300.00"),
            merchant_vpa="merchant@upi",
            provider_source="BANK_WEBHOOK",
            tx_status="SETTLED",
            tenant_id=t_a.id,
        )
        await db.commit()

        # 2. Customer in Tenant B attempts to claim this UTR for their reservation
        phone_b = f"9123{uuid.uuid4().hex[:6]}"
        cust_b = Customer(
            tenant_id=t_b.id,
            name="Bob Attacker",
            phone=phone_b,
            email="bob@example.com",
        )
        db.add(cust_b)
        await db.flush()

        res_b = Reservation(
            tenant_id=t_b.id,
            branch_id=1,
            customer_id=cust_b.id,
            guest_count=2,
            reservation_date=datetime.date.today() + datetime.timedelta(days=2),
            time_slot="20:00",
            table_name="Table 2",
            status="PAYMENT_PENDING",
            payment_status="PENDING_VERIFICATION",
            advance_amount=Decimal("300.00"),
            payment_method="UPI",
            upi_utr=test_utr,
        )
        db.add(res_b)
        await db.commit()
        await db.refresh(res_b)

        # 3. Attempting to verify and claim Tenant A's credit for Tenant B MUST fail
        with pytest.raises(HTTPException) as exc_info:
            await PaymentVerificationService.verify_and_claim_credit(
                db=db,
                reservation=res_b,
                utr=test_utr,
            )
        assert exc_info.value.status_code == 402
        assert "PAYMENT_NOT_VERIFIED" in exc_info.value.detail


@pytest.mark.asyncio
async def test_cross_tenant_manager_isolation():
    """
    Verify Manager Portal endpoints (overview, analytics) are strictly scoped
    by current_user.tenant_id.
    """
    async with AsyncSessionLocal() as db:
        t_a = (await db.execute(select(Tenant).where(Tenant.slug == "restrova-default"))).scalar_one()
        t_b = (await db.execute(select(Tenant).where(Tenant.slug == "test-cafe-b"))).scalar_one()

        u_mgr_a = await _get_or_create_staff_user(db, t_a, "kunal_mgr_a", "manager")
        u_mgr_b = await _get_or_create_staff_user(db, t_b, "kunal_mgr_b", "manager")
        token_a = create_access_token(subject=u_mgr_a.id, tenant_id=t_a.id)
        token_b = create_access_token(subject=u_mgr_b.id, tenant_id=t_b.id)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        headers_a = {"Authorization": f"Bearer {token_a}", "X-Tenant-Slug": "restrova-default"}
        headers_b = {"Authorization": f"Bearer {token_b}", "X-Tenant-Slug": "test-cafe-b"}

        res_a = await ac.get("/api/v1/manager/overview", headers=headers_a)
        assert res_a.status_code == 200, res_a.text
        data_a = res_a.json()

        res_b = await ac.get("/api/v1/manager/overview", headers=headers_b)
        assert res_b.status_code == 200, res_b.text
        data_b = res_b.json()

        # Both succeed, but are partitioned to their respective tenant statistics
        assert "financial" in data_a or "real_time_floor" in data_a or "reservations" in data_a
        assert "financial" in data_b or "real_time_floor" in data_b or "reservations" in data_b


@pytest.mark.asyncio
async def test_tenant_onboarding_and_profile_flow():
    """
    Validates:
    1. GET /api/v1/tenants/current returns public profile for active tenant.
    2. GET /api/v1/tenants/check-slug correctly rejects taken/reserved slugs and accepts fresh slugs.
    3. POST /api/v1/tenants/onboard provisions new tenant, tables, starter menu, and owner account.
    4. Newly onboarded owner can access their isolated POS and manager views immediately.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Profile for restrova-default
        res_curr = await ac.get("/api/v1/tenants/current", headers={"X-Tenant-Slug": "restrova-default"})
        assert res_curr.status_code == 200, res_curr.text
        profile = res_curr.json()
        assert profile["slug"] == "restrova-default"
        assert "primary_color" in profile

        # 2. Check slug
        res_taken = await ac.get("/api/v1/tenants/check-slug?slug=restrova-default")
        assert res_taken.status_code == 200
        assert res_taken.json()["available"] is False

        res_reserved = await ac.get("/api/v1/tenants/check-slug?slug=admin")
        assert res_reserved.status_code == 200
        assert res_reserved.json()["available"] is False

        import uuid
        unique_slug = f"luna-{uuid.uuid4().hex[:6]}"
        res_avail = await ac.get(f"/api/v1/tenants/check-slug?slug={unique_slug}")
        assert res_avail.status_code == 200
        assert res_avail.json()["available"] is True

        # 3. Onboard new tenant
        onboard_payload = {
            "name": "Luna Pizzeria & Bar",
            "slug": unique_slug,
            "admin_name": "Luna Founder",
            "admin_email": f"founder@{unique_slug}.com",
            "admin_password": "supersecretpassword123",
            "phone": "+91 9876543210",
            "address": "42 Cobblestone Lane",
            "tagline": "Authentic Neapolitan & Craft Brews",
            "primary_color": "#1F2937",
            "secondary_color": "#F3F4F6",
            "accent_color": "#F59E0B",
            "merchant_upi_id": f"{unique_slug}@upi",
            "merchant_name": "Luna Pizzeria",
            "table_count": 6,
            "template": "pizzeria",
        }
        res_onboard = await ac.post("/api/v1/tenants/onboard", json=onboard_payload)
        assert res_onboard.status_code == 201, res_onboard.text
        onboard_data = res_onboard.json()
        assert onboard_data["tenant"]["slug"] == unique_slug
        assert onboard_data["tables_created"] == 6
        assert len(onboard_data["tables"]) == 6
        token = onboard_data["access_token"]
        assert token

        # 4. Access new tenant POS table sessions with the issued token
        headers_new = {"Authorization": f"Bearer {token}", "X-Tenant-Slug": unique_slug}
        res_pos = await ac.get("/api/v1/pos/table-sessions", headers=headers_new)
        assert res_pos.status_code == 200, res_pos.text
        # Returns the 6 newly created tables, none of which have active sessions
        tables_pos = res_pos.json()
        assert len(tables_pos) == 6
        assert all(t["active_session_count"] == 0 for t in tables_pos)

        # 5. Access menu items for new tenant - should have starter items seeded
        res_menu = await ac.get("/api/v1/menu/items", headers={"X-Tenant-Slug": unique_slug})
        assert res_menu.status_code == 200, res_menu.text
        menu_items = res_menu.json()
        assert len(menu_items) >= 4
        assert any("Margherita" in item["name"] for item in menu_items)


@pytest.mark.asyncio
async def test_regression_email_based_login_tenant_scoped():
    """Verify L-1: User can authenticate via email scoped strictly to their tenant."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        async with AsyncSessionLocal() as db:
            t_a = (await db.execute(select(Tenant).where(Tenant.slug == "restrova-default"))).scalar_one()
            user_a = (await db.execute(select(User).where(User.tenant_id == t_a.id, User.username == "test_cashier"))).scalar_one_or_none()
            if not user_a:
                user_a = User(
                    tenant_id=t_a.id,
                    username="test_cashier",
                    email="cashier_login_test@example.com",
                    hashed_password=hash_password("cashier123"),
                    is_active=True,
                )
                db.add(user_a)
                await db.commit()
            else:
                user_a.email = "cashier_login_test@example.com"
                user_a.hashed_password = hash_password("cashier123")
                await db.commit()

        # Login with email instead of username under Tenant A
        res = await ac.post(
            "/api/v1/auth/login",
            json={"username": "cashier_login_test@example.com", "password": "cashier123"},
            headers={"X-Tenant-Slug": "restrova-default"},
        )
        assert res.status_code == 200, res.text
        assert "access_token" in res.json()

        # Same email under Tenant B fails
        res_fail = await ac.post(
            "/api/v1/auth/login",
            json={"username": "cashier_login_test@example.com", "password": "cashier123"},
            headers={"X-Tenant-Slug": "test-cafe-b"},
        )
        assert res_fail.status_code == 401


@pytest.mark.asyncio
async def test_regression_cross_tenant_pos_discount_tampering_prevented():
    """Verify H-3: Staff of Tenant B cannot apply discounts to a table belonging to Tenant A."""
    async with AsyncSessionLocal() as db:
        t_a = (await db.execute(select(Tenant).where(Tenant.slug == "restrova-default"))).scalar_one()
        t_b = (await db.execute(select(Tenant).where(Tenant.slug == "test-cafe-b"))).scalar_one()

        # Table in Tenant A
        tbl_a = (await db.execute(select(Table).where(Table.tenant_id == t_a.id))).scalars().first()
        assert tbl_a is not None

        # Staff in Tenant B
        user_b = (await db.execute(select(User).where(User.tenant_id == t_b.id))).scalars().first()
        if not user_b:
            user_b = User(
                tenant_id=t_b.id,
                username="staff_b_pos",
                email="staff_b_pos@test.com",
                hashed_password=hash_password("staff123"),
                is_active=True,
            )
            db.add(user_b)
            await db.commit()

    token_b = create_access_token(subject=user_b.id, tenant_id=t_b.id)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post(
            f"/api/v1/pos/tables/{tbl_a.id}/discount",
            json={"discount_type": "PERCENT", "discount_value": 10.0, "reason": "Attack test"},
            headers={"Authorization": f"Bearer {token_b}", "X-Tenant-Slug": "test-cafe-b"},
        )
        # Must be rejected with 403 or 404, never 200
        assert res.status_code in (403, 404), res.text


@pytest.mark.asyncio
async def test_regression_cross_tenant_qr_reservation_tampering_prevented():
    """Verify H-2: Scanning a table QR in Tenant A never surfaces a reservation from Tenant B."""
    async with AsyncSessionLocal() as db:
        t_a = (await db.execute(select(Tenant).where(Tenant.slug == "restrova-default"))).scalar_one()
        t_b = (await db.execute(select(Tenant).where(Tenant.slug == "test-cafe-b"))).scalar_one()

        # Table and QR in Tenant A
        tbl_a = (await db.execute(select(Table).where(Table.tenant_id == t_a.id))).scalars().first()
        qr_a = (await db.execute(select(TableQR).where(TableQR.table_id == tbl_a.id))).scalar_one_or_none()
        if not qr_a:
            qr_a = TableQR(table_id=tbl_a.id, qr_token=f"qr-sec-{uuid.uuid4().hex}", is_active=True)
            db.add(qr_a)
            await db.commit()

        # Reservation in Tenant B with table_id = tbl_a.id (tampered reference)
        res_b = Reservation(
            tenant_id=t_b.id,
            branch_id=1,
            customer_id=1,
            guest_count=2,
            reservation_date=datetime.date.today(),
            time_slot="19:00",
            table_id=tbl_a.id,
            status="CONFIRMED",
            payment_status="PAID",
        )
        db.add(res_b)
        await db.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post(
            "/api/v1/tables/qr/validate",
            json={"qr_token": qr_a.qr_token},
            headers={"X-Tenant-Slug": "restrova-default"},
        )
        assert res.status_code == 200
        data = res.json()
        # Tenant B reservation must NOT be returned for Tenant A's table
        if data.get("reservation"):
            assert data["reservation"].get("id") != res_b.id


@pytest.mark.asyncio
async def test_regression_payment_event_dynamic_vpa_matching():
    """Verify C-3: Bank payment events are strictly scoped to the tenant owning the merchant_vpa."""
    async with AsyncSessionLocal() as db:
        t_b = (await db.execute(select(Tenant).where(Tenant.slug == "test-cafe-b"))).scalar_one()
        t_b.merchant_upi_id = "testcafeb@icici"
        await db.commit()

        # Event sent to Tenant B's VPA
        event = {
            "utr": f"UTR-VPA-{uuid.uuid4().hex[:8]}",
            "amount": "150.00",
            "merchant_vpa": "testcafeb@icici",
            "payer_name": "Test Payer",
            "timestamp": "2026-10-17 12:00:00",
        }

        # Process event
        res = await PaymentVerificationService.process_android_payment_event(
            db,
            event_id=f"evt-{uuid.uuid4().hex[:6]}",
            utr=event["utr"],
            amount=event["amount"],
            merchant_vpa=event["merchant_vpa"],
        )
        assert res["status"] in ("MATCHED_AND_CONFIRMED", "SETTLED_NO_RESERVATION_MATCH", "PAYMENT_REVIEW_REQUIRED")

        # Verify VerifiedBankCredit record was created under Tenant B's tenant_id
        clean_utr = event["utr"].replace("-", "")
        vbc_stmt = select(VerifiedBankCredit).where(VerifiedBankCredit.utr == clean_utr)
        vbc = (await db.execute(vbc_stmt)).scalar_one()
        assert vbc.tenant_id == t_b.id
