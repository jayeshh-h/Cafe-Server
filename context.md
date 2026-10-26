# 📖 Jaadoo Café Piza / Restrova SaaS — Complete System Context & Database Logic

> **Document Purpose**: This file is the **authoritative single source of truth** for the entire project. When starting a new AI chat or developer session, provide this file so the AI or engineer has instant, complete understanding of the system architecture, all database tables, foreign keys, multi-tenancy rules, business logics, API endpoints, and frontend workflows.

---

## 1. Executive Summary & Physical Reality

- **Brand / Concept**: Jaadoo Café Piza (Artisanal Neapolitan Pizzeria & Specialty Café in Udaipur, Rajasthan) + **Restrova SaaS** (Multi-tenant B2B Restaurant Operating System).
- **Physical Context**: Located at *32 Sitaphal ki gali, Udaipur*. Features 4 distinct dining zones:
  1. **Ground Floor Dining & Main Counter**
  2. **Open-Air Heritage Courtyard**
  3. **First Floor Dining**
  4. **Terrace Lounge**
- **Core Problem Solved**: Mass-market restaurant SaaS (e.g. Petpooja, AirMenu) fails in heritage boutique setups due to rigid static QR stickers, Windows spooler thermal print crashes, complex multi-screen cashier billing, and manual reconciliation of advance table booking deposits.
- **System Tenets**:
  - **PostgreSQL (Neon / Lakebase)** is the absolute single source of truth for financial, inventory, order, and reservation states.
  - **Redis** is an ephemeral layer for real-time pub/sub (`kitchen_channel`, `pos_channel`), WebSocket synchronization, and rate-limiting.
  - **Single Kitchen Operations**: Physical Kitchen Order Tickets (KOT) are printed directly via 80mm ESC/POS thermal receipt printers at the kitchen station; paired with zero-latency live KDS WebSockets (`/ws`).
  - **Zero-Commission Direct Payments**: Direct UPI counter routing (`verified_bank_credits`) + Razorpay gateway fallback.

---

## 2. Technical Stack & Infrastructure Specifications

| Component | Technology | Version / Details |
|---|---|---|
| **Backend Framework** | **FastAPI** | Python 3.11+, asynchronous ASGI |
| **ORM / Data Access** | **SQLAlchemy** | 2.0 async engine (`postgresql+asyncpg://` or SQLite for tests) |
| **Database Migrations** | **Alembic** | 5 core revisions (001 to 005_multi_tenancy_core) |
| **Production Database** | **PostgreSQL on Neon** | SSL enabled, pool_size=15, max_overflow=5, pool_pre_ping=True |
| **Development Database**| **SQLite / PostgreSQL** | `cafe_dev.db`, `cafe_test.db` with auto-migration fallback |
| **Cache & Real-Time** | **Redis** | In-memory key-value, pub/sub, sliding-window rate limiting |
| **Task Queue** | **Celery** | Redis broker (DB 1) & result backend (DB 2) |
| **Frontend Framework** | **Next.js 16** | App Router, React 19, Turbopack, TypeScript |
| **Styling & UI** | **Tailwind CSS + Shadcn**| Lucide icons, glassmorphism design system, responsive |
| **Printing Protocol** | **ESC/POS (80mm)** | Native thermal print layouts, CSS `@page`, direct TCP/9100 |
| **Document Intelligence**| **Sarvam AI** | Document AI extract for automated OCR vendor invoice scanning |
| **Messaging** | **Meta WhatsApp Cloud**| v21.0 Graph API for automated booking confirmations & PDF e-bills |

---

## 3. Multi-Tenancy Architecture (Restrova SaaS)

Restrova operates on a **Shared Database, Shared Schema with Tenant Isolation** model:

```
[ Incoming HTTP Request ]
          │
          ▼
[ Host Subdomain / Domain Check ]
   ├── luna.restrova.com        ──> Tenant Slug: "luna"
   ├── pizza.customdomain.in    ──> Custom Domain Lookup
   ├── localhost (Dev Mode)     ──> Headers: X-Tenant-Slug OR ?tenant= OR "restrova-default"
          │
          ▼
[ Database Context: Tenant Record ]
          │
          ▼
[ All SQL Queries Scoped via tenant_id ]
   (Users, Branches, Tables, Orders, Bills, Reservations, Inventory, etc.)
```

### Multi-Tenancy Rules & Invariants:
1. **Root Business Entities**: Every primary table has a `tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT`. The `RESTRICT` clause guarantees financial and audit records cannot be cascade-deleted accidentally.
2. **Child Entity Inheritance**: Sub-items (such as `order_items`, `table_qrs`, `recipe_items`, `payments`) inherit tenant boundaries through their parent entity foreign keys (`order_id`, `table_id`, `recipe_id`, `bill_id`).
3. **Default Tenant**:
   - `DEFAULT_TENANT_ID = UUID("23395d5e-16e5-4eb6-9214-cc63f05c3210")`
   - `DEFAULT_TENANT_SLUG = "restrova-default"`
4. **Tenant Resolution Cascade (`app.core.tenant.py`)**:
   - **Production**: Host subdomain (e.g. `xyz.restrova.com`, ignoring `www`, `api`, `app`) $\rightarrow$ Custom Domain (`tenants.custom_domain`). If neither matches, returns `404/400 Tenant context required`. Client headers are ignored in production for security.
   - **Development**: Host subdomain $\rightarrow$ Header `X-Tenant-Slug` $\rightarrow$ Query Param `?tenant=` $\rightarrow$ Fallback to `restrova-default`.
5. **Subscription Gating**: `tenant.subscription_status` must be `ACTIVE` or `TRIAL`; otherwise returns `HTTP 402 Payment Required`.

---

## 4. Complete Database Schema & Model Dictionary

All database models reside in `backend/app/models/` and inherit from SQLAlchemy `DeclarativeBase` (`app.core.database.Base`).

```mermaid
erDiagram
    TENANT ||--o{ BRANCH : "owns"
    TENANT ||--o{ USER : "has"
    TENANT ||--o{ TABLE : "manages"
    TENANT ||--o{ MENU_CATEGORY : "categorizes"
    TENANT ||--o{ MENU_ITEM : "offers"
    TENANT ||--o{ RESERVATION : "books"
    TENANT ||--o{ ORDER : "processes"
    TENANT ||--o{ BILL : "bills"
    TENANT ||--o{ INVENTORY_ITEM : "stocks"
    
    BRANCH ||--o{ TABLE : "contains"
    TABLE ||--o{ DINING_SESSION : "hosts"
    DINING_SESSION ||--o{ ORDER : "accumulates"
    DINING_SESSION ||--o| BILL : "settles"
    
    ORDER ||--o{ ORDER_ITEM : "contains"
    ORDER ||--o{ KOT : "generates"
    MENU_ITEM ||--o{ ORDER_ITEM : "ordered_in"
    MENU_ITEM ||--o| RECIPE : "defined_by"
    RECIPE ||--o{ RECIPE_ITEM : "requires"
    INVENTORY_ITEM ||--o{ RECIPE_ITEM : "consumed_by"
    
    BILL ||--o{ PAYMENT : "paid_with"
    RESERVATION ||--o| DINING_SESSION : "claims"
    RESERVATION }|--o| VERIFIED_BANK_CREDIT : "verified_by"
```

### 4.1 Multi-Tenancy & Access Control
- **`tenants`** (`app/models/tenant.py`):
  - Primary Key: `id` (UUID).
  - Identification: `slug` (VARCHAR 64, unique, indexed), `name`, `custom_domain` (VARCHAR 255, unique, indexed).
  - Branding: `logo_url`, `favicon_url`, `hero_image_url`, `hero_video_url`, `tagline`, `about_text`, `primary_color` (default `#2B1810`), `secondary_color` (`#F7F4EE`), `accent_color` (`#C86D51`).
  - Contact & Policies: `phone`, `email`, `address`, `google_maps_url`, `reservation_closed_weekdays` (default `'1,2'` for Mon, Tue), `reservation_open_time` (`'11:00'`), `reservation_last_slot_time` (`'22:30'`), `deposit_per_guest` (NUMERIC 10,2 default 150.00).
  - Direct 0% Commission UPI: `merchant_upi_id`, `merchant_name`, `razorpay_key_id`, `razorpay_key_secret`, `razorpay_webhook_secret`, `allow_online_payments` (BOOLEAN).
  - Plan & Status: `plan_tier` (`TRIAL`, `STARTER`, `GROWTH`, `ENTERPRISE`), `subscription_status` (`ACTIVE`, `PAST_DUE`, `CANCELLED`), `trial_ends_at`, `current_period_end`.
- **`users`** (`app/models/user.py`):
  - `id` (INTEGER PK), `tenant_id` (UUID FK), `email` (unique per tenant), `hashed_password`, `full_name`, `phone`, `role_id` (FK), `is_active`, `is_superuser`, `created_at`.
- **`roles`** & **`permissions`** (`app/models/user.py`):
  - Roles: `ADMIN`, `MANAGER`, `CASHIER`, `CAPTAIN`, `KITCHEN_CHEF`.
  - Permissions: Granular module access (`orders:create`, `billing:settle`, `inventory:adjust`, `admin:full`).
  - M2M Join: `role_permissions` (`role_id`, `permission_id`).

### 4.2 Physical Floor & QR Architecture
- **`branches`** (`app/models/branch.py`):
  - `id` (INTEGER PK), `tenant_id` (UUID FK), `name`, `code`, `address`, `phone`, `is_active`, `opening_time`, `closing_time`.
- **`tables`** (`app/models/table.py`):
  - `id` (INTEGER PK), `tenant_id` (UUID FK), `branch_id` (INTEGER FK), `table_number` (VARCHAR 20), `display_name`, `floor_number` (1=Ground, 2=First Floor, 3=Terrace, 4=Courtyard), `zone` (`ground`, `courtyard`, `first_floor`, `terrace`), `capacity`, `min_capacity`, `is_active`, `current_session_id`.
  - Composite Unique: `(tenant_id, branch_id, table_number)`.
- **`table_qrs`** (`app/models/table.py`):
  - `id`, `table_id` (FK), `qr_code_data`, `qr_image_url`, `is_active`.
- **`generalized_qrs`** (`app/models/table.py`):
  - Solves the static QR sticker flaw. Multi-token standalone QR passes displayed on stands or counter.
  - `id`, `tenant_id` (UUID FK), `token` (unique), `name`, `notes`, `is_active`, `created_at`.
- **`dining_sessions`** (`app/models/table.py`):
  - Atomic table occupancy record.
  - `id` (INTEGER PK), `table_id` (INTEGER FK), `reservation_id` (INTEGER FK, nullable), `session_token` (VARCHAR 64 unique), `guest_count`, `status` (`ACTIVE`, `COMPLETED`, `CANCELLED`), `opened_at`, `closed_at`.
  - Financials: `subtotal`, `tax_amount`, `discount_amount`, `advance_deposit_redeemed`, `total_amount`.
  - Invariant: A table cannot have more than one `ACTIVE` session at a time (enforced via DB partial unique index on PostgreSQL).

### 4.3 Table Reservations & Bank Settlement
- **`reservations`** (`app/models/reservation.py`):
  - `id` (INTEGER PK), `tenant_id` (UUID FK), `branch_id` (INTEGER FK), `booking_reference` (`RES-XXXX` unique), `customer_id` (FK), `customer_name`, `customer_phone`, `customer_email`, `reservation_date` (DATE), `time_slot` (TIME), `guest_count`.
  - Allocation: `table_id` (assigned table), `floor_number`, `expected_pizza_count`.
  - Status: `HOLD`, `PAID`, `CONFIRMED`, `CHECKED_IN`, `COMPLETED`, `CANCELLED`, `EXPIRED`, `NO_SHOW`.
  - Financials & Holds: `advance_amount` (NUMERIC 10,2 = ₹200.00 × guest_count), `payment_status` (`PENDING`, `PAID`, `REFUNDED`), `payment_method` (`UPI`, `RAZORPAY`), `payment_reference`, `upi_id`, `upi_utr` (12-digit bank reference), `hold_expires_at` (NOW() + 7 minutes).
  - Settlement Linkage: `is_deposit_credited` (BOOLEAN), `credited_bill_id` (INTEGER FK), `cancellation_refund_amount`, `cancellation_refund_status`.
- **`reservation_capacity_rules`** (`app/models/reservation.py`):
  - `id`, `tenant_id`, `branch_id`, `time_slot`, `max_guests`, `max_tables`, `is_active`.
- **`verified_bank_credits`** (`app/models/bank_transaction.py`):
  - Direct 0% commission fraud defense table. Populated by counter smartphone listeners (iOS Shortcuts / Android webhook).
  - `id`, `tenant_id`, `utr_number` (VARCHAR 12 unique, indexed), `amount` (NUMERIC 10,2), `sender_name`, `sender_upi`, `transaction_timestamp`, `is_reconciled`, `reconciled_reservation_id` (FK), `created_at`.

### 4.4 Menu & Capacity Control
- **`menu_categories`** (`app/models/menu.py`):
  - `id`, `tenant_id`, `branch_id`, `name`, `slug`, `display_order`, `is_active`.
- **`menu_items`** (`app/models/menu.py`):
  - `id`, `tenant_id`, `category_id` (FK), `name`, `code`, `description`, `base_price` (NUMERIC 10,2), `tax_rate` (5.00 for 5% GST), `is_veg`, `spice_level`, `is_chef_special`, `is_available`, `image_url`, `allergens` (JSON list).
- **`item_capacity_rules`** (`app/models/capacity.py`):
  - Governs hourly oven and kitchen throughput limits.
  - `id`, `tenant_id`, `menu_item_id` (FK), `max_per_hour`, `max_per_day`, `is_active`.
- **`daily_production_rules`** (`app/models/capacity.py`):
  - Governs artisanal dough batch availability (e.g. 150 Neapolitan dough balls prepared daily).
  - `id`, `tenant_id`, `date`, `total_dough_limit`, `reserved_dough_count`, `walkin_dough_count`.
- **`reservation_dough_allocations`** (`app/models/capacity.py`):
  - `id`, `reservation_id` (FK), `dough_count`, `allocated_at`.

### 4.5 Orders, KOTs & Kitchen Dispatch
- **`orders`** (`app/models/order.py`):
  - `id` (INTEGER PK), `tenant_id` (UUID FK), `session_id` (INTEGER FK), `order_number` (VARCHAR 32 unique), `order_type` (`DINE_IN`, `TAKEAWAY`, `DELIVERY`), `status` (`PENDING`, `ACCEPTED`, `IN_PREPARATION`, `READY`, `SERVED`, `CANCELLED`), `total_amount`, `notes`, `placed_at`.
- **`order_items`** (`app/models/order.py`):
  - `id`, `order_id` (FK), `menu_item_id` (FK), `quantity`, `unit_price`, `subtotal`, `notes` (e.g. "No onions, extra crispy"), `status`.
- **`order_status_history`** (`app/models/order.py`):
  - `id`, `order_id` (FK), `from_status`, `to_status`, `changed_at`, `changed_by_user_id`.
- **`kots`** (`app/models/kot.py`):
  - Kitchen Order Ticket for physical thermal printing.
  - `id`, `order_id` (FK), `kot_number` (sequential integer per day), `kitchen_station` (`PIZZA_OVEN`, `PASTA_BAR`, `BEVERAGE`), `status` (`PENDING`, `PRINTED`, `ACKNOWLEDGED`), `created_at`.
- **`kitchens`**, **`kitchen_printers`**, **`print_jobs`** (`app/models/kitchen.py`):
  - Hardware printer integration: IP, Port (9100), printer type (`NETWORK`, `SERIAL`, `BLUETOOTH`), and raw ESC/POS payload queue.

### 4.6 Billing, Payments & Discounts
- **`bills`** (`app/models/billing.py`):
  - `id` (INTEGER PK), `tenant_id` (UUID FK), `session_id` (INTEGER FK unique), `bill_number` (VARCHAR 32 unique), `subtotal`, `tax_amount` (CGST + SGST), `discount_amount`, `deposit_redeemed` (deduction from advance reservation deposit), `net_amount`, `status` (`UNPAID`, `PAID`, `REFUNDED`), `created_at`.
- **`payments`** (`app/models/billing.py`):
  - `id`, `bill_id` (FK), `payment_method` (`UPI`, `CASH`, `CARD`), `amount`, `transaction_ref`, `status` (`SUCCESS`, `FAILED`, `PENDING`), `created_at`.
- Net Due Calculation:
  $$\text{Net Due} = (\text{Subtotal} - \text{Discount} + \text{Tax}) - \text{Deposit Redeemed}$$

### 4.7 Inventory, Recipes & Supplier Invoices
- **`inventory_items`** (`app/models/inventory.py`):
  - Raw stock items (e.g. Caputo 00 Flour, San Marzano Tomatoes, Fior di Latte Mozzarella).
  - `id`, `tenant_id` (UUID FK), `name`, `sku`, `category`, `unit` (`kg`, `g`, `l`, `ml`, `pcs`), `current_stock`, `reorder_level`, `cost_per_unit`.
- **`recipes`** & **`recipe_items`** (`app/models/inventory.py`):
  - Bill of Materials (BOM). Links 1 `MenuItem` to raw inventory ingredients with precise depletion quantities.
- **`inventory_transactions`** (`app/models/inventory.py`):
  - `id`, `inventory_item_id` (FK), `transaction_type` (`IN`, `OUT`, `WASTE`, `AUTO_DEDUCT`), `quantity`, `reason`, `reference_id`, `created_at`.
- **`suppliers`**, **`purchase_orders`**, **`purchase_order_items`** (`app/models/supplier.py`):
  - Vendor relationship, purchase orders, and OCR-extracted purchase entries.

### 4.8 Operations, Customer & Audit
- **`customers`** (`app/models/customer.py`):
  - `id`, `tenant_id`, `name`, `phone` (indexed), `email`, `total_visits`, `total_spend`, `dietary_preferences`, `notes`.
- **`feedback`** (`app/models/feedback.py`):
  - Post-dining ratings (1-5 stars) linked to session and customer.
- **`notifications`** (`app/models/notification.py`):
  - Multi-channel notification log (`IN_APP`, `WHATSAPP`, `EMAIL`).
- **`audit_logs`** (`app/models/audit.py`):
  - Immutable audit trail: `user_id`, `action`, `entity_type`, `entity_id`, `payload`, `ip_address`, `timestamp`.
- **`system_settings`** (`app/models/settings.py`):
  - Key-value configuration store per tenant (deposit remainder policy, tax percentage, printer IP, etc.).

---

## 5. Critical Database & Business Logic Pipelines

### 5.1 Reservation & 7-Minute Atomic Lock Pipeline
1. **Deposit Calculation**: Strictly `Decimal("200.00") * guest_count` (`NUMERIC(10,2)`).
2. **Hold Locking**: When guest initiates booking, `status = 'HOLD'` and `hold_expires_at = datetime.now(timezone.utc) + timedelta(minutes=7)`.
3. **Capacity Check**: Validates that both table count and hourly oven dough capacity (`daily_production_rules`) are not exceeded for that slot.
4. **Direct Bank UPI Reconcile (`PaymentVerificationService`)**:
   - Customer submits 12-digit UTR.
   - Fraud prevention query checks `verified_bank_credits` where `utr_number = submitted_utr` AND `amount >= advance_amount` AND `is_reconciled = False`.
   - If match found: marks bank record `is_reconciled = True`, updates reservation to `status = 'CONFIRMED'`, `payment_status = 'PAID'`.
   - Dispatches WhatsApp confirmation via Celery background worker.
5. **Deposit Remainder Policies (`SettingsService`)**:
   - `CUSTOMER_CREDIT` (Default): If Bill total < Advance Deposit, the excess amount is credited to customer's account for future visits.
   - `REFUND_REMAINDER`: Remaining balance queued for merchant bank refund.
   - `FORFEIT_REMAINDER`: Balance retained as reservation fee.

### 5.2 Dynamic Generalized QR & Session Lifecycle
- Traditional systems print Table #2 on a sticker. If guests move to the Courtyard, tickets get lost.
- **Generalized Dynamic QR**:
  1. High-res QR passes displayed at entrance/stands encode generalized token `https://<domain>/table/<token>`.
  2. Arriving guest scans $\rightarrow$ Can enter booking code (`RES-XXXX`) to claim their reserved table OR start a walk-in session.
  3. POS Cashier assigns or shifts the session to any physical table (e.g. Table 2 Floor 1 $\rightarrow$ Table C3 Courtyard).
  4. The underlying `session_token` remains intact; all active orders and KOTs move smoothly with zero mix-up.

### 5.3 Order Processing & Automatic BOM Depletion (`OrderService`)
When `POST /api/v1/orders` is executed:
```python
async with db.begin():
    # 1. Row-lock DiningSession
    session = await db.get(DiningSession, session_id, with_for_update=True)
    
    # 2. Iterate each item
    for item in items:
        # A. Capacity Check (Oven limit / Dough balls remaining)
        await CapacityService.validate_and_allocate(db, item.menu_item_id, item.qty)
        
        # B. Bill of Materials (BOM) Auto-Deduction
        recipe = await db.get(Recipe, item.menu_item_id)
        for ing in recipe.items:
            stock = await db.get(InventoryItem, ing.inventory_item_id, with_for_update=True)
            if stock.current_stock < (ing.quantity_required * item.qty):
                raise HTTPException(400, f"Insufficient stock for {stock.name}")
            stock.current_stock -= (ing.quantity_required * item.qty)
            # Insert InventoryTransaction(type='AUTO_DEDUCT')
            
    # 3. Create Order & OrderItem rows
    # 4. Generate sequential KOT number
    # 5. Broadcast to Redis 'kitchen_channel'
```

### 5.4 POS 1-Tap Thermal Bill Printing (`BillingService`)
- Cashier clicks **★ Print Bill** on `/pos`.
- Selects payment tender: **UPI**, **Cash**, or **Card**.
- Net due is auto-deducted: `(Subtotal - Discount + Tax) - Deposit Redeemed`.
- Renders an 80mm ESC/POS thermal ticket with dietary/allergy warnings prominently highlighted at top.
- Marks `DiningSession.status = 'COMPLETED'` and releases Table state back to `AVAILABLE`.

### 5.5 Distributed Rate Limiting & Gateway Security (`main.py`)
Sliding-window Redis rate limits are enforced prior to hitting database connections:
- `/api/v1/auth/login`: **12 req/min** (Brute-force protection)
- `/api/v1/tables/qr/validate`: **30 req/min** (QR scan flood protection)
- Any `POST / PUT / PATCH / DELETE`: **90 req/min**
- Any `GET`: **300 req/min**
- Staff are isolated by JWT Bearer hash; guests by forwarded client IP (`X-Forwarded-For`).

---

## 6. Complete API Route Catalog (`/api/v1`)

| Module | Route Prefix | Key Endpoints | Description |
|---|---|---|---|
| **Auth** | `/api/v1/auth` | `POST /login`, `POST /refresh`, `GET /me`, `POST /logout` | JWT authentication & role extraction |
| **Tenants** | `/api/v1/tenants` | `GET /`, `POST /`, `GET /{slug}`, `PATCH /{slug}`, `GET /current` | Multi-tenant SaaS administration & branding |
| **Tables** | `/api/v1/tables` | `GET /`, `POST /`, `GET /floor-plan`, `POST /qr/validate`, `POST /qr/walk-in` | Table management, generalized QR validation & walk-in |
| **Sessions** | `/api/v1/sessions`| `GET /{id}`, `POST /open`, `POST /{id}/close`, `POST /{id}/assign-table`| Dining session table lifecycle & transfer |
| **Menu** | `/api/v1/menu` | `GET /categories`, `GET /items`, `POST /items`, `PATCH /items/{id}/availability` | Category & item control, real-time sold-out toggle |
| **Reservations** | `/api/v1/reservations` | `POST /`, `GET /slots`, `GET /{ref}`, `POST /{ref}/verify-utr`, `POST /{id}/check-in` | 7-min hold booking, slot capacity & UPI verification |
| **Orders** | `/api/v1/orders` | `POST /`, `GET /{id}`, `GET /session/{session_id}`, `PATCH /{id}/status` | Atomic order placement & BOM depletion |
| **Kitchen** | `/api/v1/kitchen` | `GET /kots/active`, `POST /kots/{id}/bump`, `POST /print-test` | KDS screen feeds, station bump bar, printer jobs |
| **POS** | `/api/v1/pos` | `GET /overview`, `POST /quick-order`, `POST /merge-tables`, `POST /apply-discount` | Real-time floor plan, fast order punching |
| **Billing** | `/api/v1/billing` | `POST /generate/{session_id}`, `POST /{id}/settle`, `GET /receipt/{id}` | 1-tap thermal receipt generation & payment settlement |
| **Inventory** | `/api/v1/inventory`| `GET /items`, `POST /adjust`, `POST /scan-invoice`, `GET /low-stock` | Stock levels, Sarvam AI invoice OCR, reorder alerts |
| **Analytics** | `/api/v1/analytics`| `GET /daily-summary`, `GET /revenue-breakdown`, `GET /top-dishes` | Real-time gross/net sales, UPI vs Cash vs Card splits |
| **Manager** | `/api/v1/manager` | `GET /shift-report`, `POST /reconcile-drawer`, `GET /staff-audit` | Shift handover, cash drawer reconciliation & audits |
| **WebSockets** | `/ws` | `/ws/pos`, `/ws/kds`, `/ws/tables/{id}` | Bi-directional real-time event distribution |

---

## 7. Frontend Architecture & Page Routes

All frontend code resides in `frontend/src/` using **Next.js 16 App Router**:

```
frontend/src/
├── middleware.ts            # Inspects Host / Subdomain / ?tenant= and sets 'x-tenant-slug'
├── app/
│   ├── (public)/
│   │   ├── page.tsx         # Artisanal brand landing page & video showcase
│   │   ├── menu/page.tsx    # Live menu with dietary flags, allergen badges & prices
│   │   ├── book-table/page.tsx # Table reservation flow: Date/Time/Guest -> UPI Hold -> Pass
│   │   ├── location/page.tsx   # Sitaphal ki gali heritage location & alley parking guide
│   │   ├── about/page.tsx   # Heritage story & culinary philosophy
│   │   ├── contact/page.tsx # Contact & store hours
│   │   └── terms/privacy/   # Legal policies & refund guidelines
│   ├── (operations)/
│   │   ├── pos/page.tsx     # Cashier terminal: Visual 4-zone floor map, 1-tap thermal billing
│   │   ├── kds/page.tsx     # Kitchen Display: Station routing, aging color timers, bump bar
│   │   ├── admin/page.tsx   # Executive ledger, generalized QR manager, OCR invoice scanner
│   │   ├── manager/page.tsx # Shift oversight, staff accountability, drawer audit
│   │   ├── table/           # Dynamic QR routing: Claim booking or start walk-in
│   │   └── onboard/page.tsx # Self-service onboarding for new restaurant tenants
│   └── globals.css          # Design system tokens, thermal print CSS (@media print)
├── components/              # Modular UI components (Modal, Dropdown, Badges, Tables)
└── lib/
    ├── authFetch.ts         # Authenticated fetch wrapper injecting Bearer token
    ├── upstream.ts          # Central backend API URL resolver
    └── socket.ts            # Client WebSocket connection helper
```

---

## 8. Complete Project File & Directory Tree

```
/Users/princegupta/Downloads/Cafe Pizza 2/
├── context.md                             # <-- THIS FILE (Master Project Context)
├── PROJECT_ARCHITECTURE.md                # System execution flows & architectural diagrams
├── PROJECT_CONTEXT_AND_ROADMAP.md         # On-ground Udaipur context, features & roadmap
├── appflow.md / techspec.md / design.md   # System specs & UI design guidelines
├── backend/
│   ├── alembic/
│   │   ├── env.py                         # Alembic async migration runner
│   │   └── versions/
│   │       ├── 001_initial_schema.py      # Core tables (users, tables, menu, orders, bills)
│   │       ├── 002_phase3_schema.py       # Inventory & supplier tables
│   │       ├── 003_dough_production_schema.py # Daily production & capacity rules
│   │       ├── 004_add_missing_reservation_columns.py # UPI UTR, payment reference, holds
│   │       └── 005_multi_tenancy_core.py  # Root tenants table & tenant_id backfills
│   ├── app/
│   │   ├── main.py                        # FastAPI entrypoint, CORS, Redis rate-limiting
│   │   ├── core/
│   │   │   ├── config.py                  # Pydantic BaseSettings (.env variables)
│   │   │   ├── database.py                # Async engine & sessionmaker (PostgreSQL / SQLite)
│   │   │   ├── security.py                # Password hashing (bcrypt) & JWT encode/decode
│   │   │   └── tenant.py                  # Tenant extraction dependency & validation
│   │   ├── models/                        # 20+ SQLAlchemy models (Tenant, Order, Table, etc.)
│   │   ├── schemas/                       # Pydantic request/response validation schemas
│   │   ├── services/
│   │   │   ├── reservation_service.py     # 7-min holds, UPI generation, slot validation
│   │   │   ├── payment_verification_service.py # Fraud check vs verified_bank_credits
│   │   │   ├── order_service.py           # Atomic order coordinator & transaction runner
│   │   │   ├── capacity_service.py        # Woodfired oven & dough limit protection
│   │   │   ├── inventory_service.py       # Recipe BOM auto-deduction
│   │   │   ├── billing_service.py         # Thermal bill layout & advance deposit deduction
│   │   │   ├── pos_service.py             # POS floor state & fast cashier ops
│   │   │   ├── table_service.py           # Table state & generalized QR token manager
│   │   │   ├── bill_scan_service.py       # Sarvam AI OCR invoice parser
│   │   │   └── whatsapp_service.py        # Meta Cloud API booking alerts
│   │   ├── api/v1/                        # 13 REST API route modules
│   │   ├── utils/                         # Date/time helpers, currency formatters
│   │   └── workers/                       # Celery tasks (WhatsApp dispatch, auto-cancellation)
│   ├── tests/                             # Comprehensive pytest test suite (38+ test files)
│   ├── requirements.txt                   # Python dependencies
│   └── Dockerfile / docker-compose.yml    # Containerized deployment config
└── frontend/                              # Next.js 16 Web Application
```

---

## 9. Environment Variables & Configuration

Below are the primary configuration keys loaded by `backend/app/core/config.py`:

```bash
# Application
APP_ENV=development                       # 'development', 'staging', 'production'
APP_NAME="Jaadoo Udaipur Cafe Management API"
SECRET_KEY="super-secret-key-minimum-32-characters"

# Database Connection
DATABASE_URL="postgresql+asyncpg://postgres:postgres@localhost:5432/cafe_db"
# (Auto-falls back to sqlite+aiosqlite:///./cafe_dev.db if postgres is unavailable in local dev)

# Redis Cache, Pub/Sub & Celery
REDIS_URL="redis://localhost:6379/0"
CELERY_BROKER_URL="redis://localhost:6379/1"
CELERY_RESULT_BACKEND="redis://localhost:6379/2"

# Security & Tokens
JWT_SECRET_KEY="jwt-signing-secret"
JWT_ALGORITHM="HS256"
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=300

# CORS
CORS_ORIGINS=["http://localhost:3000","http://127.0.0.1:3000"]

# Third-Party Integrations
WHATSAPP_ACCESS_TOKEN=""                  # Meta WhatsApp Cloud API access token
WHATSAPP_PHONE_NUMBER_ID=""               # Meta Phone Number ID
SARVAM_API_KEY=""                         # Sarvam AI Document Extract API key
RAZORPAY_KEY_ID=""                        # Razorpay Key ID
RAZORPAY_KEY_SECRET=""                    # Razorpay Secret
BANK_WEBHOOK_SECRET=""                    # Secret for counter phone listener webhooks
```

---

## 10. Developer Runbook & Common Commands

### Backend Commands
```bash
# 1. Activate virtual environment
source backend/venv/bin/activate  # or venv/bin/activate

# 2. Run backend dev server
cd backend
uvicorn app.main:app --reload --port 8000

# 3. Run database migrations
cd backend
alembic upgrade head

# 4. Run test suite
cd backend
pytest -v
```

### Frontend Commands
```bash
# 1. Install dependencies
cd frontend
npm install

# 2. Run Next.js development server
npm run dev
# Opens at http://localhost:3000
```

---

## 11. Core Invariants & Rules for AI Development

When writing code or assisting with features in this repository, **always obey these rules**:

1. **Always Scope by `tenant_id`**: Any new query, insert, or update on root business entities (`users`, `tables`, `orders`, `reservations`, `bills`, `menu_items`, `inventory_items`) MUST include `tenant_id`. Never allow cross-tenant data leaks.
2. **Strict Financial Precision**: Never use Python floats for money. Always use `Decimal` with `NUMERIC(10, 2)` for deposits, subtotal, taxes, discounts, and payments.
3. **No Kitchen Display System (KDS) Lock-in**: Physical thermal KOT printing via 80mm ESC/POS is the primary kitchen interface. The web KDS (`/kds`) is a complementary real-time monitor.
4. **Fraud-Proof UTR Settlement**: In production, customer-submitted UPI UTRs must match an existing row in `verified_bank_credits`. Never trust raw client payment claims without bank confirmation.
5. **Generalized QR Flexibility**: Do not assume static table stickers. Dining sessions are dynamically linked and can be reassigned between tables without breaking ongoing orders.
