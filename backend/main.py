"""
MapGenerator Backend — FastAPI Application
Orchestrates BRouter (A-to-B routing) and GraphHopper (loop routing)
to generate GPX files from user settings.
"""

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

from routers import routes, geocoding, profiles


# ─────────────────────────────────────────────────────────────────────────────
# Shared async HTTP client (reused across all requests)
# ─────────────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http_client = httpx.AsyncClient(timeout=60.0)
    yield
    await app.state.http_client.aclose()

# Initialize OpenTelemetry
trace.set_tracer_provider(TracerProvider())
tracer = trace.get_tracer(__name__)

# Set up OTLP exporter
otlp_exporter = OTLPSpanExporter(endpoint="http://otel-collector:4317")
span_processor = BatchSpanProcessor(otlp_exporter)
trace.get_tracer_provider().add_span_processor(span_processor)

# ─────────────────────────────────────────────────────────────────────────────
# App
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="MapGenerator API",
    description="Generate GPX routes from coordinates and activity profiles using BRouter and GraphHopper.",
    version="1.0.0",
    lifespan=lifespan,
)

FastAPIInstrumentor.instrument_app(app, excluded_urls="health")

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
