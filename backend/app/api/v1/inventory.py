import re
from decimal import Decimal
from typing import List
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_db, require_permission
from app.models.user import User
from app.models.inventory import InventoryItem, InventoryTransaction
from app.models.supplier import PurchaseOrder, PurchaseOrderItem, Supplier
from app.schemas.inventory import (
    BillConfirmRequest,
    BillConfirmResponse,
    BillScanDraft,
    InventoryItemCreate,
    InventoryItemResponse,
    InventoryTransactionCreate,
    InventoryTransactionResponse,
)
from app.services import bill_scan_service
from app.services.inventory_service import InventoryService

ALLOWED_BILL_TYPES = {"image/jpeg", "image/png", "application/pdf"}
MAX_BILL_BYTES = 10 * 1024 * 1024
ALLOWED_UNITS = {"kg", "g", "l", "ml", "pcs"}

router = APIRouter(
    prefix="/inventory",
    tags=["Inventory & Raw Stock"],
    dependencies=[Depends(require_permission("pos:access"))],
)


@router.get("", response_model=List[InventoryItemResponse])
async def list_inventory(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("pos:access")),
):
    query = (
        select(InventoryItem)
        .where(InventoryItem.tenant_id == current_user.tenant_id)
        .order_by(InventoryItem.name)
    )
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/low-stock", response_model=List[InventoryItemResponse])
async def list_low_stock(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("pos:access")),
):
    query = (
        select(InventoryItem)
        .where(
            InventoryItem.tenant_id == current_user.tenant_id,
            InventoryItem.current_stock <= InventoryItem.reorder_threshold,
        )
    )
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/items", response_model=InventoryItemResponse, status_code=201)
async def create_inventory_item(
    data: InventoryItemCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("pos:access")),
):
    item = InventoryItem(**data.model_dump(), tenant_id=current_user.tenant_id)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.post("/transactions", response_model=InventoryTransactionResponse, status_code=201)
async def record_transaction(
    data: InventoryTransactionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("pos:access")),
):
    item = await db.get(InventoryItem, data.inventory_item_id)
    if not item or item.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Inventory item not found.")
    return await InventoryService.record_transaction(
        db,
        inventory_item_id=data.inventory_item_id,
        transaction_type=data.transaction_type,
        quantity_change=data.quantity_change,
        reference_id=data.reference_id,
    )


@router.post("/bills/scan", response_model=BillScanDraft)
async def scan_supplier_bill(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("pos:access")),
):
    """Read a supplier bill photo/PDF and return a draft for review. Saves nothing."""
    if file.content_type not in ALLOWED_BILL_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Upload a JPG, PNG or PDF of the bill.")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The uploaded file is empty.")
    if len(content) > MAX_BILL_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Bill file must be under 10 MB.")

    result = await bill_scan_service.extract_bill(content, file.filename or "bill", file.content_type)
    materials = [
        (m.id, m.name, m.unit_of_measure)
        for m in (
            await db.execute(
                select(InventoryItem)
                .where(InventoryItem.tenant_id == current_user.tenant_id)
                .order_by(InventoryItem.name)
            )
        ).scalars().all()
    ]
    return bill_scan_service.build_draft(result, materials)


@router.post("/bills/confirm", response_model=BillConfirmResponse, status_code=201)
async def confirm_supplier_bill(
    data: BillConfirmRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("pos:access")),
):
    """Record a reviewed bill: supplier, received purchase order, new materials and PURCHASE stock entries."""
    lines = [ln for ln in data.lines if ln.action != "SKIP"]
    if not lines:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Select at least one item to add to stock.")
    for ln in lines:
        label = ln.description or ln.new_name or "this item"
        if ln.quantity <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Quantity must be greater than zero for '{label}'.")
        if ln.unit_cost < 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cost cannot be negative for '{label}'.")

    supplier_name = data.supplier_name.strip()
    bill_number = data.bill_number.strip()
    supplier = (
        await db.execute(
            select(Supplier).where(
                Supplier.tenant_id == current_user.tenant_id,
                func.lower(Supplier.name) == supplier_name.lower(),
            )
        )
    ).scalars().first()
    if supplier:
        duplicate = (
            await db.execute(
                select(PurchaseOrder.id).where(
                    PurchaseOrder.tenant_id == current_user.tenant_id,
                    PurchaseOrder.supplier_id == supplier.id,
                    func.lower(PurchaseOrder.invoice_number) == bill_number.lower(),
                )
            )
        ).first()
        if duplicate:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"DUPLICATE_BILL: Bill {bill_number} from {supplier.name} has already been recorded.",
            )
    else:
        supplier = Supplier(name=supplier_name, tenant_id=current_user.tenant_id)
        db.add(supplier)
        await db.flush()

    # Resolve each line to an inventory item (creating new raw materials where asked)
    resolved = []
    created = 0
    for ln in lines:
        if ln.action == "MATCH":
            item = await db.get(InventoryItem, ln.inventory_item_id) if ln.inventory_item_id else None
            if not item or item.tenant_id != current_user.tenant_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Choose a raw material for '{ln.description}'.")
        else:
            name = (ln.new_name or ln.description or "").strip()
            unit = (ln.new_unit or "").strip().lower()
            if not name:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New raw materials need a name.")
            if unit not in ALLOWED_UNITS:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Choose a unit (kg, g, l, ml, pcs) for '{name}'.")
            sku = (ln.new_sku or "").strip().upper() or "RM-" + re.sub(r"[^A-Z0-9]+", "-", name.upper()).strip("-")[:40]
            if (await db.execute(select(InventoryItem.id).where(InventoryItem.tenant_id == current_user.tenant_id, InventoryItem.sku == sku))).first():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"SKU_EXISTS: A raw material with SKU {sku} already exists. Match '{name}' to it instead.",
                )
            item = InventoryItem(
                tenant_id=current_user.tenant_id,
                sku=sku, name=name[:100], unit_of_measure=unit,
                current_stock=Decimal("0"), reorder_threshold=ln.new_reorder_threshold or Decimal("0"),
            )
            db.add(item)
            await db.flush()
            created += 1
        resolved.append((item, ln))

    total_cost = sum((ln.quantity * ln.unit_cost for _, ln in resolved), Decimal("0")).quantize(Decimal("0.01"))
    po = PurchaseOrder(
        tenant_id=current_user.tenant_id,
        supplier_id=supplier.id, status="RECEIVED", total_cost=total_cost,
        invoice_number=bill_number, invoice_date=data.bill_date,
    )
    db.add(po)
    await db.flush()

    reference = f"BILL {bill_number}"[:100]
    for item, ln in resolved:
        db.add(PurchaseOrderItem(
            purchase_order_id=po.id, inventory_item_id=item.id,
            quantity_ordered=ln.quantity, unit_cost=ln.unit_cost.quantize(Decimal("0.01")),
        ))
        item.current_stock = (item.current_stock or Decimal("0")) + ln.quantity
        db.add(InventoryTransaction(
            inventory_item_id=item.id, transaction_type="PURCHASE",
            quantity_change=ln.quantity, reference_id=reference,
        ))

    await db.commit()  # one transaction: all lines or nothing
    return BillConfirmResponse(
        purchase_order_id=po.id, supplier_id=supplier.id, items_received=len(resolved),
        materials_created=created, total_cost=total_cost,
    )


@router.get("/bills")
async def list_scanned_supplier_bills(
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("pos:access")),
):
    """List confirmed supplier purchase bills (scanned invoices) with their bill IDs and line items."""
    stmt = (
        select(PurchaseOrder)
        .where(PurchaseOrder.tenant_id == current_user.tenant_id)
        .options(
            selectinload(PurchaseOrder.supplier),
            selectinload(PurchaseOrder.items).selectinload(PurchaseOrderItem.inventory_item),
        )
        .order_by(PurchaseOrder.created_at.desc())
        .limit(limit)
    )
    res = await db.execute(stmt)
    pos = res.scalars().all()
    results = []
    for po in pos:
        items_list = []
        for itm in (po.items or []):
            item_name = itm.inventory_item.name if itm.inventory_item else "Raw Material"
            unit = itm.inventory_item.unit_of_measure if itm.inventory_item else ""
            qty = float(itm.quantity_ordered)
            cost = float(itm.unit_cost)
            items_list.append({
                "id": itm.id,
                "inventory_item_id": itm.inventory_item_id,
                "name": item_name,
                "unit": unit,
                "quantity": qty,
                "unit_cost": cost,
                "subtotal": round(qty * cost, 2),
            })
        results.append({
            "id": po.id,
            "bill_id": po.invoice_number or f"PO-{po.id:04d}",
            "bill_number": po.invoice_number or f"PO-{po.id:04d}",
            "supplier_name": po.supplier.name if po.supplier else "Direct Supplier",
            "supplier_id": po.supplier_id,
            "bill_date": po.invoice_date.isoformat() if po.invoice_date else None,
            "status": po.status,
            "total_amount": float(po.total_cost),
            "items_count": len(po.items or []),
            "created_at": po.created_at.isoformat() if po.created_at else None,
            "items": items_list,
        })
    return results
