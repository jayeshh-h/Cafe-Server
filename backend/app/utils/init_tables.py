import logging
import uuid
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.table import Table, TableQR
from app.models.branch import Branch
from app.models.tenant import Tenant

logger = logging.getLogger("cafe_piza.init_tables")

DEFAULT_TABLES = [
    # Floor 1: Ground floor (3 tables: 4-seater, 4-seater, 2-seater)
    {"id": 1, "table_number": "Table 1", "capacity": 4, "floor_number": 1, "floor_name": "Ground floor", "qr_token": "qr_sec_b7ba9c59d35e4074a30034abb48ee0a9"},
    {"id": 2, "table_number": "Table 2", "capacity": 4, "floor_number": 1, "floor_name": "Ground floor", "qr_token": "qr_sec_c2a8e419f72b491295e865f12a14e9b2"},
    {"id": 3, "table_number": "Table 3", "capacity": 2, "floor_number": 1, "floor_name": "Ground floor", "qr_token": "qr_sec_8d1a3b5c7e9f02468ace13579bdf2468"},
    # Floor 2: School room (3 tables: 6-seater, 4-seater, 2-seater)
    {"id": 4, "table_number": "Table 1", "capacity": 6, "floor_number": 2, "floor_name": "School room", "qr_token": "qr_sec_9e2b4c6d8f0a13579bdf2468ace13579"},
    {"id": 5, "table_number": "Table 2", "capacity": 4, "floor_number": 2, "floor_name": "School room", "qr_token": "qr_sec_0f3c5d7e9a1b2468ace13579bdf2468a"},
    {"id": 6, "table_number": "Table 3", "capacity": 2, "floor_number": 2, "floor_name": "School room", "qr_token": "qr_sec_1a4d6e8f0b2c3579bdf2468ace13579b"},
    # Floor 3: Balcony (2 tables: two 2-seaters)
    {"id": 7, "table_number": "Table 1", "capacity": 2, "floor_number": 3, "floor_name": "Balcony", "qr_token": "qr_sec_2b5e7f9a1c3d468ace13579bdf2468ac"},
    {"id": 8, "table_number": "Table 2", "capacity": 2, "floor_number": 3, "floor_name": "Balcony", "qr_token": "qr_sec_3c6f8a0b2d4e579bdf2468ace13579bd"},
    # Floor 4: Lower top (2 tables: 4-seater, 6-seater)
    {"id": 9, "table_number": "Table 1", "capacity": 4, "floor_number": 4, "floor_name": "Lower top", "qr_token": "qr_sec_4d7a9b1c3e5f68ace13579bdf2468ace"},
    {"id": 10, "table_number": "Table 2", "capacity": 6, "floor_number": 4, "floor_name": "Lower top", "qr_token": "qr_sec_5e8b0c2d4f6a79bdf2468ace13579bdf"},
    # Floor 5: Top top (3 tables: 6-seater, 4-seater, 2-seater)
    {"id": 11, "table_number": "Table 1", "capacity": 6, "floor_number": 5, "floor_name": "Top top", "qr_token": "qr_sec_6f9c1d3e5a7b8ace13579bdf2468ace1"},
    {"id": 12, "table_number": "Table 2", "capacity": 4, "floor_number": 5, "floor_name": "Top top", "qr_token": "qr_sec_7a0d2e4f6b8c9bdf2468ace13579bdf2"},
    {"id": 13, "table_number": "Table 3", "capacity": 2, "floor_number": 5, "floor_name": "Top top", "qr_token": "qr_sec_8b1e3f5a7c9d0bdf2468ace13579bdf3"},
]


async def ensure_default_tables(db: AsyncSession, tenant_id: Optional[uuid.UUID] = None) -> None:
    """
    Idempotently ensures default tables (1 to 13) and their secure TableQR tokens
    exist in the database across all environments (Render / Local).
    """
    target_tenant_id = tenant_id
    if not target_tenant_id:
        t_res = await db.execute(select(Tenant).where(Tenant.slug == "restrova-default"))
        t = t_res.scalar_one_or_none()
        if not t:
            t_res = await db.execute(select(Tenant))
            t = t_res.scalar_one_or_none()
        target_tenant_id = t.id if t else uuid.UUID("23395d5e-16e5-4eb6-9214-cc63f05c3210")

    branch_res = await db.execute(select(Branch).where(Branch.tenant_id == target_tenant_id))
    branch = branch_res.scalar_one_or_none()
    if not branch:
        branch = Branch(
            tenant_id=target_tenant_id,
            name="Jaadoo Udaipur",
            address="32 Sitaphal ki gali, Ganesh Ghati, Udaipur",
            phone="+919876543210",
        )
        db.add(branch)
        await db.flush()
    else:
        branch.address = "32 Sitaphal ki gali, Ganesh Ghati, Udaipur"

    for dt in DEFAULT_TABLES:
        # Check if table exists by ID
        tbl_res = await db.execute(
            select(Table).where(Table.id == dt["id"], Table.tenant_id == target_tenant_id)
        )
        tbl = tbl_res.scalar_one_or_none()

        if not tbl:
            tbl = Table(
                id=dt["id"],
                tenant_id=target_tenant_id,
                branch_id=branch.id,
                table_number=dt["table_number"],
                capacity=dt["capacity"],
                status="Available",
            )
            db.add(tbl)
            await db.flush()
        else:
            tbl.table_number = dt["table_number"]
            tbl.capacity = dt["capacity"]

        # Check if TableQR exists for this table
        qr_res = await db.execute(select(TableQR).where(TableQR.table_id == tbl.id))
        qr = qr_res.scalar_one_or_none()

        if not qr:
            # Also check if token is taken
            token_res = await db.execute(select(TableQR).where(TableQR.qr_token == dt["qr_token"]))
            if not token_res.scalar_one_or_none():
                qr = TableQR(table_id=tbl.id, qr_token=dt["qr_token"], is_active=True)
                db.add(qr)
        else:
            if not qr.is_active:
                qr.is_active = True

    # Never delete anything here: tables added from admin and replaced ("rotated") QR codes
    # must survive restarts and deploys. (This used to remove both on every startup.)
    await db.commit()
    logger.info("Default tables and secure TableQR tokens ensured.")
