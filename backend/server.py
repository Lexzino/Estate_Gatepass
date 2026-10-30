"""EstateGate API entrypoint."""
import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core import client, db, setup_logging
from routes_admin import router as admin_router
from routes_auth import misc as push_router
from routes_auth import router as auth_router
from routes_guard import router as guard_router
from routes_public import router as public_router
from routes_resident import router as resident_router
from seed import ensure_indexes, seed
from services import refresh_expired, run_retention

setup_logging()
logger = logging.getLogger("estategate")


async def background_jobs():
    """Expire passes every 5 min; run retention once a day per estate."""
    tick = 0
    while True:
        try:
            await refresh_expired()
            if tick % 288 == 0:
                async for estate in db.estates.find({}):
                    await run_retention(estate)
        except Exception as e:  # keep the loop alive
            logger.warning(f"background job error: {type(e).__name__}")
        tick += 1
        await asyncio.sleep(300)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await ensure_indexes()
    await seed()
    task = asyncio.create_task(background_jobs())
    yield
    task.cancel()
    client.close()


app = FastAPI(title="EstateGate API", version="1.0.0", lifespan=lifespan,
              docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)


@app.get("/health", include_in_schema=False)
@app.head("/health", include_in_schema=False)
async def health():
    return {"status": "ok"}


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    response.headers.setdefault("Cache-Control", "no-store")
    return response


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    logger.error(f"unhandled error on {request.url.path}: {type(exc).__name__}")
    return JSONResponse({"detail": "Something went wrong. Please try again."}, status_code=500)


for r in (auth_router, push_router, resident_router, guard_router, admin_router, public_router):
    app.include_router(r)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ["CORS_ORIGINS"].split(",") if o.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Authorization", "Content-Type"],
)
