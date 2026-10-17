import datetime
from decimal import Decimal
import uuid
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Time, Numeric
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.utils.helpers import utc_now


class Reservation(Base):
    __tablename__ = "reservations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="RESTRICT"),
        default=uuid.UUID("23395d5e-16e5-4eb6-9214-cc63f05c3210"),
        nullable=False,
        index=True,
    )
    branch_id: Mapped[int] = mapped_column(Integer, ForeignKey("branches.id", ondelete="CASCADE"), nullable=False)
    customer_id: Mapped[int] = mapped_column(Integer, ForeignKey("customers.id", ondelete="CASCADE"), nullable=False)
    guest_count: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    reservation_date: Mapped[datetime.date] = mapped_column(Date, nullable=False, index=True)
    time_slot: Mapped[str] = mapped_column(String(20), nullable=False, index=True)  # e.g., "19:00-20:00"
    table_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("tables.id", ondelete="SET NULL"), nullable=True)
    floor_number: Mapped[int | None] = mapped_column(Integer, nullable=True, default=1)
    table_name: Mapped[str | None] = mapped_column(String(50), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="CONFIRMED", nullable=False)  # HOLD, PAYMENT_PENDING, CONFIRMED, ARRIVED, SEATED, COMPLETED, CANCELLED, NO_SHOW, EXPIRED
    payment_status: Mapped[str] = mapped_column(String(30), default="PAID", nullable=False)  # PENDING, PENDING_VERIFICATION, PAID, EXPIRED, CANCELLED, REFUNDED
    advance_amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True, default=Decimal("0.00"))
    payment_reference: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payment_method: Mapped[str | None] = mapped_column(String(30), nullable=True)
    hold_expires_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)
    upi_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    upi_utr: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_deposit_credited: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    credited_bill_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("bills.id", ondelete="SET NULL", use_alter=True), nullable=True)
    cancellation_refund_amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True, default=Decimal("0.00"))
    cancellation_refund_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    celery_task_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    expected_pizza_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=utc_now, nullable=False)


    branch = relationship("Branch", back_populates="reservations")
    customer = relationship("Customer", back_populates="reservations")
    table = relationship("Table", foreign_keys=[table_id], lazy="selectin")
    tenant = relationship("Tenant", foreign_keys=[tenant_id])

    @property
    def booking_id(self) -> str:
        """First 4 letters of guest name + last 4 phone digits (e.g. PRIN5743).

        Not unique by design: repeat guests share an ID. Falls back to RES-0001 style
        when name/phone are missing or the customer isn't loaded (never lazy-loads).
        """
        customer = self.__dict__.get("customer")
        name = (customer.name or "") if customer else ""
        phone = (customer.phone or "") if customer else ""
        letters = "".join(ch for ch in name if ch.isalpha()).upper()[:4]
        digits = "".join(ch for ch in phone if ch.isdigit())[-4:]
        if not letters or not digits:
            return f"RES-{self.id:04d}"
        return f"{letters}{digits}"


class ReservationCapacityRule(Base):
    __tablename__ = "reservation_capacity_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="RESTRICT"),
        default=uuid.UUID("23395d5e-16e5-4eb6-9214-cc63f05c3210"),
        nullable=False,
        index=True,
    )
    branch_id: Mapped[int] = mapped_column(Integer, ForeignKey("branches.id", ondelete="CASCADE"), nullable=False)
    time_slot: Mapped[str] = mapped_column(String(20), nullable=False)
    max_guest_capacity: Mapped[int] = mapped_column(Integer, nullable=False, default=80)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    branch = relationship("Branch", back_populates="capacity_rules")
