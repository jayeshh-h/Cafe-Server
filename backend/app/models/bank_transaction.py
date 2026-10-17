import datetime
from decimal import Decimal
import uuid
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.utils.helpers import utc_now


class VerifiedBankCredit(Base):
    """
    Independently verified bank/acquirer payment credits.
    Only trusted sources (Bank Webhook, Payment Gateway, or Authenticated Staff Reconciliation)
    can create records in this table. Customer-supplied inputs can NEVER write to this table.
    """
    __tablename__ = "verified_bank_credits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="RESTRICT"),
        default=uuid.UUID("23395d5e-16e5-4eb6-9214-cc63f05c3210"),
        nullable=False,
        index=True,
    )
    utr: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    merchant_vpa: Mapped[str] = mapped_column(String(100), nullable=False)
    payer_vpa: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="SETTLED", nullable=False)  # SETTLED, PAYMENT_REVIEW_REQUIRED, FAILED
    provider_source: Mapped[str] = mapped_column(String(50), nullable=False)  # ANDROID_LISTENER, BANK_WEBHOOK, RAZORPAY_WEBHOOK, CASHFREE, STAFF_VERIFIED
    event_id: Mapped[str | None] = mapped_column(String(100), unique=True, nullable=True, index=True)
    raw_event_payload: Mapped[str | None] = mapped_column(String(500), nullable=True)
    review_reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    verified_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    is_claimed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    claimed_reservation_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("reservations.id", ondelete="SET NULL"), nullable=True)

    claimed_reservation = relationship("Reservation", foreign_keys=[claimed_reservation_id], lazy="selectin")
    tenant = relationship("Tenant", foreign_keys=[tenant_id])
