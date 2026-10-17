"""
CapacityService — Reservation-Aware Daily Pizza Dough Production Protection

Two separate capacity systems co-exist:

1. HOURLY OVEN CAPACITY (existing, preserved)
   ItemCapacityRule.allocated_count / max_production_limit
   Controls per-item production throughput.

2. DAILY DOUGH POOL (new)
   DailyProductionRule per branch per day.
   Tracks:
     total_dough_limit        = total pizzas/dough portions available today
     total_allocated_dough    = ONLY actual dough consumed by ACCEPTED pizza orders
                                Protected reservation dough is NEVER counted here.

   ReservationDoughAllocation per reservation.
   Tracks:
     initial_protected_qty    = pizzas protected at reservation creation
     consumed_qty             = pizzas consumed by that reservation's orders
     released_qty             = pizzas released back when reservation ends unused

   Walk-in available =
       total_dough_limit
       - total_allocated_dough
       - sum(remaining_protected for all ACTIVE allocations)

   Reservation-linked order uses its own protected quota first; excess falls
   to general (walk-in) pool — NEVER another reservation's protected quota.

INVARIANT:
   total_allocated_dough = consumed_qty increments ONLY.
   Creating/releasing a reservation does NOT touch total_allocated_dough.
"""
import datetime
import math
from decimal import Decimal
from typing import Optional
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException, status
from app.models.capacity import ItemCapacityRule, DailyProductionRule, ReservationDoughAllocation
from app.models.menu import MenuItem
from app.models.inventory import Recipe
from app.services.settings_service import SettingsService


class CapacityService:
    @staticmethod
    async def _is_pizza_item(db: AsyncSession, menu_item_id: int) -> bool:
        """
        Determines whether a menu item consumes pizza dough.
        Uses the existing Recipe/BOM architecture: if the item has a recipe
        that contains a dough-class inventory ingredient (SKU starts with 'DOUGH'
        or name contains 'dough'), it is a pizza item.
        If no recipe exists AND the item has an active ItemCapacityRule, treat
        it as a pizza item (opt-in via capacity rule).
        """
        recipe_stmt = select(Recipe).where(Recipe.menu_item_id == menu_item_id)
        recipe_res = await db.execute(recipe_stmt)
        recipe = recipe_res.scalar_one_or_none()

        if recipe:
            from app.models.inventory import RecipeItem, InventoryItem
            ing_stmt = (
                select(InventoryItem)
                .join(RecipeItem, RecipeItem.inventory_item_id == InventoryItem.id)
                .where(RecipeItem.recipe_id == recipe.id)
            )
            ing_res = await db.execute(ing_stmt)
            ingredients = ing_res.scalars().all()
            for ing in ingredients:
                if (
                    "dough" in ing.name.lower()
                    or (ing.sku and ing.sku.upper().startswith("DOUGH"))
                ):
                    return True
            return False

        rule_stmt = select(ItemCapacityRule).where(
            ItemCapacityRule.menu_item_id == menu_item_id,
            ItemCapacityRule.is_active == True,
        )
        rule_res = await db.execute(rule_stmt)
        rule = rule_res.scalar_one_or_none()
        return rule is not None

    @staticmethod
    async def _get_or_create_daily_rule(
        db: AsyncSession, branch_id: int, production_date: datetime.date
    ) -> DailyProductionRule:
        """
        Gets the DailyProductionRule for today with a row-level lock.
        If it doesn't exist yet, creates it with the system default limit.
        """
        stmt = (
            select(DailyProductionRule)
            .where(
                DailyProductionRule.branch_id == branch_id,
                DailyProductionRule.production_date == production_date,
            )
            .with_for_update()
        )
        res = await db.execute(stmt)
        rule = res.scalar_one_or_none()
        if not rule:
            import uuid
            from app.models.branch import Branch
            b_stmt = select(Branch.tenant_id).where(Branch.id == branch_id)
            b_res = await db.execute(b_stmt)
            t_id = b_res.scalar_one_or_none() or uuid.UUID("23395d5e-16e5-4eb6-9214-cc63f05c3210")
            rule = DailyProductionRule(
                tenant_id=t_id,
                branch_id=branch_id,
                production_date=production_date,
                total_dough_limit=70,  # sensible default; overridden by ops
                total_allocated_dough=0,
            )
            db.add(rule)
            await db.flush()
        return rule

    @staticmethod
    async def _get_total_active_protected(
        db: AsyncSession, branch_id: int, production_date: datetime.date
    ) -> int:
        """
        Returns the sum of remaining protected dough for all ACTIVE
        ReservationDoughAllocations for this branch+date.
        remaining = initial_protected_qty - consumed_qty - released_qty
        """
        raw = await db.execute(
            select(
                func.coalesce(
                    func.sum(
                        ReservationDoughAllocation.initial_protected_qty
                        - ReservationDoughAllocation.consumed_qty
                        - ReservationDoughAllocation.released_qty
                    ),
                    0,
                )
            ).where(
                ReservationDoughAllocation.branch_id == branch_id,
                ReservationDoughAllocation.production_date == production_date,
                ReservationDoughAllocation.status == "ACTIVE",
            )
        )
        return int(raw.scalar() or 0)

    @staticmethod
    async def _check_hourly_oven_capacity(
        db: AsyncSession, menu_item_id: int, quantity: int
    ) -> None:
        """
        Original ItemCapacityRule check. Preserved exactly as before.
        Raises HTTP 400 if hourly production limit exceeded.
        Increments allocated_count on the rule row if accepted.
        """
        query = (
            select(ItemCapacityRule)
            .where(
                ItemCapacityRule.menu_item_id == menu_item_id,
                ItemCapacityRule.is_active == True,
            )
            .with_for_update()
        )
        result = await db.execute(query)
        rule = result.scalar_one_or_none()

        if not rule:
            # No hourly capacity rule → no per-item limit enforced
            return

        if rule.allocated_count + quantity > rule.max_production_limit:
            item_query = select(MenuItem).where(MenuItem.id == menu_item_id)
            item_res = await db.execute(item_query)
            item = item_res.scalar_one_or_none()
            item_name = item.name if item else f"Item #{menu_item_id}"
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"PIZZA_SOLD_OUT: Production limit reached for '{item_name}'. "
                    f"Maximum capacity is {rule.max_production_limit}."
                ),
            )
        rule.allocated_count += quantity

    # ------------------------------------------------------------------
    # DAILY DOUGH CAPACITY — NEW (Step 2 of capacity check)
    # ------------------------------------------------------------------

    @staticmethod
    async def _check_daily_dough_capacity(
        db: AsyncSession,
        menu_item_id: int,
        quantity: int,
        branch_id: int,
        production_date: datetime.date,
        reservation_id: Optional[int] = None,
    ) -> None:
        """
        Daily dough pool protection.

        Walk-in (reservation_id is None):
          Walk-in pool = total_dough_limit - total_allocated_dough - total_active_protected
          If quantity > walk_in_pool → reject.
          Else → total_allocated_dough += quantity

        Reservation-linked order:
          1. Lock that reservation's ReservationDoughAllocation (if any).
          2. Use own protected quota first.
          3. Excess → walk-in pool (must be available). Never another reservation's.
          4. total_allocated_dough += quantity (full quantity).
          5. Update consumed_qty on the allocation.
          6. If consumed_qty >= initial_protected_qty → set status = EXHAUSTED.
        """
        # Lock the daily rule row
        daily_rule = await CapacityService._get_or_create_daily_rule(
            db, branch_id, production_date
        )

        if reservation_id is not None:
            # --- Reservation-linked order ---
            alloc_stmt = (
                select(ReservationDoughAllocation)
                .where(
                    ReservationDoughAllocation.reservation_id == reservation_id,
                    ReservationDoughAllocation.status == "ACTIVE",
                )
                .with_for_update()
            )
            alloc_res = await db.execute(alloc_stmt)
            alloc = alloc_res.scalar_one_or_none()

            if alloc:
                reservation_remaining = max(
                    0,
                    alloc.initial_protected_qty - alloc.consumed_qty - alloc.released_qty,
                )
            else:
                reservation_remaining = 0

            from_protected = min(quantity, reservation_remaining)
            from_general = quantity - from_protected  # excess that needs general pool

            if from_general > 0:
                # Check general/walk-in pool for excess
                total_active_protected = await CapacityService._get_total_active_protected(
                    db, branch_id, production_date
                )
                # Subtract this reservation's remaining because it's already accounted via alloc
                # (the general pool does NOT include this reservation's protected amount)
                walk_in_available = max(
                    0,
                    daily_rule.total_dough_limit
                    - daily_rule.total_allocated_dough
                    - total_active_protected,
                )
                if from_general > walk_in_available:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=(
                            f"PIZZA_SOLD_OUT: Insufficient daily pizza capacity. "
                            f"Your reservation covers {from_protected} pizza(s); "
                            f"{from_general} additional pizza(s) exceed today's available capacity."
                        ),
                    )

            # Commit the dough consumption
            daily_rule.total_allocated_dough += quantity

            if alloc and from_protected > 0:
                alloc.consumed_qty += from_protected
                if alloc.consumed_qty >= alloc.initial_protected_qty:
                    alloc.status = "EXHAUSTED"

        else:
            # --- Walk-in order ---
            total_active_protected = await CapacityService._get_total_active_protected(
                db, branch_id, production_date
            )
            walk_in_available = max(
                0,
                daily_rule.total_dough_limit
                - daily_rule.total_allocated_dough
                - total_active_protected,
            )
            if quantity > walk_in_available:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"PIZZA_SOLD_OUT: Daily pizza capacity exhausted for walk-in orders. "
                        f"Available: {walk_in_available}, requested: {quantity}."
                    ),
                )
            daily_rule.total_allocated_dough += quantity

    @staticmethod
    async def validate_and_allocate(
        db: AsyncSession,
        menu_item_id: int,
        quantity: int,
        branch_id: int = 1,
        production_date: Optional[datetime.date] = None,
        reservation_id: Optional[int] = None,
    ) -> None:
        """
        Full capacity validation for a pizza/dough-consuming item.
        Validates hourly oven capacity, then daily dough pool if item consumes dough.
        """
        if production_date is None:
            production_date = datetime.date.today()

        await CapacityService._check_hourly_oven_capacity(db, menu_item_id, quantity)

        is_pizza = await CapacityService._is_pizza_item(db, menu_item_id)
        if is_pizza:
            await CapacityService._check_daily_dough_capacity(
                db=db,
                menu_item_id=menu_item_id,
                quantity=quantity,
                branch_id=branch_id,
                production_date=production_date,
                reservation_id=reservation_id,
            )

    @staticmethod
    async def create_reservation_dough_allocation(
        db: AsyncSession,
        reservation_id: int,
        branch_id: int,
        reservation_date: datetime.date,
        guest_count: int,
        expected_pizza_count: Optional[int] = None,
    ) -> ReservationDoughAllocation:
        """
        Creates a protected dough allocation when a reservation is CONFIRMED.
        Idempotent: if one already exists for this reservation, returns it unchanged.
        """
        existing_stmt = select(ReservationDoughAllocation).where(
            ReservationDoughAllocation.reservation_id == reservation_id
        )
        existing_res = await db.execute(existing_stmt)
        existing = existing_res.scalar_one_or_none()
        if existing:
            return existing

        if expected_pizza_count is not None:
            protected_qty = max(0, expected_pizza_count)
        else:
            ratio = await SettingsService.get_reservation_pizza_demand_ratio(db)
            protected_qty = math.ceil(guest_count * ratio)

        alloc = ReservationDoughAllocation(
            reservation_id=reservation_id,
            branch_id=branch_id,
            production_date=reservation_date,
            initial_protected_qty=protected_qty,
            consumed_qty=0,
            released_qty=0,
            status="ACTIVE",
        )
        db.add(alloc)
        await db.flush()
        return alloc

    @staticmethod
    async def release_reservation_dough_allocation(
        db: AsyncSession,
        reservation_id: int,
    ) -> Optional[ReservationDoughAllocation]:
        """
        Releases unused protected capacity when a reservation reaches a terminal state
        (CANCELLED, NO_SHOW, EXPIRED, COMPLETED). Idempotent.
        """
        stmt = (
            select(ReservationDoughAllocation)
            .where(
                ReservationDoughAllocation.reservation_id == reservation_id,
                ReservationDoughAllocation.status == "ACTIVE",
            )
            .with_for_update()
        )
        res = await db.execute(stmt)
        alloc = res.scalar_one_or_none()

        if not alloc:
            return None

        unused = max(
            0,
            alloc.initial_protected_qty - alloc.consumed_qty - alloc.released_qty,
        )
        alloc.released_qty += unused
        alloc.status = "RELEASED"
        await db.flush()
        return alloc

    @staticmethod
    async def get_item_capacity(db: AsyncSession, menu_item_id: int) -> dict:
        """Legacy read-only helper: per-item hourly capacity info."""
        query = select(ItemCapacityRule).where(ItemCapacityRule.menu_item_id == menu_item_id)
        result = await db.execute(query)
        rule = result.scalar_one_or_none()
        if not rule:
            return {"is_sold_out": False, "allocated_count": 0, "max_production_limit": None}
        return {
            "is_sold_out": rule.allocated_count >= rule.max_production_limit,
            "allocated_count": rule.allocated_count,
            "max_production_limit": rule.max_production_limit,
        }

    @staticmethod
    async def get_daily_dough_overview(
        db: AsyncSession,
        branch_id: int,
        target_date: Optional[datetime.date] = None,
    ) -> dict:
        """
        Returns today's dough capacity summary for the POS dashboard.

        Example output:
          {
            "total_dough_limit": 70,
            "total_allocated_dough": 25,   # actual consumed
            "total_active_protected": 15,  # protected for reservations
            "walk_in_available": 30,       # available to walk-ins
          }
        """
        if target_date is None:
            target_date = datetime.date.today()

        stmt = select(DailyProductionRule).where(
            DailyProductionRule.branch_id == branch_id,
            DailyProductionRule.production_date == target_date,
        )
        res = await db.execute(stmt)
        rule = res.scalar_one_or_none()

        if not rule:
            return {
                "branch_id": branch_id,
                "production_date": target_date.isoformat(),
                "total_dough_limit": None,
                "total_allocated_dough": 0,
                "total_active_protected": 0,
                "walk_in_available": None,
                "note": "No daily production rule configured for today.",
            }

        protected = await CapacityService._get_total_active_protected(db, branch_id, target_date)
        walk_in_available = max(
            0,
            rule.total_dough_limit - rule.total_allocated_dough - protected,
        )

        return {
            "branch_id": branch_id,
            "production_date": target_date.isoformat(),
            "total_dough_limit": rule.total_dough_limit,
            "total_allocated_dough": rule.total_allocated_dough,
            "total_active_protected": protected,
            "walk_in_available": walk_in_available,
        }

    @staticmethod
    async def get_production_and_reservation_overview(
        db: AsyncSession, menu_item_id: int, target_date: Optional[datetime.date] = None
    ) -> dict:
        """Legacy overview endpoint — preserved for backward compatibility."""
        if not target_date:
            target_date = datetime.date.today()

        query = select(ItemCapacityRule).where(ItemCapacityRule.menu_item_id == menu_item_id)
        result = await db.execute(query)
        rule = result.scalar_one_or_none()

        from app.models.reservation import Reservation
        res_stmt = select(func.coalesce(func.sum(Reservation.guest_count), 0)).where(
            Reservation.reservation_date == target_date,
            Reservation.status.in_(["CONFIRMED", "ARRIVED", "SEATED"]),
        )
        reserved_guests = (await db.execute(res_stmt)).scalar() or 0

        demand_ratio = await SettingsService.get_reservation_pizza_demand_ratio(db)
        protected_demand = int(reserved_guests * demand_ratio)
        max_limit = rule.max_production_limit if rule else 100
        allocated = rule.allocated_count if rule else 0
        walk_in_avail = max(0, max_limit - allocated - protected_demand)

        return {
            "menu_item_id": menu_item_id,
            "max_production_limit": max_limit,
            "allocated_count": allocated,
            "reserved_guests": reserved_guests,
            "protected_reservation_demand": protected_demand,
            "walk_in_available": walk_in_avail,
        }
