import datetime
from decimal import Decimal
from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.utils.helpers import utc_now


class Recipe(Base):
    __tablename__ = "recipes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    menu_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("menu_items.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)

    menu_item = relationship("MenuItem", back_populates="recipes")
    items = relationship("RecipeItem", back_populates="recipe", cascade="all, delete-orphan")


class RecipeItem(Base):
    __tablename__ = "recipe_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    recipe_id: Mapped[int] = mapped_column(Integer, ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False)
    inventory_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("inventory_items.id", ondelete="RESTRICT"), nullable=False)
    quantity_required: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)

    recipe = relationship("Recipe", back_populates="items")
    inventory_item = relationship("InventoryItem", back_populates="recipe_items")


import uuid
from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

class InventoryItem(Base):
    __tablename__ = "inventory_items"
    __table_args__ = (
        UniqueConstraint("tenant_id", "sku", name="uq_inventory_tenant_sku"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="RESTRICT"),
        default=uuid.UUID("23395d5e-16e5-4eb6-9214-cc63f05c3210"),
        nullable=False,
        index=True,
    )
    sku: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    unit_of_measure: Mapped[str] = mapped_column(String(20), nullable=False)  # kg, g, l, ml, pcs, etc.
    current_stock: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=Decimal("0.0000"), nullable=False)
    reorder_threshold: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=Decimal("10.0000"), nullable=False)

    recipe_items = relationship("RecipeItem", back_populates="inventory_item")
    transactions = relationship("InventoryTransaction", back_populates="inventory_item")
    po_items = relationship("PurchaseOrderItem", back_populates="inventory_item")
    tenant = relationship("Tenant", foreign_keys=[tenant_id])


class InventoryTransaction(Base):
    __tablename__ = "inventory_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    inventory_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False)
    transaction_type: Mapped[str] = mapped_column(String(30), nullable=False)  # PURCHASE, SALE_CONSUMPTION, ADJUSTMENT, WASTE, RETURN, TRANSFER, INITIAL_STOCK
    quantity_change: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    reference_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=utc_now, nullable=False)

    inventory_item = relationship("InventoryItem", back_populates="transactions")
