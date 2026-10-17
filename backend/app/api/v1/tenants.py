import datetime
import re
import secrets
import uuid
from typing import List, Optional
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import hash_password, create_access_token, create_refresh_token
from app.core.tenant import get_current_tenant, get_optional_tenant
from app.api.deps import get_current_user, require_permission
from app.models.tenant import Tenant
from app.models.branch import Branch
from app.models.kitchen import Kitchen, MenuItemKitchenMapping
from app.models.user import User, Role
from app.models.table import Table, TableQR
from app.models.menu import MenuCategory, MenuItem
from app.models.capacity import DailyProductionRule
from app.schemas.tenant import (
    TenantPublicResponse,
    SlugCheckResponse,
    TenantOnboardRequest,
    TenantOnboardResponse,
    TableQROverviewItem,
)

router = APIRouter(prefix="/tenants", tags=["Tenants & Onboarding"])

RESERVED_SLUGS = {
    "www",
    "api",
    "admin",
    "app",
    "demo",
    "demo-api",
    "pos",
    "manager",
    "kds",
    "onboard",
    "restrova",
    "status",
    "health",
    "assets",
    "static",
    "public",
    "auth",
    "login",
}

STARTER_MENU_TEMPLATES = {
    "pizzeria": [
        {
            "category": "Antipasti & Starters",
            "items": [
                {
                    "name": "Garlic Herb Focaccia",
                    "price": 280.0,
                    "description": "Slow-fermented artisan focaccia with roasted garlic confit, rosemary, and cold-pressed extra virgin olive oil.",
                    "is_veg": True,
                    "dietary_tags": "Vegetarian, Olive Oil",
                },
                {
                    "name": "Burrata Caprese",
                    "price": 490.0,
                    "description": "Artisanal buffalo burrata, heirloom tomatoes, hand-picked sweet basil, and Modena balsamic reduction.",
                    "is_veg": True,
                    "dietary_tags": "Vegetarian, Gluten-Free",
                },
                {
                    "name": "Truffle Parmesan Fries",
                    "price": 320.0,
                    "description": "Double-crisp hand-cut skin-on fries tossed in white truffle oil, rosemary sea salt, and aged Grana Padano.",
                    "is_veg": True,
                    "dietary_tags": "Vegetarian",
                },
            ],
        },
        {
            "category": "Woodfired Neapolitan Pizzas",
            "items": [
                {
                    "name": "Margherita D.O.P.",
                    "price": 450.0,
                    "description": "48-hour fermented dough baked at 450°C. San Marzano tomato pulp, fresh Fior di Latte mozzarella, sweet basil, and EVO oil.",
                    "is_veg": True,
                    "dietary_tags": "Vegetarian, Chef Special",
                },
                {
                    "name": "Quattro Formaggi",
                    "price": 580.0,
                    "description": "White base with Fior di Latte, aged Gorgonzola, smoked Scamorza, and shaved Parmigiano with a touch of wild mountain honey.",
                    "is_veg": True,
                    "dietary_tags": "Vegetarian",
                },
                {
                    "name": "Diavola Piccante",
                    "price": 560.0,
                    "description": "Spicy artisanal Calabrian salami, Fior di Latte, San Marzano sauce, fresh bird's eye chilies, and oregano.",
                    "is_veg": False,
                    "dietary_tags": "Signature, Spicy",
                },
                {
                    "name": "Funghi Selvatici",
                    "price": 540.0,
                    "description": "Roasted king oyster & button mushrooms, thyme-infused ricotta base, Fior di Latte, and white truffle essence.",
                    "is_veg": True,
                    "dietary_tags": "Vegetarian",
                },
            ],
        },
        {
            "category": "Artisanal Beverages",
            "items": [
                {
                    "name": "Single Origin Espresso",
                    "price": 180.0,
                    "description": "Double ristretto shot extracted from shade-grown Chikmagalur Arabica beans with hazelnut crema.",
                    "is_veg": True,
                    "dietary_tags": "Vegan, Sugar-Free",
                },
                {
                    "name": "Mountain Cold Brew",
                    "price": 240.0,
                    "description": "Slow-steeped 18 hours in mountain spring water, served over crystal ice with orange zest.",
                    "is_veg": True,
                    "dietary_tags": "Vegan",
                },
                {
                    "name": "Wild Berry Tisane",
                    "price": 220.0,
                    "description": "Himalayan sun-dried cranberries, hibiscus blossom, and wild mint. Naturally caffeine-free.",
                    "is_veg": True,
                    "dietary_tags": "Vegan, Organic",
                },
            ],
        },
        {
            "category": "Dolci & Desserts",
            "items": [
                {
                    "name": "Classic Venetian Tiramisu",
                    "price": 340.0,
                    "description": "Savoiardi ladyfingers soaked in dark espresso and marsala, layered with whipped mascarpone cream and Valrhona cocoa.",
                    "is_veg": True,
                    "dietary_tags": "Vegetarian",
                },
                {
                    "name": "Pistachio Cannoli",
                    "price": 290.0,
                    "description": "Crisp Sicilian pastry shell filled with sweet sheep's milk ricotta, dark chocolate nibs, and crushed Bronte pistachio.",
                    "is_veg": True,
                    "dietary_tags": "Vegetarian",
                },
            ],
        },
    ],
    "cafe": [
        {
            "category": "Specialty Coffee & Brews",
            "items": [
                {
                    "name": "Double Flat White",
                    "price": 240.0,
                    "description": "Velvety micro-foamed milk poured over a rich double ristretto Arabica base.",
                    "is_veg": True,
                    "dietary_tags": "Vegetarian",
                },
                {
                    "name": "Iced Spanish Latte",
                    "price": 280.0,
                    "description": "Espresso shaken with textured condensed milk, whole milk, and served over clear ice.",
                    "is_veg": True,
                    "dietary_tags": "Vegetarian",
                },
                {
                    "name": "Ceremonial Matcha Latte",
                    "price": 310.0,
                    "description": "First-harvest Uji matcha whisked with oat milk and Madagascar vanilla syrup.",
                    "is_veg": True,
                    "dietary_tags": "Vegan",
                },
            ],
        },
        {
            "category": "Artisan Bakery",
            "items": [
                {
                    "name": "French Butter Croissant",
                    "price": 180.0,
                    "description": "Flaky 32-layer cultured butter croissant, baked fresh every morning.",
                    "is_veg": True,
                    "dietary_tags": "Vegetarian",
                },
                {
                    "name": "Almond Frangipane Croissant",
                    "price": 220.0,
                    "description": "Twice-baked butter croissant loaded with almond crème and toasted flaked almonds.",
                    "is_veg": True,
                    "dietary_tags": "Vegetarian",
                },
            ],
        },
        {
            "category": "All-Day Brunch",
            "items": [
                {
                    "name": "Avocado Sourdough Tartine",
                    "price": 380.0,
                    "description": "Crushed Hass avocado on toasted country sourdough, feta crumbles, chili flakes, and microgreens.",
                    "is_veg": True,
                    "dietary_tags": "Vegetarian",
                },
                {
                    "name": "Truffle Scrambled Brioche",
                    "price": 360.0,
                    "description": "Soft-set farm eggs with black truffle paste on toasted French brioche with chives.",
                    "is_veg": False,
                    "dietary_tags": "Chef Special",
                },
            ],
        },
    ],
    "bistro": [
        {
            "category": "Small Plates & Tapas",
            "items": [
                {
                    "name": "Truffle Wild Mushroom Arancini",
                    "price": 380.0,
                    "description": "Crispy carnaroli rice balls filled with wild forest mushrooms and smoked scamorza with garlic aioli.",
                    "is_veg": True,
                    "dietary_tags": "Vegetarian",
                },
                {
                    "name": "Smoked Salmon & Dill Crostini",
                    "price": 460.0,
                    "description": "Norwegian oak-smoked salmon, lemon whipped ricotta, capers, and dill on grilled baguette.",
                    "is_veg": False,
                    "dietary_tags": "Seafood",
                },
            ],
        },
        {
            "category": "Mains & Pastas",
            "items": [
                {
                    "name": "Handmade Truffle Tagliatelle",
                    "price": 590.0,
                    "description": "Fresh egg pasta ribbons tossed in cultured butter, Parmigiano Reggiano, and black winter truffle.",
                    "is_veg": True,
                    "dietary_tags": "Vegetarian, Signature",
                },
                {
                    "name": "Pan-Seared Herb Seabass",
                    "price": 750.0,
                    "description": "Crispy skin seabass fillet on saffron potato purée, charred asparagus, and lemon caper emulsion.",
                    "is_veg": False,
                    "dietary_tags": "Seafood, Gluten-Free",
                },
            ],
        },
        {
            "category": "Bistro Sips & Spritz",
            "items": [
                {
                    "name": "Blood Orange Botanical Spritz",
                    "price": 280.0,
                    "description": "Sicilian blood orange, rosemary syrup, sparkling tonic, and dehydrated citrus wheel.",
                    "is_veg": True,
                    "dietary_tags": "Vegan",
                },
            ],
        },
    ],
}


@router.get("/current", response_model=TenantPublicResponse)
async def get_current_tenant_profile(
    current_tenant: Tenant = Depends(get_current_tenant),
):
    """
    Public endpoint: Returns branding, colors, contact info, and operational policies
    for the active tenant (resolved by subdomain or X-Tenant-Slug header).
    Used by frontend layout to inject CSS variables and dynamic brand elements.
    """
    return current_tenant


@router.get("/check-slug", response_model=SlugCheckResponse)
async def check_slug_availability(
    slug: str = Query(..., min_length=3, max_length=30, description="Slug to test"),
    db: AsyncSession = Depends(get_db),
):
    """
    Validates if a preferred subdomain slug is available and syntactically valid.
    """
    cleaned_slug = slug.strip().lower()

    if not re.match(r"^[a-z0-9][a-z0-9\-]{1,28}[a-z0-9]$", cleaned_slug):
        return SlugCheckResponse(
            slug=cleaned_slug,
            available=False,
            message="Subdomain must be 3-30 characters, alphanumeric, and may include hyphens (not at start/end).",
        )

    if cleaned_slug in RESERVED_SLUGS:
        return SlugCheckResponse(
            slug=cleaned_slug,
            available=False,
            message=f"The subdomain '{cleaned_slug}' is reserved by the platform.",
        )

    result = await db.execute(select(Tenant).where(Tenant.slug == cleaned_slug))
    existing = result.scalar_one_or_none()

    if existing:
        return SlugCheckResponse(
            slug=cleaned_slug,
            available=False,
            message=f"Subdomain '{cleaned_slug}' is already taken. Please pick another.",
        )

    return SlugCheckResponse(
        slug=cleaned_slug,
        available=True,
        message=f"'{cleaned_slug}.restrova.com' is available!",
    )


@router.post("/onboard", response_model=TenantOnboardResponse, status_code=status.HTTP_201_CREATED)
async def onboard_new_tenant(
    data: TenantOnboardRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Self-Service 5-Step Launch Engine:
    1. Validates and reserves the café subdomain slug.
    2. Provisions the Tenant record with brand colors and payment settings.
    3. Provisions the default Branch and Kitchen.
    4. Creates the Owner / Admin user account.
    5. Seeds the tables with cryptographically unique QR security tokens.
    6. Provisions starter menu categories and dishes based on selected concept template.
    7. Issues immediate access and refresh JWT tokens so the owner is automatically logged in.
    """
    cleaned_slug = data.slug.strip().lower()

    # 1. Validate slug
    if not re.match(r"^[a-z0-9][a-z0-9\-]{1,28}[a-z0-9]$", cleaned_slug):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid slug format: 3-30 lowercase alphanumeric characters with hyphens.",
        )

    if cleaned_slug in RESERVED_SLUGS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"The slug '{cleaned_slug}' is reserved.",
        )

    existing_res = await db.execute(select(Tenant).where(Tenant.slug == cleaned_slug))
    if existing_res.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Subdomain '{cleaned_slug}' is already registered.",
        )

    # 2. Create Tenant
    trial_end = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=14)
    new_tenant = Tenant(
        slug=cleaned_slug,
        name=data.name.strip(),
        tagline=data.tagline.strip() if data.tagline else f"Artisanal Dining & Café · Est. {datetime.datetime.now().year}",
        primary_color=data.primary_color or "#2B1810",
        secondary_color=data.secondary_color or "#F7F4EE",
        accent_color=data.accent_color or "#C86D51",
        phone=data.phone.strip() if data.phone else None,
        email=data.admin_email.strip().lower(),
        address=data.address.strip() if data.address else "Main Street",
        merchant_upi_id=data.merchant_upi_id.strip() if data.merchant_upi_id else None,
        merchant_name=data.merchant_name.strip() if data.merchant_name else data.name.strip(),
        plan_tier="TRIAL",
        subscription_status="ACTIVE",
        trial_ends_at=trial_end,
    )
    db.add(new_tenant)
    await db.flush()

    # 3. Create Default Branch & Kitchen
    branch = Branch(
        tenant_id=new_tenant.id,
        name="Main Dining Room",
        address=data.address.strip() if data.address else "Main Street",
        phone=data.phone.strip() if data.phone else "1234567890",
        is_active=True,
    )
    db.add(branch)
    await db.flush()

    kitchen = Kitchen(
        branch_id=branch.id,
        name="Main Kitchen & Bar",
    )
    db.add(kitchen)
    await db.flush()

    # 4. Create Owner / Admin User
    role_res = await db.execute(select(Role).where(Role.name.ilike("admin")))
    admin_role = role_res.scalar_one_or_none()
    if not admin_role:
        role_res2 = await db.execute(select(Role).where(Role.name.ilike("owner")))
        admin_role = role_res2.scalar_one_or_none()
    if not admin_role:
        # Fallback to first existing role or create
        role_res3 = await db.execute(select(Role).order_by(Role.id))
        admin_role = role_res3.scalars().first()

    raw_username = data.admin_name.strip().lower().replace(" ", "_")
    safe_username = re.sub(r"[^a-z0-9_]", "", raw_username) or f"{cleaned_slug}_owner"

    owner_user = User(
        tenant_id=new_tenant.id,
        username=safe_username,
        email=data.admin_email.strip().lower(),
        hashed_password=hash_password(data.admin_password),
        role_id=admin_role.id if admin_role else None,
        is_active=True,
    )
    db.add(owner_user)
    await db.flush()

    # 5. Create Tables and QR Tokens
    table_items: List[TableQROverviewItem] = []
    table_count = max(1, min(data.table_count, 50))

    for i in range(1, table_count + 1):
        table = Table(
            tenant_id=new_tenant.id,
            branch_id=branch.id,
            table_number=f"T{i}",
            capacity=4 if i % 2 == 0 else 2,
            status="Available",
        )
        db.add(table)
        await db.flush()

        qr_token = f"qr_sec_{secrets.token_urlsafe(32)}"
        table_qr = TableQR(
            table_id=table.id,
            qr_token=qr_token,
            is_active=True,
        )
        db.add(table_qr)

        table_items.append(
            TableQROverviewItem(
                table_id=table.id,
                table_number=table.table_number,
                capacity=table.capacity,
                qr_token=qr_token,
                order_url=f"/table/{qr_token}",
            )
        )

    # 6. Seed Concept Menu
    menu_template_key = data.template.lower() if data.template else "pizzeria"
    category_list = STARTER_MENU_TEMPLATES.get(menu_template_key, STARTER_MENU_TEMPLATES["pizzeria"])

    for cat_idx, cat_data in enumerate(category_list, start=1):
        category = MenuCategory(
            tenant_id=new_tenant.id,
            name=cat_data["category"],
            display_order=cat_idx,
            is_active=True,
        )
        db.add(category)
        await db.flush()

        for item_data in cat_data["items"]:
            menu_item = MenuItem(
                tenant_id=new_tenant.id,
                category_id=category.id,
                name=item_data["name"],
                description=item_data.get("description"),
                price=Decimal(str(item_data["price"])),
                is_available=True,
                is_active=True,
            )
            db.add(menu_item)
            await db.flush()

            # Map to kitchen
            mapping = MenuItemKitchenMapping(
                menu_item_id=menu_item.id,
                kitchen_id=kitchen.id,
            )
            db.add(mapping)

    # 7. Seed Daily Production Rule (Dough capacity)
    today = datetime.datetime.now(datetime.timezone.utc).date()
    daily_rule = DailyProductionRule(
        tenant_id=new_tenant.id,
        branch_id=branch.id,
        production_date=today,
        total_dough_limit=70,
        total_allocated_dough=0,
    )
    db.add(daily_rule)

    await db.commit()
    await db.refresh(new_tenant)
    await db.refresh(owner_user)

    # Issue JWT tokens for owner
    access_token = create_access_token(subject=owner_user.id, tenant_id=new_tenant.id)
    refresh_token = create_refresh_token(subject=owner_user.id, tenant_id=new_tenant.id)

    portal_urls = {
        "storefront": f"/?tenant={cleaned_slug}",
        "pos": f"/pos?tenant={cleaned_slug}",
        "kds": f"/kds?tenant={cleaned_slug}",
        "manager": f"/manager?tenant={cleaned_slug}",
        "book_table": f"/book-table?tenant={cleaned_slug}",
        "menu": f"/menu?tenant={cleaned_slug}",
        "first_table": f"/table/{table_items[0].qr_token}?tenant={cleaned_slug}" if table_items else "",
    }

    return TenantOnboardResponse(
        tenant=TenantPublicResponse.model_validate(new_tenant),
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        owner_username=owner_user.username,
        owner_email=owner_user.email,
        tables_created=len(table_items),
        tables=table_items,
        portal_urls=portal_urls,
    )


@router.get("/tables/qr-overview", response_model=List[TableQROverviewItem])
async def get_tenant_table_qr_overview(
    current_tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns all tables and their active QR tokens for the current tenant.
    Allows owners and managers to preview, download, or print tent-card QR codes.
    """
    stmt = (
        select(Table, TableQR)
        .outerjoin(TableQR, Table.id == TableQR.table_id)
        .where(
            Table.tenant_id == current_tenant.id,
        )
        .order_by(Table.table_number)
    )
    res = await db.execute(stmt)
    rows = res.all()

    items = []
    for table, qr in rows:
        token = qr.qr_token if qr else ""
        items.append(
            TableQROverviewItem(
                table_id=table.id,
                table_number=table.table_number,
                capacity=table.capacity,
                qr_token=token,
                order_url=f"/table/{token}" if token else "",
            )
        )
    return items
