from decimal import Decimal
from typing import Optional
import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.settings import SystemSettings
from app.core.config import settings

DEFAULT_TENANT_ID = uuid.UUID("23395d5e-16e5-4eb6-9214-cc63f05c3210")


class SettingsService:
    @staticmethod
    async def get_setting(
        db: AsyncSession,
        key: str,
        default: Optional[str] = None,
        tenant_id: Optional[uuid.UUID] = None,
    ) -> str:
        t_id = tenant_id or DEFAULT_TENANT_ID
        stmt = select(SystemSettings).where(SystemSettings.key == key, SystemSettings.tenant_id == t_id)
        res = await db.execute(stmt)
        setting = res.scalar_one_or_none()
        if setting:
            return setting.value
        # Fallback to default tenant if a custom tenant does not have setting yet
        if t_id != DEFAULT_TENANT_ID:
            fb_stmt = select(SystemSettings).where(SystemSettings.key == key, SystemSettings.tenant_id == DEFAULT_TENANT_ID)
            fb_res = await db.execute(fb_stmt)
            fb_setting = fb_res.scalar_one_or_none()
            if fb_setting:
                return fb_setting.value
        return default if default is not None else ""

    @staticmethod
    async def set_setting(
        db: AsyncSession,
        key: str,
        value: str,
        description: Optional[str] = None,
        tenant_id: Optional[uuid.UUID] = None,
    ) -> SystemSettings:
        t_id = tenant_id or DEFAULT_TENANT_ID
        stmt = select(SystemSettings).where(SystemSettings.key == key, SystemSettings.tenant_id == t_id)
        res = await db.execute(stmt)
        setting = res.scalar_one_or_none()
        if setting:
            setting.value = value
            if description:
                setting.description = description
        else:
            setting = SystemSettings(tenant_id=t_id, key=key, value=value, description=description)
            db.add(setting)
        await db.commit()
        await db.refresh(setting)
        return setting

    @staticmethod
    async def get_deposit_per_guest(db: AsyncSession, tenant_id: Optional[uuid.UUID] = None) -> Decimal:
        val = await SettingsService.get_setting(db, "RESERVATION_DEPOSIT_PER_PERSON", settings.DEFAULT_DEPOSIT_PER_GUEST, tenant_id=tenant_id)
        try:
            return Decimal(val)
        except Exception:
            return Decimal("150.00")

    @staticmethod
    async def get_deposit_remainder_policy(db: AsyncSession, tenant_id: Optional[uuid.UUID] = None) -> str:
        """
        Options:
        - REFUND_REMAINDER: Refund the excess deposit to customer
        - CUSTOMER_CREDIT: Store excess as store credit for customer's next visit
        - FORFEIT_REMAINDER: Retain remainder as cover / minimum reservation fee
        """
        return await SettingsService.get_setting(
            db, "RESERVATION_DEPOSIT_REMAINDER_POLICY", settings.DEFAULT_DEPOSIT_REMAINDER_POLICY, tenant_id=tenant_id
        )

    @staticmethod
    async def get_reservation_pizza_demand_ratio(db: AsyncSession, tenant_id: Optional[uuid.UUID] = None) -> float:
        """
        Returns the configurable pizza demand ratio per guest for reservations.
        Key: RESERVATION_PIZZA_DEMAND_PER_GUEST
        Falls back to settings.DEFAULT_RESERVATION_PIZZA_DEMAND_PER_GUEST (e.g. 0.75).
        """
        val = await SettingsService.get_setting(
            db,
            "RESERVATION_PIZZA_DEMAND_PER_GUEST",
            settings.DEFAULT_RESERVATION_PIZZA_DEMAND_PER_GUEST,
            tenant_id=tenant_id,
        )
        try:
            return float(val)
        except Exception:
            return 0.75

    @staticmethod
    async def get_cancellation_policy(db: AsyncSession, tenant_id: Optional[uuid.UUID] = None) -> dict:
        policy = await SettingsService.get_setting(db, "CANCELLATION_REFUND_POLICY", settings.DEFAULT_CANCELLATION_POLICY, tenant_id=tenant_id)
        cutoff_hours_str = await SettingsService.get_setting(db, "CANCELLATION_CUTOFF_HOURS", str(settings.DEFAULT_CANCELLATION_CUTOFF_HOURS), tenant_id=tenant_id)
        refund_pct_str = await SettingsService.get_setting(db, "CANCELLATION_REFUND_PERCENTAGE", str(settings.DEFAULT_CANCELLATION_REFUND_PERCENTAGE), tenant_id=tenant_id)
        no_show_policy = await SettingsService.get_setting(db, "NO_SHOW_POLICY", settings.DEFAULT_NO_SHOW_POLICY, tenant_id=tenant_id)

        try:
            cutoff_hours = int(cutoff_hours_str)
        except Exception:
            cutoff_hours = 2

        try:
            refund_pct = Decimal(refund_pct_str)
        except Exception:
            refund_pct = Decimal("100")

        return {
            "policy": policy,
            "cutoff_hours": cutoff_hours,
            "refund_percentage": refund_pct,
            "no_show_policy": no_show_policy,
        }
