"""005_multi_tenancy_core

Revision ID: 005_multi_tenancy_core
Revises: 004_reservation_cols
Create Date: 2026-10-17 02:00:00.000000

Multi-tenancy core architecture migration:
- Ensures root tenants table exists with full metadata.
- Adds tenant_id column with RESTRICT foreign keys to root business entities.
- Child entities (order_items, table_qr, payments, recipe_items) inherit tenant ownership through parent FK.
- Safely backfills existing records to 'restrova-default' tenant.
- Drops obsolete global unique constraints and replaces with composite tenant-scoped unique constraints.
"""
from typing import Sequence, Union
import uuid
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '005_multi_tenancy_core'
down_revision: Union[str, None] = '004_reservation_cols'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DEFAULT_TENANT_ID = uuid.UUID('23395d5e-16e5-4eb6-9214-cc63f05c3210')
DEFAULT_TENANT_SLUG = 'restrova-default'

ROOT_TENANT_TABLES = [
    'users',
    'branches',
    'menu_categories',
    'menu_items',
    'tables',
    'orders',
    'bills',
    'reservations',
    'inventory_items',
    'suppliers',
    'purchase_orders',
    'customers',
    'feedback',
    'notifications',
    'audit_logs',
    'verified_bank_credits',
    'daily_production_rules',
    'reservation_capacity_rules',
    'item_capacity_rules',
    'system_settings',
]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    # 1. Ensure tenants table exists
    if 'tenants' not in existing_tables:
        op.create_table(
            'tenants',
            sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
            sa.Column('slug', sa.String(64), unique=True, nullable=False),
            sa.Column('name', sa.String(128), nullable=False),
            sa.Column('custom_domain', sa.String(255), unique=True, nullable=True),
            sa.Column('logo_url', sa.String(512), nullable=True),
            sa.Column('favicon_url', sa.String(512), nullable=True),
            sa.Column('hero_image_url', sa.String(512), nullable=True),
            sa.Column('hero_video_url', sa.String(512), nullable=True),
            sa.Column('tagline', sa.String(255), nullable=True),
            sa.Column('about_text', sa.Text(), nullable=True),
            sa.Column('primary_color', sa.String(16), default='#2B1810'),
            sa.Column('secondary_color', sa.String(16), default='#F7F4EE'),
            sa.Column('accent_color', sa.String(16), default='#C86D51'),
            sa.Column('phone', sa.String(32), nullable=True),
            sa.Column('email', sa.String(128), nullable=True),
            sa.Column('address', sa.Text(), nullable=True),
            sa.Column('google_maps_url', sa.String(512), nullable=True),
            sa.Column('reservation_closed_weekdays', sa.String(32), default='1,2'),
            sa.Column('reservation_open_time', sa.String(8), default='11:00'),
            sa.Column('reservation_last_slot_time', sa.String(8), default='22:30'),
            sa.Column('deposit_per_guest', sa.Numeric(10, 2), default=150.00),
            sa.Column('merchant_upi_id', sa.String(128), nullable=True),
            sa.Column('merchant_name', sa.String(128), nullable=True),
            sa.Column('razorpay_key_id', sa.String(128), nullable=True),
            sa.Column('razorpay_key_secret', sa.String(256), nullable=True),
            sa.Column('razorpay_webhook_secret', sa.String(256), nullable=True),
            sa.Column('allow_online_payments', sa.Boolean(), default=True),
            sa.Column('plan_tier', sa.String(32), default='TRIAL'),
            sa.Column('subscription_status', sa.String(32), default='ACTIVE'),
            sa.Column('trial_ends_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('current_period_end', sa.DateTime(timezone=True), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index('idx_tenants_slug', 'tenants', ['slug'], unique=True)
        op.create_index('idx_tenants_custom_domain', 'tenants', ['custom_domain'], unique=True)

    # 2. Ensure restrova-default tenant row exists
    bind.execute(sa.text(f"""
        INSERT INTO tenants (id, slug, name, plan_tier, subscription_status, created_at, updated_at)
        VALUES ('{DEFAULT_TENANT_ID}', '{DEFAULT_TENANT_SLUG}', 'Restrova Default Cafe', 'ENTERPRISE', 'ACTIVE', NOW(), NOW())
        ON CONFLICT (slug) DO NOTHING;
    """))

    # 3. Add tenant_id column (ON DELETE RESTRICT to protect audit & financial records)
    for table in ROOT_TENANT_TABLES:
        if table in existing_tables:
            columns = {c['name'] for c in inspector.get_columns(table)}
            if 'tenant_id' not in columns:
                op.add_column(
                    table,
                    sa.Column(
                        'tenant_id',
                        postgresql.UUID(as_uuid=True),
                        sa.ForeignKey('tenants.id', ondelete='RESTRICT'),
                        nullable=True,
                    )
                )

    # 4. Backfill all existing records in root business tables to default tenant
    for table in ROOT_TENANT_TABLES:
        if table in existing_tables:
            bind.execute(sa.text(f"""
                UPDATE {table} SET tenant_id = '{DEFAULT_TENANT_ID}' WHERE tenant_id IS NULL;
            """))

    # 5. Enforce NOT NULL and create tenant indexes
    for table in ROOT_TENANT_TABLES:
        if table in existing_tables:
            op.alter_column(table, 'tenant_id', nullable=False)
            idx_name = f'idx_{table}_tenant_id'
            existing_indexes = {idx['name'] for idx in inspector.get_indexes(table)}
            if idx_name not in existing_indexes:
                op.create_index(idx_name, table, ['tenant_id'])

    # 6. Replace global unique constraints with composite tenant-scoped constraints
    bind.execute(sa.text("DROP INDEX IF EXISTS ix_users_username;"))
    bind.execute(sa.text("ALTER TABLE IF EXISTS users DROP CONSTRAINT IF EXISTS users_username_key;"))
    bind.execute(sa.text("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_tenant_username ON users (tenant_id, username);"))

    # Tables: ensure non-unique lookup index on tenant tables without restricting multi-floor identical table numbers
    bind.execute(sa.text("ALTER TABLE IF EXISTS tables DROP CONSTRAINT IF EXISTS tables_table_number_key;"))
    bind.execute(sa.text("DROP INDEX IF EXISTS ix_tables_table_number;"))
    bind.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_tables_tenant_lookup ON tables (tenant_id, branch_id, table_number);"))

    bind.execute(sa.text("ALTER TABLE IF EXISTS menu_categories DROP CONSTRAINT IF EXISTS menu_categories_name_key;"))
    bind.execute(sa.text("DROP INDEX IF EXISTS ix_menu_categories_name;"))
    bind.execute(sa.text("CREATE UNIQUE INDEX IF NOT EXISTS uq_menu_cat_tenant_name ON menu_categories (tenant_id, name);"))

    bind.execute(sa.text("ALTER TABLE IF EXISTS inventory_items DROP CONSTRAINT IF EXISTS inventory_items_sku_key;"))
    bind.execute(sa.text("DROP INDEX IF EXISTS ix_inventory_items_sku;"))
    bind.execute(sa.text("CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_tenant_sku ON inventory_items (tenant_id, sku);"))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    # Revert composite constraints
    try:
        op.drop_constraint('uq_users_tenant_username', 'users', type_='unique')
        op.create_unique_constraint('users_username_key', 'users', ['username'])
    except Exception:
        pass

    try:
        op.drop_index('idx_tables_tenant_lookup', table_name='tables')
    except Exception:
        pass

    try:
        op.drop_constraint('uq_menu_cat_tenant_name', 'menu_categories', type_='unique')
        op.create_unique_constraint('menu_categories_name_key', 'menu_categories', ['name'])
    except Exception:
        pass

    try:
        op.drop_constraint('uq_inventory_tenant_sku', 'inventory_items', type_='unique')
        op.create_unique_constraint('inventory_items_sku_key', 'inventory_items', ['sku'])
    except Exception:
        pass

    # Drop tenant_id from root tables
    for table in ROOT_TENANT_TABLES:
        if table in existing_tables:
            columns = {c['name'] for c in inspector.get_columns(table)}
            if 'tenant_id' in columns:
                idx_name = f'idx_{table}_tenant_id'
                try:
                    op.drop_index(idx_name, table_name=table)
                except Exception:
                    pass
                op.drop_column(table, 'tenant_id')
