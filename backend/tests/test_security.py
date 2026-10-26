import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.api.deps import get_db


@pytest.mark.asyncio
async def test_qr_isolation_unauthenticated_checkout_rejected(db_session):
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    
    # Client WITHOUT get_current_user override (simulating anonymous QR scanner user)
    async with AsyncClient(transport=transport, base_url="http://test") as anon_client:
        response = await anon_client.post(
            "/api/v1/bills/1/checkout",
            json={
                "payment_method": "UPI",
                "amount_paid": "500.00",
                "idempotency_key": "anon-checkout-key-1"
            },
        )
        # Must be rejected with 401 Unauthorized
        assert response.status_code == 401

    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_cors_trusted_and_untrusted_origins():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Trusted Restrova subdomain
        res1 = await client.options(
            "/health",
            headers={
                "Origin": "https://tenant-cafe.restrova.com",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert res1.headers.get("access-control-allow-origin") == "https://tenant-cafe.restrova.com"
        assert res1.headers.get("access-control-allow-credentials") == "true"

        # 2. Trusted apex domain
        res2 = await client.options(
            "/health",
            headers={
                "Origin": "https://restrova.com",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert res2.headers.get("access-control-allow-origin") == "https://restrova.com"

        # 3. Trusted staging subdomain
        res3 = await client.options(
            "/health",
            headers={
                "Origin": "https://staging.restrova.com",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert res3.headers.get("access-control-allow-origin") == "https://staging.restrova.com"

        # 4. Untrusted malicious origin
        res4 = await client.options(
            "/health",
            headers={
                "Origin": "https://malicious-phishing.com",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert "access-control-allow-origin" not in res4.headers
