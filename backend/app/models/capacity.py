import datetime
import uuid
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, UniqueConstraint, CheckConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.utils.helpers import utc_now


class ItemCapacityRule(Base):
    __tablename__ = "item_capacity_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="RESTRICT"),
        default=uuid.UUID("23395d5e-16e5-4eb6-9214-cc63f05c3210"),
        nullable=False,
        index=True,
    )
    menu_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("menu_items.id", ondelete="CASCADE"), unique=True, nullable=False)
    max_production_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=50)
    allocated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reset_period: Mapped[str] = mapped_column(String(20), default="DAILY", nullable=False)  # DAILY, SHIFT, MANUAL
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    menu_item = relationship("MenuItem", back_populates="capacity_rule")
    tenant = relationship("Tenant", foreign_keys=[tenant_id])


class DailyProductionRule(Base):
    """
    Daily production capacity rule per branch.
    total_dough_limit = Total daily pizza dough pool available for the branch.
    total_allocated_dough = Actual dough consumed ONLY by accepted pizza orders.
    Protected reservation dough is NOT included in total_allocated_dough.
    """
    __tablename__ = "daily_production_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="RESTRICT"),
        default=uuid.UUID("23395d5e-16e5-4eb6-9214-cc63f05c3210"),
        nullable=False,
        index=True,
    )
    branch_id: Mapped[int] = mapped_column(Integer, ForeignKey("branches.id", ondelete="CASCADE"), nullable=False)
    production_date: Mapped[datetime.date] = mapped_column(Date, nullable=False, index=True)
    total_dough_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=70)
    total_allocated_dough: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    branch = relationship("Branch")
    tenant = relationship("Tenant", foreign_keys=[tenant_id])

    __table_args__ = (
        UniqueConstraint("branch_id", "production_date", name="uq_daily_production_branch_date"),
        CheckConstraint("total_dough_limit >= 0", name="check_daily_dough_limit_non_negative"),
        CheckConstraint("total_allocated_dough >= 0", name="check_daily_allocated_dough_non_negative"),
    )


class ReservationDoughAllocation(Base):
    """
    Tracks reservation-specific protected pizza dough capacity.
    Remaining protected quantity = initial_protected_qty - consumed_qty - released_qty
    Status transitions: ACTIVE -> RELEASED or EXHAUSTED
    """
    __tablename__ = "reservation_dough_allocations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    reservation_id: Mapped[int] = mapped_column(Integer, ForeignKey("reservations.id", ondelete="CASCADE"), unique=True, nullable=False)
    branch_id: Mapped[int] = mapped_column(Integer, ForeignKey("branches.id", ondelete="CASCADE"), nullable=False)
    production_date: Mapped[datetime.date] = mapped_column(Date, nullable=False, index=True)
    initial_protected_qty: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    consumed_qty: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    released_qty: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="ACTIVE")  # ACTIVE, RELEASED, EXHAUSTED
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    reservation = relationship("Reservation", lazy="selectin")
    branch = relationship("Branch")

    __table_args__ = (
        UniqueConstraint("reservation_id", name="uq_res_dough_alloc_reservation_id"),
        Index("idx_res_dough_alloc_branch_date", "branch_id", "production_date"),
        CheckConstraint("initial_protected_qty >= 0", name="check_res_dough_initial_non_negative"),
        CheckConstraint("consumed_qty >= 0", name="check_res_dough_consumed_non_negative"),
        CheckConstraint("released_qty >= 0", name="check_res_dough_released_non_negative"),
        CheckConstraint("consumed_qty <= initial_protected_qty", name="check_res_dough_consumed_lte_initial"),
        CheckConstraint("released_qty <= (initial_protected_qty - consumed_qty)", name="check_res_dough_released_lte_unused"),
        CheckConstraint("status IN ('ACTIVE', 'RELEASED', 'EXHAUSTED')", name="check_res_dough_status_valid"),
    )

    @property
    def remaining_protected_qty(self) -> int:
        return max(0, self.initial_protected_qty - self.consumed_qty - self.released_qty)

