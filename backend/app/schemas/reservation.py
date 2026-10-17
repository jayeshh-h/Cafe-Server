import re
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional, Any, Union
from pydantic import BaseModel, ConfigDict, Field, field_validator


# ponytail: reservation input guardrails & sanitizers
def sanitize_customer_name(v: str) -> str:
    if not v or not isinstance(v, str):
        raise ValueError("Customer name is required.")
    cleaned = re.sub(r"<script.*?>.*?</script>", "", v, flags=re.IGNORECASE | re.DOTALL)
    cleaned = re.sub(r"<[^>]+>", "", cleaned)
    cleaned = re.sub(r"[^a-zA-Z\s\.\'\-]", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if len(cleaned) < 2:
        raise ValueError("Customer name must be at least 2 characters long.")
    if len(cleaned) > 60:
        cleaned = cleaned[:60].strip()
    if not any(c.isalpha() for c in cleaned):
        raise ValueError("Customer name must contain valid alphabetic characters.")
    return cleaned.title()


def sanitize_customer_phone(v: str) -> str:
    if not v or not isinstance(v, str):
        raise ValueError("Customer phone number is required.")
    raw = str(v).strip()
    digits = re.sub(r"\D", "", raw)
    # ponytail: handle international numbers with country code prefix while maintaining Indian mobile rules
    is_explicit_intl = raw.startswith("+") and not raw.startswith("+91")
    if not is_explicit_intl:
        if len(digits) == 12 and digits.startswith("91"):
            digits = digits[2:]
        elif len(digits) == 11 and digits.startswith("0"):
            digits = digits[1:]

        if len(digits) == 10 and digits[0] in "6789":
            if len(set(digits)) == 1 or digits in ("1234567890", "9876543210", "0123456789"):
                raise ValueError("Please provide a valid personal mobile number.")
            return digits
        raise ValueError("Phone number must be a valid 10-digit mobile number.")

    if not (7 <= len(digits) <= 15) or len(set(digits)) == 1:
        raise ValueError("Please provide a valid international phone number.")
    return f"+{digits}"



def sanitize_customer_email(v: Optional[str]) -> Optional[str]:
    if not v or not isinstance(v, str):
        return None
    cleaned = v.strip().lower()
    if not cleaned:
        return None
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", cleaned) or len(cleaned) > 100:
        raise ValueError("Please provide a valid email address.")
    return cleaned


def validate_reservation_date_guardrail(v: date) -> date:
    from app.core.config import settings
    if not getattr(settings, "BOOKING_RULES_ENFORCED", True):
        return v
    today = date.today()
    if v < today:
        raise ValueError("Reservation date cannot be in the past.")
    max_advance = today + timedelta(days=60)
    if v > max_advance:
        raise ValueError("Reservations cannot be booked more than 60 days in advance.")
    return v


def sanitize_special_requests(v: Optional[str]) -> Optional[str]:
    if not v or not isinstance(v, str):
        return None
    cleaned = re.sub(r"<script.*?>.*?</script>", "", v, flags=re.IGNORECASE | re.DOTALL)
    cleaned = re.sub(r"<[^>]+>", "", cleaned)
    cleaned = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not cleaned:
        return None
    return cleaned[:300]


class CustomerBase(BaseModel):
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None


class CustomerCreate(BaseModel):
    name: str
    phone: str
    email: Optional[str] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        return sanitize_customer_name(v)

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        return sanitize_customer_phone(v)

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: Optional[str]) -> Optional[str]:
        return sanitize_customer_email(v)


class CustomerResponse(CustomerBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: Optional[datetime] = None


class ReservationCreate(BaseModel):
    branch_id: int = Field(..., example=1)
    customer_name: str = Field(..., example="Rajesh Sharma")
    customer_phone: str = Field(..., example="+919876543210")
    customer_email: Optional[str] = Field(None, example="rajesh@example.com")
    guest_count: int = Field(..., ge=1, le=12, example=4)
    reservation_date: date = Field(..., example="2026-09-25")
    time_slot: str = Field(..., example="19:00-20:00")
    table_id: Optional[int] = Field(None, example=1)
    floor_number: Optional[int] = Field(None, example=1)
    table_name: Optional[str] = Field(None, example="Table 1")
    payment_status: Optional[str] = Field("PAID", example="PAID")
    advance_amount: Optional[Decimal] = Field(None, example="400.00")
    payment_reference: Optional[str] = Field(None, example="TXN-UPI-987654321")
    payment_method: Optional[str] = Field(None, example="UPI")

    @field_validator("customer_name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        return sanitize_customer_name(v)

    @field_validator("customer_phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        return sanitize_customer_phone(v)

    @field_validator("customer_email")
    @classmethod
    def validate_email(cls, v: Optional[str]) -> Optional[str]:
        return sanitize_customer_email(v)

    @field_validator("reservation_date")
    @classmethod
    def validate_date(cls, v: date) -> date:
        return validate_reservation_date_guardrail(v)


class ReservationUpdate(BaseModel):
    guest_count: Optional[int] = Field(None, ge=1, le=12)
    reservation_date: Optional[date] = None
    time_slot: Optional[str] = None
    table_id: Optional[int] = None
    floor_number: Optional[int] = None
    table_name: Optional[str] = None
    status: Optional[str] = None

    @field_validator("reservation_date")
    @classmethod
    def validate_date(cls, v: Optional[date]) -> Optional[date]:
        if v is None:
            return None
        return validate_reservation_date_guardrail(v)


class ReservationStatusUpdate(BaseModel):
    status: str = Field(..., example="ARRIVED")


class ReservationCheckInRequest(BaseModel):
    session_token: Optional[str] = None
    table_id: Optional[int] = None


class ReservationAssignTableRequest(BaseModel):
    table_id: int = Field(..., example=1)
    table_name: Optional[str] = Field(None, example="Table 1")
    floor_number: Optional[int] = Field(None, example=1)


class ReservationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    booking_id: Optional[str] = None
    branch_id: Optional[int] = 1
    customer_id: Optional[int] = None
    guest_count: int
    reservation_date: date
    time_slot: Optional[str] = ""
    table_id: Optional[int] = None
    floor_number: Optional[int] = None
    table_name: Optional[str] = None
    status: Optional[str] = "CONFIRMED"
    payment_status: Optional[str] = "PAID"
    advance_amount: Optional[float] = 0.0
    payment_reference: Optional[str] = None
    payment_method: Optional[str] = None
    hold_expires_at: Optional[datetime] = None
    upi_id: Optional[str] = None
    upi_utr: Optional[str] = None
    is_deposit_credited: bool = False
    credited_bill_id: Optional[int] = None
    cancellation_refund_amount: Optional[float] = 0.0
    cancellation_refund_status: Optional[str] = None
    celery_task_id: Optional[str] = None
    created_at: Optional[datetime] = None
    customer: Optional[CustomerResponse] = None
    is_historical_limited: Optional[bool] = False


class ReservationHoldRequest(BaseModel):
    branch_id: int = Field(1, example=1)
    customer_name: str = Field(..., example="Aarav Sharma")
    customer_phone: str = Field(..., example="+919876543210")
    customer_email: Optional[str] = None
    guest_count: int = Field(..., ge=1, le=12, example=3)
    reservation_date: date = Field(..., example="2026-09-30")
    time_slot: str = Field(..., example="19:30")
    floor_number: Optional[int] = Field(None, example=1)
    table_name: Optional[str] = Field(None, example="Table 1")
    table_id: Optional[int] = None

    @field_validator("customer_name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        return sanitize_customer_name(v)

    @field_validator("customer_phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        return sanitize_customer_phone(v)

    @field_validator("customer_email")
    @classmethod
    def validate_email(cls, v: Optional[str]) -> Optional[str]:
        return sanitize_customer_email(v)

    @field_validator("reservation_date")
    @classmethod
    def validate_date(cls, v: date) -> date:
        return validate_reservation_date_guardrail(v)


class ReservationHoldResponse(BaseModel):
    reservation_id: int
    hold_expires_at: datetime
    seconds_remaining: int
    advance_amount: float
    guest_count: int
    deposit_per_guest: float
    upi_id: str
    upi_uri: str
    qr_code_content: str
    status: str
    floor_number: Optional[int] = None
    table_name: Optional[str] = None
    reservation_date: date
    time_slot: str


class ReservationVerifyUpiRequest(BaseModel):
    upi_utr: str = Field(..., min_length=4, max_length=50, example="426819283741")
    customer_upi_vpa: Optional[str] = Field(None, example="customer@okaxis")


class ReservationCapacityRuleCreate(BaseModel):
    branch_id: int
    time_slot: str
    max_guest_capacity: int = Field(..., ge=1)
    is_active: bool = True


class ReservationCapacityRuleResponse(ReservationCapacityRuleCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int


class BankWebhookPayload(BaseModel):
    utr: str = Field(..., min_length=4, max_length=64, example="426819283741")
    amount: Decimal = Field(..., gt=0, example=400.0)
    merchant_vpa: str = Field("9460555743-2@ybl")
    payer_vpa: Optional[str] = None
    tx_status: str = Field("SETTLED", example="SETTLED")
    provider_source: str = Field("BANK_WEBHOOK", example="BANK_WEBHOOK")
    signature: Optional[str] = None


class PaymentEventPayload(BaseModel):
    model_config = ConfigDict(extra="allow")

    event_id: Optional[str] = None
    utr: Optional[str] = None
    amount: Optional[Any] = None
    merchant_vpa: Optional[str] = None
    payer_vpa: Optional[str] = None
    event_timestamp: Optional[datetime] = None


AndroidPaymentEventPayload = PaymentEventPayload
DevicePaymentEventPayload = PaymentEventPayload




class PolicySettingsUpdate(BaseModel):
    deposit_per_person: Optional[Decimal] = Field(None, ge=100)
    remainder_policy: Optional[str] = Field(None, example="CUSTOMER_CREDIT")  # REFUND_REMAINDER, CUSTOMER_CREDIT, FORFEIT_REMAINDER
    cancellation_policy: Optional[str] = Field(None, example="REFUND_BEFORE_CUTOFF")
    cancellation_cutoff_hours: Optional[int] = Field(None, ge=0)
    cancellation_refund_percentage: Optional[Decimal] = Field(None, ge=0, le=100)
    no_show_policy: Optional[str] = Field(None, example="FORFEIT")


class RazorpayCreateOrderRequest(BaseModel):
    branch_id: int = Field(1, example=1)
    customer_name: str = Field(..., example="Aarav Sharma")
    customer_phone: str = Field(..., example="+919876543210")
    customer_email: Optional[str] = None
    guest_count: int = Field(..., ge=1, le=12, example=2)
    reservation_date: date = Field(..., example="2026-10-18")
    time_slot: str = Field(..., example="07:00 PM")
    floor_number: Optional[int] = Field(None, example=1)
    table_name: Optional[str] = Field(None, example="Table 1")
    table_id: Optional[int] = None
    special_requests: Optional[str] = None

    @field_validator("customer_name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        return sanitize_customer_name(v)

    @field_validator("customer_phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        return sanitize_customer_phone(v)

    @field_validator("customer_email")
    @classmethod
    def validate_email(cls, v: Optional[str]) -> Optional[str]:
        return sanitize_customer_email(v)

    @field_validator("reservation_date")
    @classmethod
    def validate_date(cls, v: date) -> date:
        return validate_reservation_date_guardrail(v)

    @field_validator("special_requests")
    @classmethod
    def validate_requests(cls, v: Optional[str]) -> Optional[str]:
        return sanitize_special_requests(v)


class RazorpayCreateOrderResponse(BaseModel):
    order_id: str
    amount: int  # Amount in paise (e.g. 30000 for ₹300.00)
    currency: str = "INR"
    key_id: str
    guest_count: int
    deposit_per_guest: float
    total_amount: float
    customer_name: str
    customer_phone: str
    customer_email: Optional[str] = None
    is_test_mode: bool = True


class RazorpayVerifyPaymentRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str
    branch_id: int = Field(1, example=1)
    customer_name: str
    customer_phone: str
    customer_email: Optional[str] = None
    guest_count: int = Field(..., ge=1, le=12)
    reservation_date: date
    time_slot: str
    floor_number: Optional[int] = 1
    table_name: Optional[str] = "Table 1"
    table_id: Optional[int] = None
    special_requests: Optional[str] = None
    is_test_simulation: Optional[bool] = False

    @field_validator("customer_name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        return sanitize_customer_name(v)

    @field_validator("customer_phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        return sanitize_customer_phone(v)

    @field_validator("customer_email")
    @classmethod
    def validate_email(cls, v: Optional[str]) -> Optional[str]:
        return sanitize_customer_email(v)

    @field_validator("reservation_date")
    @classmethod
    def validate_date(cls, v: date) -> date:
        return validate_reservation_date_guardrail(v)

    @field_validator("special_requests")
    @classmethod
    def validate_requests(cls, v: Optional[str]) -> Optional[str]:
        return sanitize_special_requests(v)


class RazorpaySimulateWebhookRequest(BaseModel):
    event: str = Field("payment.captured", example="payment.captured")
    payment_id: Optional[str] = None
    order_id: Optional[str] = None
    amount: Optional[int] = 30000
    phone: Optional[str] = "+919876543210"



