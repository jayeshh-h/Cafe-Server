from fastapi import APIRouter
from app.api.v1.auth import router as auth_router
from app.api.v1.reservations import router as reservations_router
from app.api.v1.tables import router as tables_router, sessions_router
from app.api.v1.menu import router as menu_router
from app.api.v1.orders import router as orders_router
from app.api.v1.kitchen import router as kitchen_router
from app.api.v1.billing import router as billing_router
from app.api.v1.inventory import router as inventory_router
from app.api.v1.analytics import router as analytics_router
from app.api.v1.pos import router as pos_router
from app.api.v1.manager import router as manager_router
from app.api.v1.tenants import router as tenants_router

api_v1_router = APIRouter(prefix="/v1")
api_v1_router.include_router(auth_router)
api_v1_router.include_router(reservations_router)
api_v1_router.include_router(tables_router)
api_v1_router.include_router(sessions_router)
api_v1_router.include_router(menu_router)
api_v1_router.include_router(orders_router)
api_v1_router.include_router(kitchen_router)
api_v1_router.include_router(pos_router)
api_v1_router.include_router(billing_router)
api_v1_router.include_router(inventory_router)
api_v1_router.include_router(analytics_router)
api_v1_router.include_router(manager_router)
api_v1_router.include_router(tenants_router)

