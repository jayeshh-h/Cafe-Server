import datetime
from decimal import Decimal
import uuid
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.utils.helpers import utc_now


class Bill(Base):
    __tablename__ = "bills"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="RESTRICT"),
        default=uuid.UUID("23395d5e-16e5-4eb6-9214-cc63f05c3210"),
        nullable=False,
        index=True,
    )
    dining_session_id: Mapped[int] = mapped_column(Integer, ForeignKey("dining_sessions.id", ondelete="CASCADE"), nullable=False)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    # Staff-entered discount; discount_amount is derived from these on every recalculation
    discount_type: Mapped[str | None] = mapped_column(String(10), nullable=True)  # PERCENT, FLAT
    discount_value: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    discount_reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    discount_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reservation_deposit_paid: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    reservation_credit: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    remainder_action: Mapped[str | None] = mapped_column(String(30), nullable=True)  # REFUND_REMAINDER, CUSTOMER_CREDIT, FORFEIT_REMAINDER
    remainder_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    is_paid: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=utc_now, nullable=False)

    dining_session = relationship("DiningSession", back_populates="bills")
    payments = relationship("Payment", back_populates="bill", cascade="all, delete-orphan")
    tenant = relationship("Tenant", foreign_keys=[tenant_id])


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    bill_id: Mapped[int] = mapped_column(Integer, ForeignKey("bills.id", ondelete="CASCADE"), nullable=False)
    payment_method: Mapped[str] = mapped_column(String(20), nullable=False)  # CASH, CARD, UPI
    amount_paid: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    transaction_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True, index=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=utc_now, nullable=False)

    bill = relationship("Bill", back_populates="payments")
