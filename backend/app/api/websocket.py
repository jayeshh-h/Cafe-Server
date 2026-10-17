import json
import logging
from typing import Dict, Optional, Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import uuid
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.security import decode_token
from app.models.tenant import Tenant

logger = logging.getLogger("restrova.websocket")
router = APIRouter(tags=["WebSockets"])


class ConnectionManager:
    VALID_CHANNELS = {"kitchen", "pos", "orders", "tables", "menu", "admin"}
    STAFF_CHANNELS = {"kitchen", "pos", "orders", "admin"}

    def __init__(self):
        # Structure: tenant_slug -> { channel -> Set[WebSocket] }
        self.tenant_channels: Dict[str, Dict[str, Set[WebSocket]]] = {}

    def _get_tenant_set(self, tenant_slug: str, channel: str) -> Set[WebSocket]:
        if tenant_slug not in self.tenant_channels:
            self.tenant_channels[tenant_slug] = {c: set() for c in self.VALID_CHANNELS}
        return self.tenant_channels[tenant_slug].setdefault(channel, set())

    @property
    def channels(self) -> Dict[str, Set[WebSocket]]:
        """Backwards compatibility for inspection."""
        combined: Dict[str, Set[WebSocket]] = {c: set() for c in self.VALID_CHANNELS}
        for t_map in self.tenant_channels.values():
            for c, s in t_map.items():
                if c in combined:
                    combined[c].update(s)
        return combined

    async def connect(self, websocket: WebSocket, channel: str, tenant_slug: str = "restrova-default"):
        await websocket.accept()
        if channel in self.VALID_CHANNELS:
            s = self._get_tenant_set(tenant_slug, channel)
            s.add(websocket)

    def disconnect(self, websocket: WebSocket, channel: str, tenant_slug: str = "restrova-default"):
        if tenant_slug in self.tenant_channels and channel in self.tenant_channels[tenant_slug]:
            self.tenant_channels[tenant_slug][channel].discard(websocket)

    async def broadcast(self, channel: str, message: dict, tenant_slug: Optional[str] = None):
        payload = json.dumps(message)
        target_slug = tenant_slug or message.get("tenant_slug") or "restrova-default"

        targets = []
        if target_slug and target_slug in self.tenant_channels:
            targets = [self.tenant_channels[target_slug].get(channel, set())]

        for sock_set in targets:
            dead_sockets = set()
            for connection in list(sock_set):
                try:
                    await connection.send_text(payload)
                except Exception:
                    dead_sockets.add(connection)
            for dead in dead_sockets:
                sock_set.discard(dead)


ws_manager = ConnectionManager()


@router.websocket("/ws/{channel}")
async def websocket_endpoint(websocket: WebSocket, channel: str):
    if channel not in ConnectionManager.VALID_CHANNELS:
        await websocket.close(code=4000, reason="Invalid WebSocket channel.")
        return

    # 1. Staff channels require authenticated access token
    tenant_slug = "restrova-default"
    token = websocket.query_params.get("token")
    if not token:
        auth_header = websocket.headers.get("authorization")
        if auth_header and auth_header.lower().startswith("bearer "):
            token = auth_header[7:].strip()

    if channel in ConnectionManager.STAFF_CHANNELS:
        if not token:
            await websocket.close(code=4001, reason="Authentication required for staff WebSocket channel.")
            return
        payload = decode_token(token)
        if not payload or payload.get("type") != "access":
            await websocket.close(code=4001, reason="Invalid or expired access token.")
            return

        token_tenant_id = payload.get("tenant_id")
        user_id = payload.get("sub")
        if not token_tenant_id or not user_id:
            await websocket.close(code=4001, reason="Invalid token claims.")
            return

        async with AsyncSessionLocal() as session:
            try:
                t_stmt = select(Tenant).where(Tenant.id == uuid.UUID(str(token_tenant_id)))
                t_res = await session.execute(t_stmt)
                tenant = t_res.scalar_one_or_none()
                if not tenant or tenant.subscription_status not in ("ACTIVE", "TRIAL"):
                    await websocket.close(code=4003, reason="Tenant inactive or not found.")
                    return
                tenant_slug = tenant.slug
            except Exception:
                await websocket.close(code=4001, reason="Failed to verify tenant.")
                return
    else:
        # Public guest channels (menu, tables)
        req_slug = (
            websocket.query_params.get("tenant")
            or websocket.headers.get("x-tenant-slug")
            or "restrova-default"
        ).strip().lower()
        async with AsyncSessionLocal() as session:
            try:
                t_stmt = select(Tenant).where(Tenant.slug == req_slug)
                t_res = await session.execute(t_stmt)
                tenant = t_res.scalar_one_or_none()
                if tenant and tenant.subscription_status in ("ACTIVE", "TRIAL"):
                    tenant_slug = tenant.slug
            except Exception:
                tenant_slug = "restrova-default"

    await ws_manager.connect(websocket, channel, tenant_slug=tenant_slug)
    try:
        while True:
            data = await websocket.receive_text()
            await websocket.send_text(json.dumps({"type": "PONG", "received": data, "tenant": tenant_slug}))
    except Exception:
        pass
    finally:
        ws_manager.disconnect(websocket, channel, tenant_slug=tenant_slug)
