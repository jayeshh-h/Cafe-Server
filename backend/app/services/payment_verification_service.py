import datetime
import uuid
from decimal import Decimal
from typing import Optional, Union, List, Dict, Any
from sqlalchemy import select, func, or_
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException, status
from app.models.bank_transaction import VerifiedBankCredit
from app.models.reservation import Reservation
from app.core.config import settings
from app.core.logging import logger
from app.utils.helpers import utc_now


class PaymentVerificationService:
    """
    Independent Payment Verification Engine.
    Enforces that customer-entered transaction references or UTRs NEVER self-confirm reservations.
    A reservation can ONLY be confirmed when a matching, settled credit from an authentic
    bank/payment gateway webhook, Android payment listener, or staff POS reconciliation exists.
    """

    @staticmethod
    async def record_verified_bank_credit(
        db: AsyncSession,
        utr: str,
        amount: Union[Decimal, float, int, str],
        merchant_vpa: str = settings.MERCHANT_UPI_ID,
        provider_source: str = "BANK_WEBHOOK",
        payer_vpa: Optional[str] = None,
        tx_status: str = "SETTLED",
        event_id: Optional[str] = None,
        raw_event_payload: Optional[str] = None,
        review_reason: Optional[str] = None,
        tenant_id: Optional[Union[uuid.UUID, str]] = None,
    ) -> VerifiedBankCredit:
        """
        Records an authentic bank credit received from a bank acquirer, payment gateway webhook,
        Android phone notification listener, or staff bank statement reconciliation.
        """
        import uuid as _uuid
        clean_utr = utr.strip().replace(" ", "").replace("-", "")
        dec_amount = Decimal(str(amount))
        t_id = _uuid.UUID(str(tenant_id)) if tenant_id else _uuid.UUID("23395d5e-16e5-4eb6-9214-cc63f05c3210")

        # Check existing by event_id if provided
        if event_id:
            evt_stmt = select(VerifiedBankCredit).where(VerifiedBankCredit.event_id == event_id)
            evt_res = await db.execute(evt_stmt)
            existing_evt = evt_res.scalars().first()
            if existing_evt:
                return existing_evt

        stmt = (
            select(VerifiedBankCredit)
            .where(func.lower(VerifiedBankCredit.utr) == clean_utr.lower())
            .with_for_update()
        )
        res = await db.execute(stmt)
        existing = res.scalars().first()
        if existing:
            return existing

        credit = VerifiedBankCredit(
            tenant_id=t_id,
            utr=clean_utr,
            amount=dec_amount,
            merchant_vpa=merchant_vpa,
            payer_vpa=payer_vpa,
            status=tx_status,
            provider_source=provider_source,
            event_id=event_id,
            raw_event_payload=raw_event_payload,
            review_reason=review_reason,
            is_claimed=False,
        )
        db.add(credit)
        await db.commit()
        await db.refresh(credit)
        logger.info(
            f"Verified bank credit recorded: UTR={clean_utr} Amount={dec_amount} Source={provider_source} Status={tx_status} Tenant={t_id}"
        )
        return credit

    @staticmethod
    async def verify_and_claim_credit(
        db: AsyncSession,
        reservation: Reservation,
        utr: str,
    ) -> VerifiedBankCredit:
        """
        Verifies whether an authentic bank credit exists for this UTR with sufficient funds.
        If found and valid, atomically claims the credit for the reservation.
        If not found or invalid, raises appropriate HTTP exception.
        """
        clean_utr = utr.strip().replace(" ", "").replace("-", "")

        # 1. Query verified bank credits with atomic row-level lock and tenant isolation barrier
        stmt = (
            select(VerifiedBankCredit)
            .where(
                func.lower(VerifiedBankCredit.utr) == clean_utr.lower(),
                VerifiedBankCredit.tenant_id == reservation.tenant_id,
            )
            .with_for_update()
        )
        res = await db.execute(stmt)
        credit = res.scalars().first()

        # 2. Strict rejection: No genuine bank credit exists for this UTR for this tenant
        if not credit:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=(
                    f"PAYMENT_NOT_VERIFIED: No settled bank credit found for UTR '{clean_utr}'. "
                    f"Customer-entered transaction references cannot confirm reservations without independent bank verification."
                ),
            )

        # 3. Prevent reuse / replay of already claimed bank credits
        if credit.is_claimed:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"UTR_ALREADY_USED: This bank credit for UTR '{clean_utr}' has already been claimed "
                    f"and exhausted for Reservation #{credit.claimed_reservation_id}."
                ),
            )

        # 4. Check credit status
        if credit.status != "SETTLED":
            detail_msg = f"PAYMENT_FAILED: Bank payment status is '{credit.status}'."
            if credit.status == "PAYMENT_REVIEW_REQUIRED":
                detail_msg = f"PAYMENT_REVIEW_REQUIRED: Payment for UTR '{clean_utr}' is flagged for staff review ({credit.review_reason or 'Manual reconciliation required'})."
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=detail_msg,
            )

        # 5. Check credit amount using exact Decimal comparison
        required_advance = Decimal(str(reservation.advance_amount or "0.00"))
        if credit.amount < required_advance:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"PAYMENT_UNDERPAID: Bank credit of ₹{credit.amount} is less than required deposit of ₹{required_advance}."
                ),
            )

        # 6. Atomically claim the credit
        credit.is_claimed = True
        credit.claimed_reservation_id = reservation.id
        await db.flush()
        return credit

    @staticmethod
    async def process_android_payment_event(
        db: AsyncSession,
        event_id: Optional[str],
        utr: str,
        amount: Union[Decimal, float, str, None],
        merchant_vpa: str,
        payer_vpa: Optional[str] = None,
        event_timestamp: Optional[datetime.datetime] = None,
    ) -> Dict[str, Any]:
        clean_utr = utr.strip().replace(" ", "").replace("-", "") if utr else "UNKNOWN"
        try:
            if amount is not None and str(amount).strip() and str(amount).strip().lower() != "none":
                dec_amount = Decimal(str(amount).strip())
            else:
                dec_amount = Decimal("0.00")
        except Exception:
            dec_amount = Decimal("0.00")

        now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)

        # 1. Check idempotency by event_id or utr
        check_stmt = select(VerifiedBankCredit).where(
            or_(
                VerifiedBankCredit.event_id == event_id if event_id else False,
                func.lower(VerifiedBankCredit.utr) == clean_utr.lower(),
            )
        )
        check_res = await db.execute(check_stmt)
        existing_credit = check_res.scalars().first()
        if existing_credit:
            return {
                "status": "ALREADY_PROCESSED",
                "message": f"Payment event for UTR '{clean_utr}' has already been processed.",
                "credit_id": existing_credit.id,
                "claimed_reservation_id": existing_credit.claimed_reservation_id,
                "payment_status": existing_credit.status,
            }

        # 2. Resolve Tenant from receiving merchant_vpa or default settings
        clean_vpa = (merchant_vpa or "").strip().lower()
        from app.models.tenant import Tenant
        matched_tenant = None
        if clean_vpa:
            tenant_stmt = select(Tenant).where(
                func.lower(Tenant.merchant_upi_id) == clean_vpa
            )
            matched_tenant = (await db.execute(tenant_stmt)).scalars().first()

        if not matched_tenant:
            def_stmt = select(Tenant).where(Tenant.slug == "restrova-default")
            matched_tenant = (await db.execute(def_stmt)).scalars().first()

        target_tenant_id = matched_tenant.id if matched_tenant else None
        if not target_tenant_id:
            credit = await PaymentVerificationService.record_verified_bank_credit(
                db=db,
                utr=clean_utr,
                amount=dec_amount,
                merchant_vpa=merchant_vpa,
                provider_source="PAYMENT_EVENT",
                payer_vpa=payer_vpa,
                tx_status="PAYMENT_REVIEW_REQUIRED",
                event_id=event_id,
                review_reason=f"UNKNOWN_MERCHANT_VPA: Payment received on '{merchant_vpa}' does not belong to any active café.",
            )
            return {
                "status": "PAYMENT_REVIEW_REQUIRED",
                "credit_id": credit.id,
                "reason": credit.review_reason,
            }

        # 3. Look for pending reservation waiting for this exact UTR within this tenant
        utr_res_stmt = (
            select(Reservation)
            .options(selectinload(Reservation.customer))
            .where(
                Reservation.tenant_id == target_tenant_id,
                Reservation.status == "PAYMENT_PENDING",
                func.lower(Reservation.upi_utr) == clean_utr.lower(),
            )
            .with_for_update()
        )
        utr_res = await db.execute(utr_res_stmt)
        matched_res = utr_res.scalars().first()

        # 4. If no exact UTR match, look for reservations in HOLD or PAYMENT_PENDING with matching deposit amount for this tenant
        if not matched_res:
            candidates_stmt = (
                select(Reservation)
                .options(selectinload(Reservation.customer))
                .where(
                    Reservation.tenant_id == target_tenant_id,
                    Reservation.status.in_(["HOLD", "PAYMENT_PENDING"]),
                    Reservation.advance_amount == dec_amount,
                    Reservation.hold_expires_at > now,
                )
                .order_by(Reservation.created_at.desc())
                .with_for_update()
            )
            cand_res = await db.execute(candidates_stmt)
            candidates = cand_res.scalars().all()

            if len(candidates) == 1:
                matched_res = candidates[0]
            elif len(candidates) > 1:
                # Ambiguous: Multiple reservations waiting for this exact amount for this tenant
                credit = await PaymentVerificationService.record_verified_bank_credit(
                    db=db,
                    utr=clean_utr,
                    amount=dec_amount,
                    merchant_vpa=merchant_vpa,
                    provider_source="PAYMENT_EVENT",
                    payer_vpa=payer_vpa,
                    tx_status="PAYMENT_REVIEW_REQUIRED",
                    event_id=event_id,
                    tenant_id=target_tenant_id,
                    review_reason=f"AMBIGUOUS_MATCH: {len(candidates)} active reservations found waiting for ₹{dec_amount}. Staff must assign.",
                )
                return {
                    "status": "PAYMENT_REVIEW_REQUIRED",
                    "credit_id": credit.id,
                    "reason": credit.review_reason,
                }

        # 5. Check if money arrived after HOLD expired for this tenant
        if not matched_res:
            expired_stmt = select(Reservation).where(
                Reservation.tenant_id == target_tenant_id,
                Reservation.status == "EXPIRED",
                or_(
                    func.lower(Reservation.upi_utr) == clean_utr.lower(),
                    Reservation.advance_amount == dec_amount,
                ),
            ).order_by(Reservation.created_at.desc())
            exp_res = await db.execute(expired_stmt)
            expired_res = exp_res.scalars().first()

            credit = await PaymentVerificationService.record_verified_bank_credit(
                db=db,
                utr=clean_utr,
                amount=dec_amount,
                merchant_vpa=merchant_vpa,
                provider_source="PAYMENT_EVENT",
                payer_vpa=payer_vpa,
                tx_status="PAYMENT_REVIEW_REQUIRED",
                event_id=event_id,
                tenant_id=target_tenant_id,
                review_reason=(
                    f"LATE_PAYMENT_OR_NO_MATCH: Money arrived for UTR '{clean_utr}' (₹{dec_amount}) but no active hold was found. "
                    f"Associated expired reservation: #{expired_res.id if expired_res else 'None'}."
                ),
            )
            return {
                "status": "PAYMENT_REVIEW_REQUIRED",
                "credit_id": credit.id,
                "reason": credit.review_reason,
            }

        # 6. Verify amount
        req_advance = Decimal(str(matched_res.advance_amount or "0.00"))
        if dec_amount < req_advance:
            credit = await PaymentVerificationService.record_verified_bank_credit(
                db=db,
                utr=clean_utr,
                amount=dec_amount,
                merchant_vpa=merchant_vpa,
                provider_source="PAYMENT_EVENT",
                payer_vpa=payer_vpa,
                tx_status="PAYMENT_REVIEW_REQUIRED",
                event_id=event_id,
                tenant_id=target_tenant_id,
                review_reason=f"UNDERPAID: Received ₹{dec_amount}, required ₹{req_advance}.",
            )
            return {
                "status": "PAYMENT_REVIEW_REQUIRED",
                "credit_id": credit.id,
                "reason": credit.review_reason,
            }

        # 7. Authentic credit and clear match: Confirm reservation!
        credit = await PaymentVerificationService.record_verified_bank_credit(
            db=db,
            utr=clean_utr,
            amount=dec_amount,
            merchant_vpa=merchant_vpa,
            provider_source="PAYMENT_EVENT",
            payer_vpa=payer_vpa,
            tx_status="SETTLED",
            event_id=event_id,
            tenant_id=target_tenant_id,
        )

        credit.is_claimed = True
        credit.claimed_reservation_id = matched_res.id

        matched_res.status = "CONFIRMED"
        matched_res.payment_status = "PAID"
        matched_res.payment_reference = clean_utr
        matched_res.upi_utr = clean_utr
        matched_res.hold_expires_at = None

        await db.commit()
        await db.refresh(matched_res)

        from app.services.whatsapp_service import notify_booking_confirmed
        notify_booking_confirmed(matched_res.id)

        return {
            "status": "SUCCESS",
            "message": "Payment verified and reservation confirmed.",
            "credit_id": credit.id,
            "confirmed_reservation_id": matched_res.id,
        }

