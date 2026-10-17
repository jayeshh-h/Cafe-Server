import datetime
from app.utils.helpers import utc_now
import asyncio
import secrets
from types import SimpleNamespace
from decimal import Decimal
from typing import Dict, List
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException, status
from app.models.table import Table, DiningSession
from app.services.table_service import TableService
from app.models.menu import MenuCategory, MenuItem
from app.models.order import Order, OrderItem, OrderStatusHistory
from app.models.kitchen import KitchenOrder, PrintJob
from app.models.kot import KOT
from app.schemas.order import OrderCreate
from app.services.capacity_service import CapacityService
from app.services.inventory_service import InventoryService
from app.core.config import settings


class OrderService:
    @staticmethod
    async def _is_pizza(db: AsyncSession, item_data) -> bool:
        """Pizzas are the items in a menu category whose name contains "pizza"."""
        menu_item = None
        if item_data.menu_item_id:
            menu_item = await db.get(MenuItem, item_data.menu_item_id)
        elif item_data.name and item_data.name.strip():
            menu_item = (
                await db.execute(select(MenuItem).where(func.lower(MenuItem.name) == item_data.name.strip().lower()))
            ).scalars().first()
        if not menu_item:
            return False
        category = await db.get(MenuCategory, menu_item.category_id)
        return bool(category and "pizza" in (category.name or "").lower())

    @staticmethod
    async def place_order(db: AsyncSession, data: OrderCreate, staff_table_id: int | None = None) -> Order:
        """Pizzas go to the kitchen on their own KOT, everything else on a second KOT.

        An order with both is split into two orders on the same table bill (one KOT each);
        the pizza order is returned.
        """
        flags = [await OrderService._is_pizza(db, it) for it in data.items]
        pizzas = [it for it, p in zip(data.items, flags) if p]
        others = [it for it, p in zip(data.items, flags) if not p]
        if not pizzas or not others:
            return await OrderService._place_single_order(db, data, staff_table_id)
        pizza_order = await OrderService._place_single_order(db, data.model_copy(update={"items": pizzas}), staff_table_id)
        await OrderService._place_single_order(db, data.model_copy(update={"items": others}), staff_table_id)
        return pizza_order

    @staticmethod
    async def _place_single_order(db: AsyncSession, data: OrderCreate, staff_table_id: int | None = None) -> Order:
        """Guest orders come in through the table's QR code; POS staff pass staff_table_id instead."""
        try:
            if staff_table_id is not None:
                staff_table = await db.get(Table, staff_table_id)
                if not staff_table:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Table not found.")
                val = SimpleNamespace(table_id=staff_table.id, is_generalized=False)
            else:
                val = await TableService.validate_qr_token(db, data.qr_token)

            if data.session_token:
                sess_query = select(DiningSession).where(
                    DiningSession.session_token == data.session_token,
                )
                if not getattr(val, "is_generalized", False):
                    sess_query = sess_query.where(DiningSession.table_id == val.table_id)
                sess_res = await db.execute(sess_query)
                dining_session = sess_res.scalar_one_or_none()
                if not dining_session:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="INVALID_DINING_SESSION: Dining session invalid or table mismatch.",
                    )
                if dining_session.status == "CLOSED":
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="CLOSED_DINING_SESSION: Cannot place order for a closed dining session.",
                    )
            else:
                dining_session = await TableService.get_or_create_dining_session(db, val.table_id)
                if dining_session.status == "CLOSED":
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="CLOSED_DINING_SESSION: Cannot place order for a closed dining session.",
                    )

            if dining_session.status == "OPENED":
                # Guests start now; the session may have been opened by an earlier QR scan
                dining_session.status = "ACTIVE"
                dining_session.opened_at = utc_now()
            
            table = await db.get(Table, dining_session.table_id)
            if table and table.status == "Available":
                table.status = "Occupied"

            # Resolve branch and reservation context for capacity checks
            branch_id = table.branch_id if table else 1
            order_reservation_id = dining_session.reservation_id
            production_date = datetime.date.today()


            # Generate daily sequential order number (1 to n) with concurrency-safe retry loop
            today_date = datetime.date.today()
            date_prefix = today_date.strftime("%Y%m%d")

            allergy_note = (data.allergy_info or "").strip() or None
            if allergy_note:
                if dining_session.allergy_info:
                    if allergy_note.lower() not in dining_session.allergy_info.lower():
                        dining_session.allergy_info = f"{dining_session.allergy_info}; {allergy_note}"
                else:
                    dining_session.allergy_info = allergy_note

            order = None
            max_order_retries = 10
            for order_attempt in range(max_order_retries):
                try:
                    async with db.begin_nested():
                        daily_orders_stmt = select(Order.order_number).where(
                            Order.order_number.like(f"ORD-{date_prefix}-%")
                        )
                        res_orders = await db.execute(daily_orders_stmt)
                        existing_numbers = set(res_orders.scalars().all())

                        order_seq = len(existing_numbers) + 1 + order_attempt
                        if order_attempt > 0:
                            # Add random unique suffix on collision retry to guarantee zero stampede/lock wait
                            rnd_suffix = secrets.token_hex(2).upper()
                            order_number = f"ORD-{date_prefix}-{order_seq:03d}-{rnd_suffix}"
                        else:
                            order_number = f"ORD-{date_prefix}-{order_seq:03d}"
                            while order_number in existing_numbers:
                                order_seq += 1
                                order_number = f"ORD-{date_prefix}-{order_seq:03d}"

                        order = Order(
                            tenant_id=table.tenant_id if table else None,
                            dining_session_id=dining_session.id,
                            order_number=order_number,
                            status="CONFIRMED",
                            allergy_info=allergy_note,
                        )
                        db.add(order)
                        await db.flush()
                        break
                except IntegrityError:
                    if order_attempt == max_order_retries - 1:
                        raise
                    await asyncio.sleep(0.005 * (order_attempt + 1))

            status_log = OrderStatusHistory(
                order_id=order.id,
                old_status=None,
                new_status="CONFIRMED",
            )
            db.add(status_log)

            # Track items and totals for KOT
            total_order_amount = Decimal("0.00")
            total_order_items = 0
            all_kot_items: List[dict] = []

            # Dictionary to route items to kitchens (kitchen_id -> list of (item_name, qty, instructions))
            kitchen_item_routes: Dict[int, List[dict]] = {}

            for item_data in data.items:
                menu_item = None

                # 1. Match by name first if provided (guarantees exact item and correct price!)
                if item_data.name and item_data.name.strip():
                    raw_name = item_data.name.strip()
                    alias_target = {
                        "rosehip & spearmint tisane": "himalayan rosehip & mint tisane",
                        "himalayan mineral water natural spring": "himalayan mineral water",
                    }.get(raw_name.lower(), raw_name.lower())

                    name_query = select(MenuItem).where(
                        MenuItem.tenant_id == table.tenant_id if table else None,
                        func.lower(func.trim(MenuItem.name)) == alias_target,
                        MenuItem.is_active == True,
                        MenuItem.is_available == True,
                    )
                    name_res = await db.execute(name_query)
                    menu_item = name_res.scalar_one_or_none()

                # 2. Fallback to menu_item_id lookup if not matched by name
                if not menu_item and item_data.menu_item_id:
                    menu_query = select(MenuItem).where(
                        MenuItem.tenant_id == table.tenant_id if table else None,
                        MenuItem.id == item_data.menu_item_id,
                        MenuItem.is_active == True,
                        MenuItem.is_available == True,
                    )
                    menu_res = await db.execute(menu_query)
                    menu_item = menu_res.scalar_one_or_none()

                if not menu_item:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail=f"MENU_ITEM_NOT_FOUND: Menu item #{item_data.menu_item_id or item_data.name} is unavailable.",
                    )

                # Validate production capacity and deduct inventory BOM
                await CapacityService.validate_and_allocate(
                    db,
                    menu_item.id,
                    item_data.quantity,
                    branch_id=branch_id,
                    production_date=production_date,
                    reservation_id=order_reservation_id,
                )
                if settings.INVENTORY_AUTO_DEDUCT:  # off for now (see config)
                    await InventoryService.deduct_bom_stock(db, menu_item.id, item_data.quantity, order_number)

                unit_price = Decimal(str(menu_item.price))
                subtotal = unit_price * Decimal(str(item_data.quantity))

                total_order_amount += subtotal
                total_order_items += item_data.quantity
                all_kot_items.append({
                    "name": menu_item.name,
                    "qty": item_data.quantity,
                    "instructions": item_data.special_instructions,
                })

                order_item = OrderItem(
                    order_id=order.id,
                    menu_item_id=menu_item.id,
                    quantity=item_data.quantity,
                    unit_price=unit_price,
                    subtotal=subtotal,
                    special_instructions=item_data.special_instructions,
                )
                db.add(order_item)

                target_kitchen_id = 1
                if target_kitchen_id not in kitchen_item_routes:
                    kitchen_item_routes[target_kitchen_id] = []
                kitchen_item_routes[target_kitchen_id].append(
                    {
                        "name": menu_item.name,
                        "qty": item_data.quantity,
                        "instructions": item_data.special_instructions,
                    }
                )

            # Generate daily KOT sequence with concurrency retry loop
            today = today_date
            created_kitchen_orders = []
            created_print_jobs = []
            kot = None
            table_display = table.table_number if table else str(val.table_id)

            max_retries = 10
            for attempt in range(max_retries):
                try:
                    async with db.begin_nested():
                        max_seq_res = await db.execute(
                            select(func.coalesce(func.max(KOT.sequence_number), 0)).where(
                                KOT.business_date == today
                            )
                        )
                        next_seq = (max_seq_res.scalar() or 0) + 1
                        if attempt > 0:
                            next_seq += secrets.randbelow(15) + 1 + attempt * 2
                        kot_number = f"KOT-{next_seq:03d}"

                        kot = KOT(
                            kot_number=kot_number,
                            sequence_number=next_seq,
                            business_date=today,
                            table_id=dining_session.table_id,
                            dining_session_id=dining_session.id,
                            order_id=order.id,
                            total_amount=total_order_amount,
                            items_count=total_order_items,
                            status="GENERATED",
                            printed_status="PENDING",
                            allergy_info=allergy_note,
                        )
                        db.add(kot)
                        await db.flush()

                        # Formulate thermal printer ticket
                        kot_lines = [
                            "================================",
                            "          JAADOO CAFE           ",
                            "================================",
                            f"{kot.kot_number}        TABLE: {table_display}",
                            f"Date: {today.strftime('%d %b %Y')}",
                            f"Time: {order.created_at.strftime('%I:%M %p')}",
                            "--------------------------------",
                        ]
                        if allergy_note:
                            kot_lines.extend([
                                "********************************",
                                f"ALLERGY NOTE: {allergy_note.upper()}",
                                "********************************",
                                "--------------------------------",
                            ])
                        for r_item in all_kot_items:
                            line = f"{r_item['qty']} x {r_item['name']}"
                            if r_item["instructions"]:
                                line += f" ({r_item['instructions']})"
                            kot_lines.append(line)
                        kot_lines.extend([
                            "--------------------------------",
                            f"Total Items: {total_order_items}",
                            f"Total: Rs. {total_order_amount}",
                            "================================",
                        ])

                        kot_print_job = PrintJob(
                            kot_id=kot.id,
                            ticket_content="\n".join(kot_lines),
                            status="PENDING",
                        )
                        db.add(kot_print_job)
                        await db.flush()
                        created_print_jobs.append(kot_print_job)
                        break
                except IntegrityError:
                    if attempt == max_retries - 1:
                        raise
                    await asyncio.sleep(0.005 * (attempt + 1))

            # Maintain kitchen orders for backward compatibility & routing
            for kitchen_id, routed_items in kitchen_item_routes.items():
                k_order = KitchenOrder(
                    order_id=order.id,
                    kitchen_id=kitchen_id,
                    status="SENT",
                )
                db.add(k_order)
                await db.flush()
                created_kitchen_orders.append(k_order)

                ticket_lines = [f"=== KITCHEN TICKET #{k_order.id} ===", f"Order #: {order_number}"]
                if allergy_note:
                    ticket_lines.append(f"*** ALLERGY NOTE: {allergy_note.upper()} ***")
                for r_item in routed_items:
                    line = f"- {r_item['qty']}x {r_item['name']}"
                    if r_item["instructions"]:
                        line += f" ({r_item['instructions']})"
                    ticket_lines.append(line)

                k_print_job = PrintJob(
                    kitchen_order_id=k_order.id,
                    ticket_content="\n".join(ticket_lines),
                    status="PENDING",
                )
                db.add(k_print_job)
                await db.flush()
                created_print_jobs.append(k_print_job)

            await db.commit()
            await db.refresh(order)

            # Broadcast WebSocket events to POS and Kitchen
            from app.api.websocket import ws_manager
            from app.workers.celery_app import celery_app
            from app.models.tenant import Tenant

            tenant_slug = None
            if table and table.tenant_id:
                t_obj = await db.get(Tenant, table.tenant_id)
                if t_obj:
                    tenant_slug = t_obj.slug

            await ws_manager.broadcast("pos", {
                "event": "KOT_CREATED",
                "kot_id": kot.id,
                "kot_number": kot.kot_number,
                "table_number": table_display,
                "total_amount": float(total_order_amount),
                "items_count": total_order_items,
                "printed_status": kot.printed_status,
                "allergy_info": kot.allergy_info,
                "created_at": kot.created_at.isoformat(),
            }, tenant_slug=tenant_slug)

            for k_order in created_kitchen_orders:
                await ws_manager.broadcast("kitchen", {
                    "event": "KITCHEN_ORDER_CREATED",
                    "kitchen_id": k_order.kitchen_id,
                    "kitchen_order_id": k_order.id
                }, tenant_slug=tenant_slug)
            
            # Fire thermal print execution (Never cancels order on failure)
            for print_job in created_print_jobs:
                try:
                    celery_app.send_task("execute_print_job", args=[print_job.id], ignore_result=True)
                except Exception:
                    pass

            # Reload relationship items with selectinload for async session
            from sqlalchemy.orm import selectinload
            res = await db.execute(
                select(Order)
                .options(
                    selectinload(Order.items),
                    selectinload(Order.kitchen_orders),
                )
                .where(Order.id == order.id)
            )
            return res.scalar_one()
        except Exception:
            await db.rollback()
            raise
