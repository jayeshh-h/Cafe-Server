import datetime
from decimal import Decimal
import uuid
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, LargeBinary, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.utils.helpers import utc_now


class MenuCategory(Base):
    __tablename__ = "menu_categories"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_menu_cat_tenant_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="RESTRICT"),
        default=uuid.UUID("23395d5e-16e5-4eb6-9214-cc63f05c3210"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    items = relationship("MenuItem", back_populates="category")
    tenant = relationship("Tenant", foreign_keys=[tenant_id])


class MenuItem(Base):
    __tablename__ = "menu_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="RESTRICT"),
        default=uuid.UUID("23395d5e-16e5-4eb6-9214-cc63f05c3210"),
        nullable=False,
        index=True,
    )
    category_id: Mapped[int] = mapped_column(Integer, ForeignKey("menu_categories.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("5.00"), nullable=False)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    # Versioned URL of the uploaded dish photo (None = use the website's default picture)
    image_url: Mapped[str | None] = mapped_column(String(255), nullable=True)

    category = relationship("MenuCategory", back_populates="items")
    capacity_rule = relationship("ItemCapacityRule", back_populates="menu_item", uselist=False)
    kitchen_mappings = relationship("MenuItemKitchenMapping", back_populates="menu_item")
    recipes = relationship("Recipe", back_populates="menu_item")
    order_items = relationship("OrderItem", back_populates="menu_item")
    tenant = relationship("Tenant", foreign_keys=[tenant_id])


class MenuItemImage(Base):
    """Dish photo bytes, kept in the database because Render's disk is wiped on every deploy."""
    __tablename__ = "menu_item_images"

    menu_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("menu_items.id", ondelete="CASCADE"), primary_key=True)
    content_type: Mapped[str] = mapped_column(String(50), nullable=False)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)
