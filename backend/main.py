"""
MapGenerator Backend — FastAPI Application
Orchestrates BRouter (A-to-B routing) and GraphHopper (loop routing)
to generate GPX files from user settings.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import httpx

from routers import routes, geocoding, profiles


# ─────────────────────────────────────────────────────────────────────────────
# Shared async HTTP client (reused across all requests)
# ─────────────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http_client = httpx.AsyncClient(timeout=60.0)
    yield
    await app.state.http_client.aclose()


# ─────────────────────────────────────────────────────────────────────────────
# App
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="MapGenerator API",
    description="Generate GPX routes from coordinates and activity profiles using BRouter and GraphHopper.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],       # Restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────────────────────────────────────
# Routers
# ─────────────────────────────────────────────────────────────────────────────

app.include_router(routes.router,    prefix="/api", tags=["Routes"])
app.include_router(geocoding.router, prefix="/api", tags=["Geocoding"])
app.include_router(profiles.router,  prefix="/api", tags=["Profiles"])


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "ok"}
