import uuid
from datetime import datetime
from decimal import Decimal
from typing import List, Optional
from pydantic import BaseModel, EmailStr, Field


class TenantPublicResponse(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    custom_domain: Optional[str] = None
    logo_url: Optional[str] = None
    favicon_url: Optional[str] = None
    hero_image_url: Optional[str] = None
    hero_video_url: Optional[str] = None
    tagline: Optional[str] = None
    about_text: Optional[str] = None
    primary_color: str = "#2B1810"
    secondary_color: str = "#F7F4EE"
    accent_color: str = "#C86D51"
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    google_maps_url: Optional[str] = None
    reservation_closed_weekdays: str = "1,2"
    reservation_open_time: str = "11:00"
    reservation_last_slot_time: str = "22:30"
    deposit_per_guest: Decimal = Decimal("150.00")
    merchant_upi_id: Optional[str] = None
    merchant_name: Optional[str] = None
    razorpay_key_id: Optional[str] = None
    allow_online_payments: bool = True
    plan_tier: str = "TRIAL"
    subscription_status: str = "ACTIVE"

    class Config:
        from_attributes = True


class SlugCheckResponse(BaseModel):
    slug: str
    available: bool
    message: str


class MenuItemSeed(BaseModel):
    name: str
    category: str
    price: float
    description: Optional[str] = None
    is_veg: bool = True
    dietary_tags: Optional[str] = None


class TenantOnboardRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=100, description="Business / Café Name")
    slug: str = Field(..., min_length=3, max_length=30, description="Preferred subdomain key")
    admin_name: str = Field(..., min_length=2, max_length=50, description="Owner Full Name")
    admin_email: EmailStr = Field(..., description="Owner Login Email")
    admin_password: str = Field(..., min_length=6, max_length=100, description="Owner Password")
    phone: Optional[str] = Field(None, max_length=32)
    address: Optional[str] = Field(None, max_length=255)
    tagline: Optional[str] = Field(None, max_length=255)
    primary_color: str = Field(default="#2B1810", max_length=16)
    secondary_color: str = Field(default="#F7F4EE", max_length=16)
    accent_color: str = Field(default="#C86D51", max_length=16)
    merchant_upi_id: Optional[str] = Field(None, max_length=128)
    merchant_name: Optional[str] = Field(None, max_length=128)
    table_count: int = Field(default=8, ge=1, le=50)
    template: str = Field(default="pizzeria", description="Menu template: pizzeria, cafe, bistro, blank")
    custom_items: Optional[List[MenuItemSeed]] = None


class TableQROverviewItem(BaseModel):
    table_id: int
    table_number: str
    capacity: int
    qr_token: str
    order_url: str


class TenantOnboardResponse(BaseModel):
    tenant: TenantPublicResponse
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    owner_username: str
    owner_email: str
    tables_created: int
    tables: List[TableQROverviewItem]
    portal_urls: dict
