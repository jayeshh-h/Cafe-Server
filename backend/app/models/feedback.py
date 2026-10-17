import datetime
import uuid
from sqlalchemy import DateTime, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.utils.helpers import utc_now


class Feedback(Base):
    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="RESTRICT"),
        default=uuid.UUID("23395d5e-16e5-4eb6-9214-cc63f05c3210"),
        nullable=False,
        index=True,
    )
    dining_session_id: Mapped[int] = mapped_column(Integer, ForeignKey("dining_sessions.id", ondelete="CASCADE"), nullable=False)
    rating: Mapped[int] = mapped_column(Integer, nullable=False)  # 1 to 5 stars
    comments: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=utc_now, nullable=False)

    dining_session = relationship("DiningSession", back_populates="feedback")
    tenant = relationship("Tenant", foreign_keys=[tenant_id])
