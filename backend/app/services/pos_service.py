import datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Dict, List, Optional, Tuple
from collections import defaultdict
import uuid
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException, status

from app.models.kot import KOT
from app.models.order import Order, OrderItem
from app.models.table import Table, DiningSession
from app.models.reservation import Reservation
from app.models.menu import MenuItem, MenuCategory
from app.models.kitchen import PrintJob, KitchenPrinter
from app.schemas.pos import (
    KOTResponse,
    KOTItemResponse,
    POSSummaryResponse,
    ItemSummaryResponse,
    CategorySummaryResponse,
    TableOverviewResponse,
    TableSessionDetail,
    SessionItemDetail,
)
from app.utils.helpers import utc_now
from app.services.billing_service import compute_discount_amount


class POSService:
    @staticmethod
    def _format_hour(hour: int) -> str:
        """Format 24-hour integer into readable string, e.g., 20 -> '8–9 PM'."""
        start_period = "AM" if hour < 12 else "PM"
        start_h = 12 if hour in (0, 12) else (hour % 12)
        next_h_raw = (hour + 1) % 24
        end_period = "AM" if next_h_raw < 12 else "PM"
        end_h = 12 if next_h_raw in (0, 12) else (next_h_raw % 12)
        
        if start_period == end_period:
            return f"{start_h}–{end_h} {start_period}"
        return f"{start_h} {start_period} – {end_h} {end_period}"

    @staticmethod
    async def get_kots(
        db: AsyncSession,
        target_date: Optional[datetime.date] = None,
        limit: int = 100,
        tenant_id: Optional[uuid.UUID] = None,
    ) -> List[KOTResponse]:
        if not target_date:
            target_date = datetime.date.today()

        stmt = (
            select(KOT)
            .options(
                selectinload(KOT.table),
                selectinload(KOT.order).selectinload(Order.items).selectinload(OrderItem.menu_item),
                selectinload(KOT.print_jobs),
            )
            .where(KOT.business_date == target_date)
        )
        if tenant_id:
            stmt = stmt.join(Table, KOT.table_id == Table.id).where(Table.tenant_id == tenant_id)
        stmt = stmt.order_by(KOT.sequence_number.asc()).limit(limit)
        res = await db.execute(stmt)
        kots = res.scalars().all()

        results: List[KOTResponse] = []
        for kot in kots:
            items_list = []
            if kot.order and kot.order.items:
                for oi in kot.order.items:
                    items_list.append(
                        KOTItemResponse(
                            name=oi.menu_item.name if oi.menu_item else "Unknown Item",
                            quantity=oi.quantity,
                            unit_price=oi.unit_price,
                            subtotal=oi.subtotal,
                            special_instructions=oi.special_instructions,
                        )
                    )

            print_job_id = kot.print_jobs[0].id if kot.print_jobs else None

            results.append(
                KOTResponse(
                    id=kot.id,
                    kot_number=kot.kot_number,
                    sequence_number=kot.sequence_number,
                    business_date=kot.business_date,
                    table_number=kot.table.table_number if kot.table else f"#{kot.table_id}",
                    table_id=kot.table_id,
                    dining_session_id=kot.dining_session_id,
                    order_id=kot.order_id,
                    order_number=kot.order.order_number if kot.order else f"ORD-{kot.order_id}",
                    total_amount=kot.total_amount,
                    items_count=kot.items_count,
                    status=kot.status,
                    printed_status=kot.printed_status,
                    allergy_info=kot.allergy_info or (kot.order.allergy_info if kot.order else None),
                    created_at=kot.created_at,
                    items=items_list,
                    print_job_id=print_job_id,
                )
            )
        return results

    @staticmethod
    async def get_summary(
        db: AsyncSession,
        target_date: Optional[datetime.date] = None,
        tenant_id: Optional[uuid.UUID] = None,
    ) -> POSSummaryResponse:
        if not target_date:
            target_date = datetime.date.today()

        stmt = (
            select(KOT)
            .options(
                selectinload(KOT.order)
                .selectinload(Order.items)
                .selectinload(OrderItem.menu_item)
                .selectinload(MenuItem.category)
            )
            .where(KOT.business_date == target_date)
        )
        if tenant_id:
            stmt = stmt.join(Table, KOT.table_id == Table.id).where(Table.tenant_id == tenant_id)
        stmt = stmt.order_by(KOT.created_at.asc())
        res = await db.execute(stmt)
        kots = res.scalars().all()

        total_kots = len(kots)
        tables_served = len({k.table_id for k in kots})
        total_items = sum(k.items_count for k in kots)
        total_val = sum(k.total_amount for k in kots)

        avg_items_per_kot = round(total_items / total_kots, 2) if total_kots > 0 else 0.0
        avg_kot_value = round(float(total_val) / total_kots, 2) if total_kots > 0 else 0.0

        # Hourly breakdown & peak hour
        hour_counts = defaultdict(int)
        for k in kots:
            hour_counts[k.created_at.hour] += 1

        if hour_counts:
            peak_hour_int = max(hour_counts, key=hour_counts.get)
            peak_hour_str = POSService._format_hour(peak_hour_int)
            active_hours = max(len(hour_counts), 1)
            kots_per_hour = round(total_kots / active_hours, 1)
        else:
            peak_hour_str = "None"
            kots_per_hour = 0.0

        # Item & category breakdown
        item_counter = defaultdict(int)
        cat_counter = defaultdict(int)

        for k in kots:
            if k.order and k.order.items:
                for oi in k.order.items:
                    m_item = oi.menu_item
                    item_name = m_item.name if m_item else "Item"
                    cat_name = m_item.category.name if (m_item and m_item.category) else "General"
                    item_counter[item_name] += oi.quantity
                    cat_counter[cat_name] += oi.quantity

        sorted_items = [
            ItemSummaryResponse(name=name, quantity=qty)
            for name, qty in sorted(item_counter.items(), key=lambda x: x[1], reverse=True)
        ]

        sorted_categories = [
            CategorySummaryResponse(category=cat, quantity=qty)
            for cat, qty in sorted(cat_counter.items(), key=lambda x: x[1], reverse=True)
        ]

        # Yesterday comparison
        yesterday_date = target_date - datetime.timedelta(days=1)
        yest_stmt = (
            select(KOT)
            .options(
                selectinload(KOT.order)
                .selectinload(Order.items)
                .selectinload(OrderItem.menu_item)
                .selectinload(MenuItem.category)
            )
            .where(KOT.business_date == yesterday_date)
        )
        if tenant_id:
            yest_stmt = yest_stmt.join(Table, KOT.table_id == Table.id).where(Table.tenant_id == tenant_id)
        yest_res = await db.execute(yest_stmt)
        yest_kots = yest_res.scalars().all()

        yest_cat_counts = defaultdict(int)
        for yk in yest_kots:
            if yk.order and yk.order.items:
                for oi in yk.order.items:
                    m_item = oi.menu_item
                    cat_name = (m_item.category.name.lower() if m_item and m_item.category else "other")
                    yest_cat_counts[cat_name] += oi.quantity

        def _get_cat_qty(counter_dict, search_key):
            for k, v in counter_dict.items():
                if search_key in k.lower():
                    return v
            return 0

        comparison = {
            "today": {
                "kots": total_kots,
                "pizzas": _get_cat_qty(cat_counter, "pizza"),
                "pasta": _get_cat_qty(cat_counter, "pasta"),
                "beverages": _get_cat_qty(cat_counter, "beverag") + _get_cat_qty(cat_counter, "drink"),
            },
            "yesterday": {
                "kots": len(yest_kots),
                "pizzas": _get_cat_qty(yest_cat_counts, "pizza"),
                "pasta": _get_cat_qty(yest_cat_counts, "pasta"),
                "beverages": _get_cat_qty(yest_cat_counts, "beverag") + _get_cat_qty(yest_cat_counts, "drink"),
            },
        }

        return POSSummaryResponse(
            business_date=target_date.strftime("%d %B %Y"),
            total_kots=total_kots,
            tables_served=tables_served,
            total_items=total_items,
            avg_items_per_kot=avg_items_per_kot,
            avg_kot_value=avg_kot_value,
            kots_per_hour=kots_per_hour,
            peak_hour=peak_hour_str,
            item_summary=sorted_items,
            category_summary=sorted_categories,
            comparison=comparison,
        )

    @staticmethod
    async def claim_kot_print(db: AsyncSession, kot_id: int, force: bool = False, tenant_id: Optional[uuid.UUID] = None) -> dict:
        """Atomically claim a KOT for printing on this device and return the ticket content.

        Only one device can claim a KOT (PENDING/FAILED -> PRINTING), so two POS screens with
        auto-print on never print it twice. force=True reprints regardless of status.
        """
        from sqlalchemy import update

        if tenant_id:
            check_stmt = select(KOT).join(Table, KOT.table_id == Table.id).where(KOT.id == kot_id, Table.tenant_id == tenant_id)
            c_res = await db.execute(check_stmt)
            if not c_res.scalar_one_or_none():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KOT not found.")

        stmt = update(KOT).where(KOT.id == kot_id)
        if not force:
            stmt = stmt.where(KOT.printed_status.in_(["PENDING", "FAILED"]))
        claimed = (await db.execute(stmt.values(printed_status="PRINTING"))).rowcount
        await db.commit()
        if not claimed:
            exists = await db.get(KOT, kot_id)
            if not exists:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KOT not found.")
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="ALREADY_CLAIMED: This KOT is already printed or printing.")

        kot = (
            await db.execute(
                select(KOT)
                .options(
                    selectinload(KOT.table),
                    selectinload(KOT.order).selectinload(Order.items).selectinload(OrderItem.menu_item),
                )
                .where(KOT.id == kot_id)
            )
        ).scalar_one()
        items = [
            {
                "name": oi.menu_item.name if oi.menu_item else "Item",
                "quantity": oi.quantity,
                "special_instructions": oi.special_instructions,
            }
            for oi in (kot.order.items if kot.order else [])
        ]
        return {
            "kot_id": kot.id,
            "kot_number": kot.kot_number,
            "table_id": kot.table_id,
            "table_number": kot.table.table_number if kot.table else None,
            "order_number": kot.order.order_number if kot.order else None,
            "allergy_info": kot.allergy_info or (kot.order.allergy_info if kot.order else None),
            "created_at": kot.created_at.isoformat(),
            "items": items,
        }

    @staticmethod
    async def mark_kot_printed(db: AsyncSession, kot_id: int, success: bool, tenant_id: Optional[uuid.UUID] = None) -> dict:
        if tenant_id:
            check_stmt = select(KOT).join(Table, KOT.table_id == Table.id).where(KOT.id == kot_id, Table.tenant_id == tenant_id)
            c_res = await db.execute(check_stmt)
            if not c_res.scalar_one_or_none():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KOT not found.")
        kot = await db.get(KOT, kot_id)
        if not kot:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KOT not found.")
        kot.printed_status = "PRINTED" if success else "FAILED"
        await db.commit()
        from app.api.websocket import ws_manager
        await ws_manager.broadcast("pos", {"event": "KOT_UPDATED", "kot_id": kot.id, "kot_number": kot.kot_number, "printed_status": kot.printed_status})
        return {"kot_id": kot.id, "printed_status": kot.printed_status}

    @staticmethod
    async def retry_kot_print(db: AsyncSession, kot_id: int, tenant_id: Optional[uuid.UUID] = None) -> dict:
        if tenant_id:
            check_stmt = select(KOT).join(Table, KOT.table_id == Table.id).where(KOT.id == kot_id, Table.tenant_id == tenant_id)
            c_res = await db.execute(check_stmt)
            if not c_res.scalar_one_or_none():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"KOT #{kot_id} not found.")

        stmt = (
            select(KOT)
            .options(
                selectinload(KOT.table),
                selectinload(KOT.order).selectinload(Order.items).selectinload(OrderItem.menu_item),
                selectinload(KOT.print_jobs),
            )
            .where(KOT.id == kot_id)
        )
        res = await db.execute(stmt)
        kot = res.scalar_one_or_none()
        if not kot:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"KOT #{kot_id} not found.")

        # Find or create PrintJob
        print_job = kot.print_jobs[0] if kot.print_jobs else None
        if not print_job:
            ticket_lines = [
                "================================",
                "          JAADOO CAFE           ",
                "================================",
                f"{kot.kot_number}        TABLE: {kot.table.table_number if kot.table else kot.table_id}",
                f"Date: {kot.business_date.strftime('%d %b %Y')}",
                f"Time: {kot.created_at.strftime('%I:%M %p')}",
                "--------------------------------",
            ]
            allergy_txt = kot.allergy_info or (kot.order.allergy_info if kot.order else None)
            if allergy_txt:
                ticket_lines.extend([
                    "********************************",
                    f"ALLERGY NOTE: {allergy_txt.upper()}",
                    "********************************",
                    "--------------------------------",
                ])
            if kot.order and kot.order.items:
                for oi in kot.order.items:
                    name = oi.menu_item.name if oi.menu_item else "Item"
                    line = f"{oi.quantity} x {name}"
                    if oi.special_instructions:
                        line += f" ({oi.special_instructions})"
                    ticket_lines.append(line)
            ticket_lines.extend([
                "--------------------------------",
                f"Total Items: {kot.items_count}",
                f"Total: Rs. {kot.total_amount}",
                "================================",
            ])
            print_job = PrintJob(
                kot_id=kot.id,
                ticket_content="\n".join(ticket_lines),
                status="PENDING",
            )
            db.add(print_job)
            await db.flush()

        print_job.status = "RETRYING"
        kot.printed_status = "PENDING"
        await db.commit()

        # Attempt print execution
        from app.workers.celery_app import _verify_and_execute_print_job
        try:
            await _verify_and_execute_print_job(print_job.id, db=db)
        except Exception:
            kot.printed_status = "FAILED"
            print_job.status = "FAILED"
            await db.commit()

        await db.refresh(kot)
        return {
            "kot_id": kot.id,
            "kot_number": kot.kot_number,
            "printed_status": kot.printed_status,
            "message": f"Print retry processed. Status: {kot.printed_status}",
        }

    @staticmethod
    async def close_dining_session(db: AsyncSession, session_id: int, payment_mode: Optional[str] = None, tenant_id: Optional[uuid.UUID] = None) -> dict:
        # ponytail: row lock and idempotency check to prevent duplicate settlements
        stmt = (
            select(DiningSession)
            .options(selectinload(DiningSession.table))
            .where(DiningSession.id == session_id)
            .with_for_update()
        )
        res = await db.execute(stmt)
        sess = res.scalar_one_or_none()
        if not sess:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Dining session #{session_id} not found.")

        if tenant_id and sess.table and sess.table.tenant_id != tenant_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Dining session #{session_id} not found.")

        if sess.status == "CLOSED":
            return {"message": f"Dining session #{session_id} is already settled and closed."}

        sess.status = "CLOSED"
        sess.closed_at = utc_now()
        if sess.table:
            sess.table.status = "Available"

        # Also complete all KOT tickets for this session
        kot_stmt = select(KOT).where(KOT.dining_session_id == session_id)
        kot_res = await db.execute(kot_stmt)
        for kot in kot_res.scalars().all():
            kot.status = "COMPLETED"

        # Also mark all orders for this session as BILLED
        ord_stmt = select(Order).where(Order.dining_session_id == session_id)
        ord_res = await db.execute(ord_stmt)
        for ord_item in ord_res.scalars().all():
            ord_item.status = "BILLED"

        # Generate or finalize bill and credit reservation deposit
        from app.services.billing_service import BillingService
        bill = await BillingService.get_or_calculate_bill(db, session_id)
        if bill:
            bill.is_paid = True
            # Record how it was paid (feeds the dashboard payment breakdown); one payment per bill
            if payment_mode and bill.total_amount and bill.total_amount > 0:
                from app.models.billing import Payment
                already = (await db.execute(select(func.count(Payment.id)).where(Payment.bill_id == bill.id))).scalar() or 0
                if not already:
                    db.add(Payment(bill_id=bill.id, payment_method=payment_mode, amount_paid=bill.total_amount))

        # Complete any seated reservations for this table or session
        from app.models.reservation import Reservation
        res_stmt = select(Reservation).where(
            (Reservation.table_id == sess.table_id) | (Reservation.id == sess.reservation_id),
            Reservation.status.in_(["ARRIVED", "SEATED"]),
        )
        res_res = await db.execute(res_stmt)
        for r in res_res.scalars().all():
            r.status = "COMPLETED"
            if not r.is_deposit_credited and r.payment_status == "PAID":
                r.is_deposit_credited = True
                if bill:
                    r.credited_bill_id = bill.id

        await db.commit()

        from app.api.websocket import ws_manager
        close_event = {
            "event": "SESSION_CLOSED",
            "session_id": sess.id,
            "table_id": sess.table_id,
            "table_number": sess.table.table_number if sess.table else None,
        }
        await ws_manager.broadcast("tables", close_event)
        await ws_manager.broadcast("pos", close_event)

        return {"message": f"Dining session #{session_id} settled and closed successfully. Table is now Available."}

    @staticmethod
    async def settle_table_by_id(db: AsyncSession, table_id: int, payment_mode: Optional[str] = None, tenant_id: Optional[uuid.UUID] = None) -> dict:
        table = await db.get(Table, table_id)
        if not table or (tenant_id and table.tenant_id != tenant_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Table #{table_id} not found.")

        session_stmt = (
            select(DiningSession)
            .where(
                DiningSession.table_id == table_id,
                DiningSession.status.in_(["OPENED", "ACTIVE", "CHECKOUT"]),
            )
            .order_by(DiningSession.opened_at.desc())
            .with_for_update()
        )
        res = await db.execute(session_stmt)
        sess = res.scalar_one_or_none()
        if not sess:
            table.status = "Available"
            await db.commit()
            return {"message": f"Table #{table_id} is already Available (no active dining session)."}

        return await POSService.close_dining_session(db, session_id=sess.id, payment_mode=payment_mode, tenant_id=tenant_id)

    @staticmethod
    async def reset_all_sessions(db: AsyncSession, tenant_id: Optional[uuid.UUID] = None) -> dict:
        """Force reset/close all active dining sessions across all tables."""
        session_stmt = (
            select(DiningSession)
            .join(Table, DiningSession.table_id == Table.id)
            .where(
                DiningSession.status.in_(["OPENED", "ACTIVE", "CHECKOUT"])
            )
        )
        if tenant_id:
            session_stmt = session_stmt.where(Table.tenant_id == tenant_id)
        res = await db.execute(session_stmt)
        active_sessions = res.scalars().all()

        count = len(active_sessions)

        # Record each open table's bill (left unpaid) before force-closing, so totals aren't lost
        from app.services.billing_service import BillingService
        unbilled_ids = [
            s.id for s in active_sessions
            if (await db.execute(select(func.count(Order.id)).where(Order.dining_session_id == s.id))).scalar()
        ]
        for sid in unbilled_ids:
            await BillingService.get_or_calculate_bill(db, sid)

        res = await db.execute(session_stmt)  # reload after the billing commits
        active_sessions = res.scalars().all()
        now = utc_now()

        for sess in active_sessions:
            sess.status = "CLOSED"
            sess.closed_at = now

        # Set all tables to Available
        table_stmt = select(Table)
        if tenant_id:
            table_stmt = table_stmt.where(Table.tenant_id == tenant_id)
        table_res = await db.execute(table_stmt)
        for tbl in table_res.scalars().all():
            tbl.status = "Available"

        # Complete active KOTs
        kot_stmt = select(KOT).join(Table, KOT.table_id == Table.id).where(KOT.status != "COMPLETED")
        if tenant_id:
            kot_stmt = kot_stmt.where(Table.tenant_id == tenant_id)
        kot_res = await db.execute(kot_stmt)
        for kot in kot_res.scalars().all():
            kot.status = "COMPLETED"

        await db.commit()

        from app.api.websocket import ws_manager
        reset_event = {
            "event": "SESSIONS_RESET",
            "message": f"All {count} active sessions have been reset and closed.",
        }
        await ws_manager.broadcast("tables", reset_event)
        await ws_manager.broadcast("pos", reset_event)

        return {"message": f"Successfully reset all {count} active sessions. All tables are now set to Available."}

    @staticmethod
    async def get_table_sessions(
        db: AsyncSession,
        target_date: Optional[datetime.date] = None,
        tenant_id: Optional[uuid.UUID] = None,
    ) -> List[TableOverviewResponse]:
        """Fetch all tables with their chronological dining sessions and ordered items."""
        if not target_date:
            target_date = datetime.date.today()

        now_naive = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
        twenty_four_hours_ago = now_naive - datetime.timedelta(hours=24)
        target_start = datetime.datetime.combine(target_date, datetime.time.min)
        target_end = datetime.datetime.combine(target_date, datetime.time.max)

        # 1. Fetch tables
        tbl_stmt = select(Table)
        if tenant_id:
            tbl_stmt = tbl_stmt.where(Table.tenant_id == tenant_id)
        tbl_stmt = tbl_stmt.order_by(Table.id.asc())
        tbl_res = await db.execute(tbl_stmt)
        tables = tbl_res.scalars().all()

        # 2. Fetch only active or today/recent sessions in a single targeted query
        session_stmt = (
            select(DiningSession)
            .join(Table, DiningSession.table_id == Table.id)
            .where(
                or_(
                    DiningSession.status.in_(["OPENED", "ACTIVE", "CHECKOUT"]),
                    DiningSession.opened_at >= twenty_four_hours_ago,
                    DiningSession.closed_at >= twenty_four_hours_ago,
                    DiningSession.opened_at.between(target_start, target_end),
                    DiningSession.closed_at.between(target_start, target_end),
                )
            )
        )
        if tenant_id:
            session_stmt = session_stmt.where(Table.tenant_id == tenant_id)
        session_stmt = (
            session_stmt.options(
                selectinload(DiningSession.orders).selectinload(Order.items).selectinload(OrderItem.menu_item),
                selectinload(DiningSession.customer),
                selectinload(DiningSession.reservation),
                selectinload(DiningSession.bills),
            )
            .order_by(DiningSession.opened_at.asc())
        )
        sess_res = await db.execute(session_stmt)
        all_sessions = sess_res.scalars().all()

        table_sessions_map: Dict[int, List[DiningSession]] = defaultdict(list)
        for s in all_sessions:
            if s.table_id:
                # Filter strictly matching criteria
                s_opened = s.opened_at.replace(tzinfo=None) if s.opened_at else None
                s_closed = s.closed_at.replace(tzinfo=None) if s.closed_at else None
                if s.status in ["OPENED", "ACTIVE", "CHECKOUT"]:
                    table_sessions_map[s.table_id].append(s)
                elif target_date == datetime.date.today():
                    if (s_opened and s_opened >= twenty_four_hours_ago) or (s_closed and s_closed >= twenty_four_hours_ago):
                        table_sessions_map[s.table_id].append(s)
                    elif (s_opened and s_opened.date() == target_date) or (s_closed and s_closed.date() == target_date):
                        table_sessions_map[s.table_id].append(s)
                else:
                    if (s_opened and s_opened.date() == target_date) or (s_closed and s_closed.date() == target_date):
                        table_sessions_map[s.table_id].append(s)

        # 3. Fetch active reservations for target_date in a single batch query (resolves N+1 query bottleneck)
        res_stmt = select(Reservation).where(
            Reservation.reservation_date == target_date,
            Reservation.status.in_(["CONFIRMED", "ARRIVED", "SEATED", "HOLD", "PAYMENT_PENDING"])
        )
        active_res_res = await db.execute(res_stmt)
        active_reservations = active_res_res.scalars().all()

        res_by_table_id: Dict[int, Reservation] = {}
        res_by_floor_table: Dict[Tuple[int, str], Reservation] = {}
        for r in active_reservations:
            if r.table_id and r.table_id not in res_by_table_id:
                res_by_table_id[r.table_id] = r
            if r.floor_number is not None and r.table_name:
                key = (r.floor_number, r.table_name)
                if key not in res_by_floor_table:
                    res_by_floor_table[key] = r

        # 4. Fetch deposit remainder policy once (instead of per-session inside loops)
        from app.services.settings_service import SettingsService
        rem_policy = await SettingsService.get_deposit_remainder_policy(db)

        results: List[TableOverviewResponse] = []

        for tbl in tables:
            relevant_sessions = table_sessions_map.get(tbl.id, [])
            # Sort chronologically (oldest session first so seq numbers are 1, 2, 3...)
            relevant_sessions.sort(key=lambda s: s.opened_at or datetime.datetime.min)

            session_details: List[TableSessionDetail] = []
            active_count = 0

            for seq, sess in enumerate(relevant_sessions, start=1):
                is_active = sess.status in ["OPENED", "ACTIVE", "CHECKOUT"]
                is_settled = sess.status in ["PAID", "CLOSED"]
                if is_active:
                    active_count += 1

                # Aggregate items from all non-cancelled orders in this session
                aggregated_items = {}
                session_total = Decimal("0.00")
                total_items_count = 0

                for ord in (sess.orders or []):
                    if ord.status == "CANCELLED":
                        continue
                    for oi in (ord.items or []):
                        item_name = oi.menu_item.name if oi.menu_item else "Unknown Item"
                        price = oi.unit_price or Decimal("0.00")
                        subtotal = oi.subtotal or (price * oi.quantity)
                        session_total += subtotal
                        total_items_count += oi.quantity

                        key = (oi.menu_item_id, price)  # by menu item, not name: same-named dishes stay apart
                        if key not in aggregated_items:
                            aggregated_items[key] = {
                                "menu_item_id": oi.menu_item_id,
                                "name": item_name,
                                "quantity": oi.quantity,
                                "unit_price": price,
                                "subtotal": subtotal,
                                "special_instructions": oi.special_instructions,
                            }
                        else:
                            aggregated_items[key]["quantity"] += oi.quantity
                            aggregated_items[key]["subtotal"] += subtotal
                            if oi.special_instructions and not aggregated_items[key]["special_instructions"]:
                                aggregated_items[key]["special_instructions"] = oi.special_instructions

                items_list = [
                    SessionItemDetail(
                        menu_item_id=v["menu_item_id"],
                        name=v["name"],
                        quantity=v["quantity"],
                        unit_price=v["unit_price"],
                        subtotal=v["subtotal"],
                        special_instructions=v["special_instructions"],
                    )
                    for v in aggregated_items.values()
                ]

                bill_rec = sess.bills[-1] if sess.bills else None
                disc_amt = compute_discount_amount(
                    session_total,
                    bill_rec.discount_type if bill_rec else None,
                    bill_rec.discount_value if bill_rec else 0,
                )
                tax_amt = ((session_total - disc_amt) * Decimal("0.05")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                gross_amt = session_total - disc_amt + tax_amt
                dep_paid = Decimal("0.00")
                res_credit = Decimal("0.00")
                rem_action = None
                rem_amount = Decimal("0.00")
                net_due = gross_amt

                if bill_rec and not is_active:
                    # Settled: show what was actually billed
                    dep_paid = bill_rec.reservation_deposit_paid or Decimal("0.00")
                    res_credit = bill_rec.reservation_credit or Decimal("0.00")
                    net_due = bill_rec.total_amount
                    rem_action = bill_rec.remainder_action
                    rem_amount = bill_rec.remainder_amount or Decimal("0.00")
                elif (bill_rec and (bill_rec.reservation_deposit_paid or 0) > 0) or (
                    sess.reservation and sess.reservation.payment_status == "PAID"
                ):
                    # Open bill: recompute live, since a stored bill (e.g. created when a discount
                    # was applied) goes stale when items change
                    if bill_rec and (bill_rec.reservation_deposit_paid or 0) > 0:
                        dep_paid = bill_rec.reservation_deposit_paid
                    else:
                        dep_paid = Decimal(str(sess.reservation.advance_amount or "0.00"))
                    res_credit = min(gross_amt, dep_paid)
                    net_due = max(Decimal("0.00"), gross_amt - res_credit)
                    if gross_amt < dep_paid:
                        rem_action = rem_policy
                        rem_amount = dep_paid - gross_amt

                session_details.append(
                    TableSessionDetail(
                        session_id=sess.id,
                        session_seq=seq,
                        session_token=sess.session_token,
                        status=sess.status,
                        opened_at=sess.opened_at,
                        closed_at=sess.closed_at,
                        customer_name=sess.customer.name if sess.customer else None,
                        total_amount=session_total,
                        items_count=total_items_count,
                        is_active=is_active,
                        is_settled=is_settled,
                        allergy_info=sess.allergy_info,
                        items=items_list,
                        reservation_id=sess.reservation_id,
                        subtotal=session_total,
                        tax_amount=tax_amt,
                        gross_amount=gross_amt,
                        reservation_deposit_paid=dep_paid,
                        reservation_credit=res_credit,
                        net_amount_due=net_due,
                        remainder_action=rem_action,
                        remainder_amount=rem_amount,
                        discount_type=bill_rec.discount_type if bill_rec else None,
                        discount_value=bill_rec.discount_value if bill_rec else Decimal("0.00"),
                        discount_amount=disc_amt,
                        discount_reason=bill_rec.discount_reason if bill_rec else None,
                    )
                )

            # Check if table has an active reservation for target_date using fast lookup
            active_res_record = res_by_table_id.get(tbl.id) or res_by_floor_table.get(
                (tbl.floor_number, f"Table {tbl.floor_table_num}")
            )

            if active_count > 0:
                table_status = "Occupied"
            elif active_res_record:
                table_status = "Reserved"
            else:
                table_status = tbl.status or "Available"

            results.append(
                TableOverviewResponse(
                    table_id=tbl.id,
                    table_number=tbl.table_number or f"Table {tbl.floor_table_num}",
                    capacity=tbl.capacity,
                    status=table_status,
                    active_session_count=active_count,
                    total_sessions_today=len(session_details),
                    sessions=session_details,
                    floor_number=tbl.floor_number,
                    floor_name=tbl.floor_name,
                    floor_table_num=tbl.floor_table_num,
                )
            )

        return results

    @staticmethod
    async def merge_tables(db: AsyncSession, source_table_id: int, target_table_id: int, tenant_id: Optional[uuid.UUID] = None) -> dict:
        if source_table_id == target_table_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Source and target tables must be different.")

        source_tbl = await db.get(Table, source_table_id)
        target_tbl = await db.get(Table, target_table_id)
        if not source_tbl or not target_tbl:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source or target table not found.")

        if tenant_id and (source_tbl.tenant_id != tenant_id or target_tbl.tenant_id != tenant_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source or target table not found.")

        source_sess_stmt = (
            select(DiningSession)
            .where(
                DiningSession.table_id == source_table_id,
                DiningSession.status.in_(["OPENED", "ACTIVE", "CHECKOUT"]),
            )
            .order_by(DiningSession.opened_at.desc())
        )
        source_sess_res = await db.execute(source_sess_stmt)
        source_sess = source_sess_res.scalar_one_or_none()
        if not source_sess:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"No active dining session found on source Table #{source_table_id}.")

        target_sess_stmt = (
            select(DiningSession)
            .where(
                DiningSession.table_id == target_table_id,
                DiningSession.status.in_(["OPENED", "ACTIVE", "CHECKOUT"]),
            )
            .order_by(DiningSession.opened_at.desc())
        )
        target_sess_res = await db.execute(target_sess_stmt)
        target_sess = target_sess_res.scalar_one_or_none()

        if not target_sess:
            source_sess.table_id = target_table_id
            target_tbl.status = "Occupied"
            source_tbl.status = "Available"
        else:
            orders_stmt = select(Order).where(Order.dining_session_id == source_sess.id)
            orders_res = await db.execute(orders_stmt)
            for ord_item in orders_res.scalars().all():
                ord_item.dining_session_id = target_sess.id

            kots_stmt = select(KOT).where(KOT.dining_session_id == source_sess.id)
            kots_res = await db.execute(kots_stmt)
            for kot in kots_res.scalars().all():
                kot.dining_session_id = target_sess.id
                kot.table_id = target_table_id
                kot.table_number = target_tbl.table_number

            source_sess.status = "CLOSED"
            source_sess.closed_at = utc_now()
            source_tbl.status = "Available"

        await db.commit()

        from app.api.websocket import ws_manager
        merge_event = {
            "event": "TABLES_MERGED",
            "source_table_id": source_table_id,
            "target_table_id": target_table_id,
        }
        await ws_manager.broadcast("tables", merge_event)
        await ws_manager.broadcast("pos", merge_event)

        return {
            "message": f"Table #{source_table_id} merged into Table #{target_table_id} successfully.",
            "source_table_id": source_table_id,
            "target_table_id": target_table_id,
        }

    @staticmethod
    async def seat_walk_in(
        db: AsyncSession,
        table_id: int,
        customer_name: Optional[str] = None,
        guest_count: Optional[int] = None,
        tenant_id: Optional[uuid.UUID] = None,
    ) -> dict:
        table = await db.get(Table, table_id)
        if not table or (tenant_id and table.tenant_id != tenant_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Table not found.")
        if guest_count is not None and table.capacity and guest_count > table.capacity:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{table.table_number or 'This table'} seats {table.capacity}. Choose a bigger table for {guest_count} guests.",
            )

        session_stmt = (
            select(DiningSession)
            .where(
                DiningSession.table_id == table_id,
                DiningSession.status.in_(["OPENED", "ACTIVE", "CHECKOUT"]),
            )
            .order_by(DiningSession.opened_at.desc())
        )
        sess_res = await db.execute(session_stmt)
        active_sess = sess_res.scalar_one_or_none()

        if active_sess:
            # Only reuse a session nobody is using yet (e.g. the guest just scanned the QR);
            # never seat a new party onto another party's running bill or reservation
            has_orders = (
                await db.execute(select(func.count(Order.id)).where(Order.dining_session_id == active_sess.id))
            ).scalar() or 0
            if has_orders or active_sess.reservation_id or active_sess.status in ("ACTIVE", "CHECKOUT"):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"{table.table_number or 'This table'} is occupied. Settle it first or choose another table.",
                )
            # Seat the party on the scanned-but-unused session: start its clock now
            active_sess.status = "ACTIVE"
            active_sess.opened_at = utc_now()
            table.status = "Occupied"
            await db.commit()
            return {
                "message": f"Table #{table.table_number or table_id} already has an active session.",
                "session_id": active_sess.id,
                "session_token": active_sess.session_token,
            }

        import secrets
        new_session = DiningSession(
            table_id=table_id,
            session_token=f"sess_tok_{secrets.token_urlsafe(32)}",
            status="ACTIVE",
        )
        db.add(new_session)
        table.status = "Occupied"
        await db.commit()
        await db.refresh(new_session)

        from app.api.websocket import ws_manager
        event = {
            "event": "TABLE_OCCUPIED",
            "table_id": table_id,
            "session_id": new_session.id,
            "customer_name": customer_name,
            "guest_count": guest_count,
        }
        await ws_manager.broadcast("tables", event)
        await ws_manager.broadcast("pos", event)

        return {
            "message": f"Walk-in seated successfully at Table #{table.table_number or table_id}.",
            "session_id": new_session.id,
            "session_token": new_session.session_token,
        }

    @staticmethod
    async def update_session_items(
        db: AsyncSession,
        session_id: int,
        items: List[dict],
        tenant_id: Optional[uuid.UUID] = None,
    ) -> dict:
        from app.schemas.order import MAX_ITEM_QUANTITY

        session = await db.get(DiningSession, session_id)
        if not session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dining session not found.")
        if tenant_id:
            tbl = await db.get(Table, session.table_id)
            if not tbl or tbl.tenant_id != tenant_id:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dining session not found.")
        if session.status not in ("OPENED", "ACTIVE", "CHECKOUT"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This bill is already settled and can no longer be edited.")
        if not isinstance(items, list):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Items must be a list.")

        # Validate every requested line up front: real menu dish, whole-number quantity 0..MAX (0 removes)
        req_by_id: dict[int, dict] = {}
        req_by_name: dict[str, dict] = {}
        for it in items:
            name = str((it or {}).get("name") or "").strip()
            raw_id = (it or {}).get("menu_item_id")
            item_id = raw_id if isinstance(raw_id, int) and not isinstance(raw_id, bool) and raw_id > 0 else None
            if not name and item_id is None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Every item needs a name.")
            raw_qty = (it or {}).get("quantity", 0)
            if isinstance(raw_qty, bool) or not (isinstance(raw_qty, int) or (isinstance(raw_qty, str) and raw_qty.strip().isdigit())):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Quantity for {name} must be a whole number from 0 to {MAX_ITEM_QUANTITY}.")
            qty = int(raw_qty)
            if qty < 0 or qty > MAX_ITEM_QUANTITY:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Quantity for {name} must be a whole number from 0 to {MAX_ITEM_QUANTITY}.")
            if qty > 0:
                if item_id is not None:
                    req_by_id[item_id] = {**it, "quantity": qty}
                else:
                    req_by_name[" ".join(name.split()).lower()] = {**it, "quantity": qty}

        menu_by_id: dict[int, MenuItem] = {}
        if req_by_id:
            m_stmt = select(MenuItem).where(MenuItem.id.in_(list(req_by_id)), MenuItem.is_active == True)
            if tenant_id:
                m_stmt = m_stmt.where(MenuItem.tenant_id == tenant_id)
            rows = (await db.execute(m_stmt)).scalars().all()
            menu_by_id = {m.id: m for m in rows}
            unknown = [str(it.get("name") or f"item #{i}") for i, it in req_by_id.items() if i not in menu_by_id]
            if unknown:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Not on the menu: {', '.join(unknown)}.")
        if req_by_name:
            # Older POS screens send only names: resolve them, but never guess between same-named dishes
            # Compare names ignoring stray spaces ("MARINARA " == "Marinara")
            m_stmt = select(MenuItem).where(MenuItem.is_active == True)
            if tenant_id:
                m_stmt = m_stmt.where(MenuItem.tenant_id == tenant_id)
            rows = (await db.execute(m_stmt)).scalars().all()
            for key, it in req_by_name.items():
                matches = [m for m in rows if " ".join(m.name.split()).lower() == key]
                if not matches:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Not on the menu: {it['name']}.")
                if len(matches) > 1:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"More than one menu item is called {it['name']}. Refresh POS and edit the bill again.",
                    )
                menu_by_id[matches[0].id] = matches[0]
                req_by_id[matches[0].id] = it

        orders_stmt = select(Order).options(selectinload(Order.items).selectinload(OrderItem.menu_item)).where(Order.dining_session_id == session_id)
        orders_res = await db.execute(orders_stmt)
        orders = orders_res.scalars().all()

        if not orders:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No orders found for this session to edit.")

        latest_order = orders[-1]

        for ord in orders:
            for oi in list(ord.items):
                if oi.menu_item_id in req_by_id:
                    new_qty = int(req_by_id[oi.menu_item_id]["quantity"])
                    oi.quantity = new_qty
                    oi.subtotal = Decimal(str(oi.unit_price)) * new_qty
                    del req_by_id[oi.menu_item_id]
                else:
                    await db.delete(oi)

        for item_id, it_data in req_by_id.items():
            m_item = menu_by_id[item_id]
            if m_item:
                qty = it_data["quantity"]
                price = Decimal(str(m_item.price))  # always the menu price; client prices are ignored
                new_oi = OrderItem(
                    order_id=latest_order.id,
                    menu_item_id=m_item.id,
                    quantity=qty,
                    unit_price=price,
                    subtotal=price * qty,
                    special_instructions=it_data.get("special_instructions"),
                )
                db.add(new_oi)

        await db.commit()

        from app.api.websocket import ws_manager
        event = {
            "event": "ORDER_UPDATED",
            "dining_session_id": session_id,
        }
        await ws_manager.broadcast("pos", event)
        await ws_manager.broadcast("tables", event)

        return {"message": "Session items updated successfully.", "session_id": session_id}

