import datetime
from typing import Any, Optional, Union
from jose import jwt
from passlib.context import CryptContext
from app.core.config import settings

pwd_context = CryptContext(schemes=["argon2", "bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    try:
        return pwd_context.hash(password)
    except Exception:
        import hashlib
        return "sha256$" + hashlib.sha256(password.encode()).hexdigest()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    if not hashed_password or not plain_password:
        return False
    try:
        if hashed_password.startswith("sha256$"):
            import hashlib, hmac
            expected = "sha256$" + hashlib.sha256(plain_password.encode("utf-8")).hexdigest()
            return hmac.compare_digest(hashed_password, expected)
        return pwd_context.verify(plain_password, hashed_password)
    except Exception:
        return False


def create_access_token(
    subject: Union[str, Any],
    expires_delta: Optional[datetime.timedelta] = None,
    tenant_id: Optional[Union[str, Any]] = None,
) -> str:
    if expires_delta:
        expire = datetime.datetime.now(datetime.timezone.utc) + expires_delta
    else:
        expire = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(
            minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES
        )
    to_encode = {"exp": expire, "sub": str(subject), "type": "access"}
    if tenant_id is not None:
        to_encode["tenant_id"] = str(tenant_id)
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(
    subject: Union[str, Any],
    expires_delta: Optional[datetime.timedelta] = None,
    tenant_id: Optional[Union[str, Any]] = None,
) -> str:
    if expires_delta:
        expire = datetime.datetime.now(datetime.timezone.utc) + expires_delta
    else:
        expire_minutes = getattr(settings, "JWT_REFRESH_TOKEN_EXPIRE_MINUTES", 300)
        expire = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(
            minutes=expire_minutes
        )
    to_encode = {"exp": expire, "sub": str(subject), "type": "refresh"}
    if tenant_id is not None:
        to_encode["tenant_id"] = str(tenant_id)
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(
            token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
        )
        return payload
    except Exception:
        return None
