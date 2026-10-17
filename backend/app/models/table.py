import datetime
import uuid
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.utils.helpers import utc_now


class Table(Base):
    __tablename__ = "tables"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="RESTRICT"),
        default=uuid.UUID("23395d5e-16e5-4eb6-9214-cc63f05c3210"),
        nullable=False,
        index=True,
    )
    branch_id: Mapped[int] = mapped_column(Integer, ForeignKey("branches.id", ondelete="CASCADE"), nullable=False)
    table_number: Mapped[str] = mapped_column(String(20), nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False, default=4)
    status: Mapped[str] = mapped_column(String(20), default="Available", nullable=False)  # Available, Occupied, Reserved
    # Set for tables added from admin; the original 13 leave it empty and use the id ranges below
    floor: Mapped[int | None] = mapped_column(Integer, nullable=True)

    branch = relationship("Branch", back_populates="tables")
    qr_code = relationship("TableQR", back_populates="table", uselist=False)
    dining_sessions = relationship("DiningSession", back_populates="table")
    tenant = relationship("Tenant", foreign_keys=[tenant_id])

    @property
    def floor_number(self) -> int:
        if self.floor:
            return self.floor
        if self.id:
            if self.id <= 3: return 1
            if self.id <= 6: return 2
            if self.id <= 8: return 3
            if self.id <= 10: return 4
            if self.id <= 13: return 5
            return 6
        digits = "".join(filter(str.isdigit, str(self.table_number)))
        num = int(digits) if digits else 1
        if num <= 3: return 1
        if num <= 6: return 2
        if num <= 8: return 3
        if num <= 10: return 4
        if num <= 13: return 5
        return 6

    @property
    def floor_table_num(self) -> int:
        if self.floor:
            digits = "".join(filter(str.isdigit, str(self.table_number)))
            return int(digits) if digits else 1
        if self.id:
            if self.id <= 3: return self.id
            if self.id <= 6: return self.id - 3
            if self.id <= 8: return self.id - 6
            if self.id <= 10: return self.id - 8
            if self.id <= 13: return self.id - 10
            return 1
        digits = "".join(filter(str.isdigit, str(self.table_number)))
        num = int(digits) if digits else 1
        if num <= 3: return num
        if num <= 6: return num - 3
        if num <= 8: return num - 6
        if num <= 10: return num - 8
        if num <= 13: return num - 10
        return 1

    @property
    def floor_name(self) -> str:
        names = {
            1: "Ground floor",
            2: "School room",
            3: "Balcony",
            4: "Lower top",
            5: "Top top",
            6: "Everest (coming soon)",
        }
        return names.get(self.floor_number, "Ground floor")

    @property
    def qr_token(self) -> str | None:
        return self.qr_code.qr_token if self.qr_code else None


class TableQR(Base):
    __tablename__ = "table_qr"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    table_id: Mapped[int] = mapped_column(Integer, ForeignKey("tables.id", ondelete="CASCADE"), unique=True, nullable=False)
    qr_token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    table = relationship("Table", back_populates="qr_code")


class GeneralizedQR(Base):
    __tablename__ = "generalized_qrs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    qr_token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(200), nullable=True)


class DiningSession(Base):
    __tablename__ = "dining_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    table_id: Mapped[int] = mapped_column(Integer, ForeignKey("tables.id", ondelete="CASCADE"), nullable=False)
    customer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("customers.id", ondelete="SET NULL"), nullable=True)
    reservation_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("reservations.id", ondelete="SET NULL", use_alter=True), nullable=True)
    session_token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), default="OPENED", nullable=False)  # OPENED, ACTIVE, CHECKOUT, PAID, CLOSED
    allergy_info: Mapped[str | None] = mapped_column(String(500), nullable=True)
    opened_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    closed_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)

    table = relationship("Table", back_populates="dining_sessions")
    customer = relationship("Customer", back_populates="dining_sessions")
    reservation = relationship("Reservation", foreign_keys=[reservation_id], lazy="selectin")
    orders = relationship("Order", back_populates="dining_session")
    kots = relationship("KOT", back_populates="dining_session")
    bills = relationship("Bill", back_populates="dining_session")
    feedback = relationship("Feedback", back_populates="dining_session")
