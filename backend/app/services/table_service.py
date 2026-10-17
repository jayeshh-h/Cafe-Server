import secrets
import datetime
import uuid
from app.utils.helpers import utc_now
from typing import Optional, List
from sqlalchemy import select, or_, and_, func
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException, status
from app.core.config import settings
from app.models.table import Table, TableQR, GeneralizedQR, DiningSession
from app.models.customer import Customer
from app.models.order import Order, OrderItem
from app.models.reservation import Reservation
from app.schemas.table import (
    QRValidateResponse,
    QRWalkInResponse,
    ReservationNotice,
    DiningSessionResponse,
    SessionBillResponse,
    SessionBillItemResponse,
    GeneralizedQRResponse,
    GeneralizedQRListResponse,
    ClaimReservationResponse,
)


class TableService:
    @staticmethod
    async def rotate_qr_token(db: AsyncSession, table_id: int) -> TableQR:
        table = await db.get(Table, table_id)
        if not table:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Table not found")

        # Fetch existing TableQR for this table if it exists
        qr_stmt = select(TableQR).where(TableQR.table_id == table_id)
        qr_res = await db.execute(qr_stmt)
        qr = qr_res.scalar_one_or_none()

        new_token = f"qr_sec_{secrets.token_urlsafe(32)}"
        if qr:
            qr.qr_token = new_token
            qr.is_active = True
        else:
            qr = TableQR(table_id=table_id, qr_token=new_token, is_active=True)
            db.add(qr)

        await db.commit()
        await db.refresh(qr)
        return qr


    @staticmethod
    async def get_or_create_dining_session(
        db: AsyncSession, table_id: int, tenant_id: Optional[uuid.UUID] = None
    ) -> DiningSession:
        """
        Triple-Layer Concurrency-Safe Dining Session Engine:
        1. PostgreSQL Transaction
        2. SELECT FOR UPDATE on Table row
        3. Database-level partial unique index (idx_unique_active_dining_session_per_table)
           with IntegrityError fallback handling.
        """
        # Lock table row to synchronize concurrent scans
        tbl_stmt = select(Table).where(Table.id == table_id).with_for_update()
        tbl_res = await db.execute(tbl_stmt)
        table = tbl_res.scalar_one_or_none()

        if not table or (tenant_id and getattr(table, "tenant_id", None) and table.tenant_id != tenant_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Table not found")

        # Check for existing active session (OPENED, ACTIVE, CHECKOUT)
        session_stmt = (
            select(DiningSession)
            .where(
                DiningSession.table_id == table_id,
                DiningSession.status.in_(["OPENED", "ACTIVE", "CHECKOUT"]),
            )
            .order_by(DiningSession.opened_at.desc())
        )
        session_res = await db.execute(session_stmt)
        active_session = session_res.scalars().first()

        if active_session:
            return active_session

        # Create new OPENED session
        # Table status remains Available (does not auto-occupy on scan)
        new_session_token = f"sess_tok_{secrets.token_urlsafe(32)}"
        new_session = DiningSession(
            table_id=table_id,
            session_token=new_session_token,
            status="OPENED",
        )

        try:
            async with db.begin_nested():
                db.add(new_session)
                await db.flush()
            await db.commit()
            await db.refresh(new_session)
            return new_session
        except IntegrityError:
            # Handle DB-level partial unique constraint race condition gracefully
            await db.rollback()
            session_res = await db.execute(session_stmt)
            fallback_session = session_res.scalar_one_or_none()
            if fallback_session:
                return fallback_session
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Unable to resolve dining session concurrency.",
            )

    @staticmethod
    async def validate_qr_token(
        db: AsyncSession,
        qr_token: str,
        expected_tenant_id: Optional[object] = None,
    ) -> QRValidateResponse:
        # 1. Check GeneralizedQR first
        gen_stmt = select(GeneralizedQR).where(GeneralizedQR.qr_token == qr_token)
        gen_res = await db.execute(gen_stmt)
        gen_qr = gen_res.scalar_one_or_none()

        if gen_qr:
            if not gen_qr.is_active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="INACTIVE_QR_CODE: This QR code has been deactivated. Please ask staff for an active QR code.",
                )

            table = await db.get(Table, 1)
            if not table:
                from app.utils.init_tables import ensure_default_tables
                await ensure_default_tables(db)
                table = await db.get(Table, 1)

            if expected_tenant_id and table and table.tenant_id != expected_tenant_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="INVALID_QR_TOKEN: QR code does not belong to this restaurant.",
                )

            new_session_token = f"sess_tok_{secrets.token_urlsafe(32)}"
            session = DiningSession(
                table_id=table.id if table else 1,
                session_token=new_session_token,
                status="OPENED",
            )
            db.add(session)
            await db.commit()
            await db.refresh(session)

            return QRValidateResponse(
                is_valid=True,
                table_id=table.id if table else 1,
                table_number="Table allotted by server",
                branch_id=table.branch_id if table else 1,
                session_id=session.id,
                session_token=session.session_token,
                session_status=session.status,
                is_reserved=False,
                reservation=None,
                is_generalized=True,
            )

        # 2. Check TableQR (specific physical table token)
        qr_stmt = select(TableQR).where(TableQR.qr_token == qr_token)
        qr_res = await db.execute(qr_stmt)
        qr = qr_res.scalar_one_or_none()

        if qr and not qr.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="INACTIVE_QR_CODE: This QR code has been deactivated. Please ask staff for an active QR code.",
            )

        if not qr:
            from app.utils.init_tables import DEFAULT_TABLES, ensure_default_tables
            matched_dt = next(
                (dt for dt in DEFAULT_TABLES if dt["qr_token"] == qr_token),
                None,
            )
            if matched_dt:
                await ensure_default_tables(db)
                qr_stmt2 = select(TableQR).where(
                    TableQR.qr_token == matched_dt["qr_token"],
                )
                qr2_res = await db.execute(qr_stmt2)
                qr = qr2_res.scalars().first()
                if qr and not qr.is_active:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="INACTIVE_QR_CODE: This QR code has been deactivated. Please ask staff for an active QR code.",
                    )

        if not qr:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="INVALID_QR_TOKEN: QR token is invalid, expired, or rotated.",
            )

        if not await db.get(Table, qr.table_id):
            qr.is_active = False
            await db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="INVALID_QR_TOKEN: Table has been removed or is inactive.",
            )

        table = await db.get(Table, qr.table_id)
        if not table or table.status == "Inactive":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="INACTIVE_TABLE: Table is currently inactive.",
            )

        if expected_tenant_id and table.tenant_id != expected_tenant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="INVALID_QR_TOKEN: QR code does not belong to this restaurant.",
            )

        session = await TableService.get_or_create_dining_session(db, table.id)

        # Check for active / upcoming reservation on this table
        res_stmt = (
            select(Reservation)
            .options(selectinload(Reservation.customer))
            .where(
                Reservation.tenant_id == table.tenant_id,
                or_(
                    Reservation.table_id == table.id,
                    Reservation.table_name == table.table_number,
                    and_(table.id == 1, or_(Reservation.table_id.is_(None), Reservation.table_id == 1)),
                ),
                Reservation.status.in_(["CONFIRMED", "ARRIVED", "SEATED"]),
            )
            .order_by(Reservation.reservation_date.asc(), Reservation.time_slot.asc())
        )
        res_res = await db.execute(res_stmt)
        candidate_reservations = res_res.scalars().all()

        from app.utils.helpers import calculate_reservation_window
        from app.workers.celery_app import celery_app

        active_res = None
        active_calc = None
        modified_status = False

        for res_item in candidate_reservations:
            calc = calculate_reservation_window(res_item.reservation_date, res_item.time_slot)

            # Rule 2: 15-Minute Grace Period & Auto-Release (No-Show Protection)
            if res_item.status == "CONFIRMED" and calc.get("grace_exceeded"):
                res_item.status = "NO_SHOW"
                if res_item.celery_task_id:
                    try:
                        celery_app.control.revoke(res_item.celery_task_id, terminate=True)
                    except Exception:
                        pass
                    res_item.celery_task_id = None
                modified_status = True
                continue

            # Rule 1: Time-Window Smart Filter (Don't Alert Lunch Guests for Dinner Bookings)
            # Only show "TABLE RESERVED" notice if within 60-90 min window or already arrived/seated
            if res_item.status == "CONFIRMED":
                if calc.get("is_within_alert_window"):
                    active_res = res_item
                    active_calc = calc
                    break
            elif res_item.status in ["ARRIVED", "SEATED"]:
                if calc.get("is_today") and not calc.get("grace_exceeded"):
                    active_res = res_item
                    active_calc = calc
                    break

        if modified_status:
            await db.commit()

        reservation_notice = None
        is_reserved = False
        if active_res:
            is_reserved = True
            cust_name = active_res.customer.name if active_res.customer else "Reserved Guest"
            can_qd = active_calc.get("can_quick_dine", False) if active_calc else False
            qd_mins = active_calc.get("quick_dine_minutes") if active_calc else None
            mins_until = active_calc.get("minutes_until") if active_calc else None

            reservation_notice = ReservationNotice(
                is_reserved=True,
                reservation_id=active_res.id,
                customer_name=cust_name,
                guest_count=active_res.guest_count,
                time_slot=active_res.time_slot,
                reservation_date=str(active_res.reservation_date),
                status=active_res.status,
                floor_number=active_res.floor_number or 1,
                table_name=active_res.table_name or table.table_number,
                minutes_until_reservation=mins_until,
                can_quick_dine=can_qd,
                quick_dine_minutes=qd_mins,
                allow_self_checkin=active_res.status in ["CONFIRMED", "ARRIVED"],
            )

        return QRValidateResponse(
            is_valid=True,
            table_id=table.id,
            table_number=table.table_number,
            branch_id=table.branch_id,
            session_id=session.id,
            session_token=session.session_token,
            session_status=session.status,
            is_reserved=is_reserved,
            reservation=reservation_notice,
        )

    @staticmethod
    async def get_session_bill(db: AsyncSession, session_id: int) -> SessionBillResponse:
        session = await db.get(DiningSession, session_id)
        if not session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dining session not found")

        table = await db.get(Table, session.table_id)
        table_number = table.table_number if table else f"T-{session.table_id}"

        # Query all orders for session with eager loaded items and menu_items
        orders_stmt = (
            select(Order)
            .where(Order.dining_session_id == session_id)
            .options(selectinload(Order.items).selectinload(OrderItem.menu_item))
        )
        orders_res = await db.execute(orders_stmt)
        orders = orders_res.scalars().all()

        aggregated_items: dict[str, dict] = {}
        subtotal = 0.0

        for order in orders:
            for item in order.items:
                qty = item.quantity
                price = float(item.unit_price or 0.0)
                tot = qty * price
                subtotal += tot
                name = item.menu_item.name if item.menu_item else "Menu Item"
                if name in aggregated_items:
                    aggregated_items[name]["quantity"] += qty
                    aggregated_items[name]["total"] += tot
                else:
                    aggregated_items[name] = {
                        "name": name,
                        "quantity": qty,
                        "price": price,
                        "total": tot,
                    }

        items = [
            SessionBillItemResponse(
                name=val["name"],
                quantity=val["quantity"],
                price=val["price"],
                total=round(val["total"], 2),
            )
            for val in aggregated_items.values()
        ]

        # Dynamic configurable tax rate
        tax_rate = float(getattr(settings, "DEFAULT_TAX_RATE", "0.05"))
        tax_amount = round(subtotal * tax_rate, 2)
        grand_total = round(subtotal + tax_amount, 2)

        return SessionBillResponse(
            session_id=session.id,
            table_number=table_number,
            status=session.status,
            items=items,
            subtotal=subtotal,
            tax_rate=tax_rate,
            tax_amount=tax_amount,
            grand_total=grand_total,
            allergy_info=session.allergy_info,
        )

    @staticmethod
    async def close_dining_session(db: AsyncSession, session_id: int) -> DiningSession:
        session = await db.get(DiningSession, session_id)
        if not session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dining session not found")

        session.status = "CLOSED"
        session.closed_at = datetime.datetime.now(datetime.timezone.utc)

        table = await db.get(Table, session.table_id)
        if table:
            table.status = "Available"

        await db.commit()
        await db.refresh(session)
        return session

    # ponytail: one-shot walk-in reservation generation reusing existing reservation & session models
    @staticmethod
    async def create_walk_in_reservation(
        db: AsyncSession,
        qr_token: str,
        customer_name: str,
        phone_number: str,
        guest_count: int = 2,
        expected_tenant_id: Optional[object] = None,
    ) -> QRWalkInResponse:
        # 1. Resolve table from qr_token
        is_generalized = False
        table = None

        gen_stmt = select(GeneralizedQR).where(GeneralizedQR.qr_token == qr_token)
        gen_res = await db.execute(gen_stmt)
        gen_qr = gen_res.scalar_one_or_none()

        if gen_qr:
            if not gen_qr.is_active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="INACTIVE_QR_CODE: This QR code has been deactivated. Please ask staff for an active QR code.",
                )
            is_generalized = True
            table = await db.get(Table, 1)
            if not table:
                from app.utils.init_tables import ensure_default_tables
                await ensure_default_tables(db)
                table = await db.get(Table, 1)
        else:
            qr_stmt = select(TableQR).where(TableQR.qr_token == qr_token)
            qr_res = await db.execute(qr_stmt)
            qr = qr_res.scalar_one_or_none()
            if qr and not qr.is_active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="INACTIVE_QR_CODE: This QR code has been deactivated. Please ask staff for an active QR code.",
                )
            if not qr:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired QR token.")
            table = await db.get(Table, qr.table_id)
            if not table:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Table not found.")

        if expected_tenant_id and table and table.tenant_id != expected_tenant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="INVALID_QR_TOKEN: QR code does not belong to this restaurant.",
            )

        # 2. Get or create Customer
        clean_name = customer_name.strip()
        clean_phone = "".join(filter(str.isdigit, phone_number))
        if not clean_phone or len(clean_phone) < 7:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please enter a valid phone number.")

        cust_stmt = select(Customer).where(Customer.phone == clean_phone, Customer.tenant_id == table.tenant_id)
        cust_res = await db.execute(cust_stmt)
        customer = cust_res.scalar_one_or_none()
        if not customer:
            customer = Customer(
                tenant_id=table.tenant_id,
                name=clean_name,
                phone=clean_phone,
            )
            db.add(customer)
            await db.flush()
        else:
            if clean_name and customer.name != clean_name:
                customer.name = clean_name
                await db.flush()

        # 3. Get or create dining session
        if is_generalized:
            new_session_token = f"sess_tok_{secrets.token_urlsafe(32)}"
            session = DiningSession(
                table_id=table.id if table else 1,
                session_token=new_session_token,
                status="OPENED",
            )
            db.add(session)
            await db.flush()
        else:
            session = await TableService.get_or_create_dining_session(db, table.id)

        # 4. Create Reservation for the walk-in
        from decimal import Decimal
        now = datetime.datetime.now()
        display_tbl_name = "Table allotted by server" if is_generalized else table.table_number
        walk_in_res = Reservation(
            tenant_id=table.tenant_id,
            branch_id=table.branch_id if table else 1,
            customer_id=customer.id,
            guest_count=guest_count or 2,
            reservation_date=now.date(),
            time_slot=now.strftime("%I:%M %p"),
            table_id=table.id if not is_generalized else None,
            floor_number=table.floor_number if not is_generalized else 1,
            table_name=display_tbl_name,
            status="SEATED",
            payment_status="PAID",
            advance_amount=Decimal("0.00"),
            is_deposit_credited=True,
        )
        db.add(walk_in_res)
        await db.flush()

        # 5. Attach reservation to session and mark table occupied if fixed table
        session.reservation_id = walk_in_res.id
        session.customer_id = customer.id
        if session.status == "OPENED":
            session.opened_at = utc_now()  # clock starts when the party is seated, not at an earlier scan
        session.status = "ACTIVE"
        if not is_generalized and table:
            table.status = "Occupied"

        await db.commit()
        await db.refresh(walk_in_res)
        await db.refresh(session)

        # 6. Broadcast event so POS, Manager, Admin update live
        try:
            from app.api.websocket import ws_manager
            from app.models.tenant import Tenant
            tenant_slug = None
            if table and table.tenant_id:
                t_obj = await db.get(Tenant, table.tenant_id)
                if t_obj:
                    tenant_slug = t_obj.slug
            event = {
                "event": "TABLE_OCCUPIED",
                "table_id": table.id if not is_generalized else None,
                "session_id": session.id,
                "customer_name": customer.name,
                "reservation_id": walk_in_res.id,
                "booking_id": walk_in_res.booking_id,
            }
            await ws_manager.broadcast("tables", event, tenant_slug=tenant_slug)
            await ws_manager.broadcast("pos", event, tenant_slug=tenant_slug)
        except Exception:
            pass
            pass

        return QRWalkInResponse(
            success=True,
            reservation_id=walk_in_res.id,
            booking_id=walk_in_res.booking_id,
            customer_name=customer.name,
            table_number=display_tbl_name,
            session_id=session.id,
            session_token=session.session_token,
            status="SEATED",
        )

    @staticmethod
    async def get_generalized_qrs(db: AsyncSession) -> GeneralizedQRListResponse:
        stmt = select(GeneralizedQR).order_by(GeneralizedQR.id.desc())
        res = await db.execute(stmt)
        all_qrs = list(res.scalars().all())

        if not all_qrs:
            first_qr = await TableService.generate_fresh_generalized_qr(db)
            all_qrs = [first_qr]

        active_qr = next((q for q in all_qrs if q.is_active), all_qrs[0] if all_qrs else None)

        return GeneralizedQRListResponse(
            active_qr=active_qr,
            all_qrs=all_qrs,
        )

    @staticmethod
    async def generate_fresh_generalized_qr(db: AsyncSession) -> GeneralizedQR:
        new_token = f"qr_gen_{secrets.token_urlsafe(24)}"

        # Multiple QR codes can remain active simultaneously
        new_qr = GeneralizedQR(
            qr_token=new_token,
            is_active=True,
            created_at=utc_now(),
            notes="Active Generalized Dining QR",
        )
        db.add(new_qr)
        await db.commit()
        await db.refresh(new_qr)
        return new_qr

    @staticmethod
    async def delete_generalized_qr(
        db: AsyncSession,
        qr_token: Optional[str] = None,
        qr_id: Optional[int] = None,
    ) -> dict:
        stmt = select(GeneralizedQR)
        if qr_id is not None:
            stmt = stmt.where(GeneralizedQR.id == qr_id)
        elif qr_token:
            stmt = stmt.where(GeneralizedQR.qr_token == qr_token)
        else:
            raise HTTPException(status_code=400, detail="Must provide qr_token or id")
        res = await db.execute(stmt)
        record = res.scalar_one_or_none()
        if record:
            await db.delete(record)
            await db.commit()
        return {"success": True, "message": "QR code deleted successfully"}

    @staticmethod
    async def toggle_qr_status(
        db: AsyncSession,
        qr_token: Optional[str] = None,
        qr_id: Optional[int] = None,
        is_active: bool = True,
    ) -> GeneralizedQRResponse:
        stmt = select(GeneralizedQR)
        if qr_id is not None:
            stmt = stmt.where(GeneralizedQR.id == qr_id)
        elif qr_token:
            stmt = stmt.where(GeneralizedQR.qr_token == qr_token)
        else:
            raise HTTPException(status_code=400, detail="Must provide qr_token or id")

        res = await db.execute(stmt)
        gen_qr = res.scalar_one_or_none()

        if gen_qr:
            gen_qr.is_active = is_active
            await db.commit()
            await db.refresh(gen_qr)
            return gen_qr

        # Fallback check TableQR
        tqr_stmt = select(TableQR)
        if qr_id is not None:
            tqr_stmt = tqr_stmt.where(TableQR.id == qr_id)
        elif qr_token:
            tqr_stmt = tqr_stmt.where(TableQR.qr_token == qr_token)
        tqr_res = await db.execute(tqr_stmt)
        tqr = tqr_res.scalar_one_or_none()
        if tqr:
            tqr.is_active = is_active
            await db.commit()
            await db.refresh(tqr)
            return GeneralizedQRResponse(
                id=tqr.id,
                qr_token=tqr.qr_token,
                is_active=tqr.is_active,
                created_at=utc_now(),
                notes=f"Table {tqr.table_id} QR",
            )

        raise HTTPException(status_code=404, detail="QR code not found")

    @staticmethod
    async def claim_reservation(
        db: AsyncSession,
        qr_token: str,
        session_token: str,
        reservation_code: str,
    ) -> ClaimReservationResponse:
        # ponytail: row lock and active session check to prevent concurrent claim race conditions & IDOR
        sess_stmt = select(DiningSession).where(DiningSession.session_token == session_token).with_for_update()
        sess_res = await db.execute(sess_stmt)
        session = sess_res.scalar_one_or_none()
        if not session:
            raise HTTPException(status_code=400, detail="Invalid session token.")

        session_table = await db.get(Table, session.table_id) if session.table_id else None
        expected_tenant_id = session_table.tenant_id if session_table else None

        code = reservation_code.strip()
        if not code:
            raise HTTPException(status_code=400, detail="Please enter a reservation code.")

        res_conditions = [
            or_(
                Reservation.id == (int(code) if code.isdigit() else -1),
                func.upper(Reservation.booking_id) == code.upper(),
            ),
            Reservation.status.in_(["CONFIRMED", "ARRIVED"]),
        ]
        if expected_tenant_id:
            res_conditions.append(Reservation.tenant_id == expected_tenant_id)

        res_stmt = (
            select(Reservation)
            .options(selectinload(Reservation.customer))
            .where(*res_conditions)
            .with_for_update()
        )
        res_res = await db.execute(res_stmt)
        reservation = res_res.scalars().first()

        if not reservation and len(code) >= 4:
            fallback_conds = [Reservation.status.in_(["CONFIRMED", "ARRIVED"])]
            if expected_tenant_id:
                fallback_conds.append(Reservation.tenant_id == expected_tenant_id)
            all_active = await db.execute(
                select(Reservation)
                .options(selectinload(Reservation.customer))
                .where(*fallback_conds)
                .order_by(Reservation.created_at.desc())
                .with_for_update()
            )
            clean_code = code.replace(" ", "").upper()
            for cand in all_active.scalars().all():
                c_name = (cand.customer.name if cand.customer else "").replace(" ", "").upper()[:4]
                c_phone = (cand.customer.phone if cand.customer else "")[-4:]
                composite = f"{c_name}{c_phone}"
                if clean_code == composite:
                    reservation = cand
                    break

        if not reservation or (expected_tenant_id and reservation.tenant_id != expected_tenant_id):
            raise HTTPException(
                status_code=400,
                detail="Reservation not found or status not eligible for seating.",
            )

        # Concurrency check: Ensure no OTHER dining session is already actively linked to this reservation
        conflict_sess_stmt = select(DiningSession.id).where(
            DiningSession.reservation_id == reservation.id,
            DiningSession.id != session.id,
            DiningSession.status.in_(["OPENED", "ACTIVE", "CHECKOUT"]),
        )
        conflict_sess = (await db.execute(conflict_sess_stmt)).scalar_one_or_none()
        if conflict_sess:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="ALREADY_CLAIMED: This reservation is already claimed by another active dining table.",
            )

        session.reservation_id = reservation.id
        if reservation.customer_id:
            session.customer_id = reservation.customer_id
        if reservation.table_id:
            session.table_id = reservation.table_id

        if reservation.status in ["CONFIRMED", "ARRIVED"]:
            reservation.status = "SEATED"

        await db.commit()
        await db.refresh(session)
        await db.refresh(reservation)

        table = await db.get(Table, session.table_id) if session.table_id else None
        table_number = (
            f"Table {table.floor_table_num} ({table.floor_name})"
            if table
            else (reservation.table_name or "Table allotted by server")
        )

        return ClaimReservationResponse(
            success=True,
            reservation_id=reservation.id,
            customer_name=reservation.customer.name if reservation.customer else "Guest",
            table_id=session.table_id,
            table_number=table_number,
            status=reservation.status,
            guest_count=reservation.guest_count,
        )
