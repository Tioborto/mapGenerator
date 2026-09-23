"""
Elevation router — proxies open-meteo elevation API with in-memory cache
and exponential-backoff retry on 429 / transient errors.

Cache key: round(lat, 2) × round(lon, 2)  ≈ 1.1 km grid.
A coarser grid means far more cache hits for routes that share nearby points.
"""

import asyncio
import logging

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter()
log = logging.getLogger(__name__)

OPEN_METEO_URL = "https://api.open-meteo.com/v1/elevation"
BATCH_SIZE     = 100   # open-meteo hard limit per request
MAX_RETRIES    = 3
RETRY_DELAYS   = [1.0, 2.0, 4.0]  # seconds between attempts


# ─────────────────────────────────────────────────────────────────────────────
# In-memory cache  (~1.1 km grid precision)
# ─────────────────────────────────────────────────────────────────────────────

_cache: dict[tuple[float, float], float] = {}


def _cache_key(lat: float, lon: float) -> tuple[float, float]:
    return (round(lat, 2), round(lon, 2))


# ─────────────────────────────────────────────────────────────────────────────
# Request schema
# ─────────────────────────────────────────────────────────────────────────────

class ElevationRequest(BaseModel):
    latitudes:  list[float]
    longitudes: list[float]


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

async def _fetch_batch(
    client: httpx.AsyncClient,
    lats: list[float],
    lons: list[float],
) -> list[float]:
    """Fetch one batch from open-meteo with retry on 429 / connection errors."""
    params = {
        "latitude":  ",".join(str(x) for x in lats),
        "longitude": ",".join(str(x) for x in lons),
    }

    for attempt in range(MAX_RETRIES):
        try:
            resp = await client.get(OPEN_METEO_URL, params=params, timeout=15.0)

            if resp.status_code == 429:
                wait = RETRY_DELAYS[min(attempt, len(RETRY_DELAYS) - 1)]
                log.warning("open-meteo 429 — retrying in %.1fs (attempt %d/%d)", wait, attempt + 1, MAX_RETRIES)
                await asyncio.sleep(wait)
                continue

            resp.raise_for_status()
            return resp.json().get("elevation", [])

        except httpx.HTTPStatusError as e:
            log.error("open-meteo HTTP error %s: %s", e.response.status_code, e.response.text[:200])
            if attempt < MAX_RETRIES - 1:
                await asyncio.sleep(RETRY_DELAYS[attempt])
                continue
            raise HTTPException(
                status_code=502,
                detail=f"Upstream elevation API error {e.response.status_code}",
            )
        except Exception as e:
            log.error("open-meteo fetch failed: %s", e)
            if attempt < MAX_RETRIES - 1:
                await asyncio.sleep(RETRY_DELAYS[attempt])
                continue
            raise HTTPException(status_code=502, detail=f"Elevation fetch failed: {e}")

    raise HTTPException(status_code=502, detail="Elevation API unavailable after retries")


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/elevation")
async def get_elevation(body: ElevationRequest, request: Request):
    """
    Returns elevation (m) for each (lat, lon) pair.
    Cached per ~1.1 km grid; retries open-meteo on 429 with backoff.
    """
    if len(body.latitudes) != len(body.longitudes):
        raise HTTPException(400, "latitudes and longitudes must have the same length")

    client: httpx.AsyncClient = request.app.state.http_client
    n = len(body.latitudes)
    elevations: list[float | None] = [None] * n

    # Resolve cache hits
    miss_indices: list[int]   = []
    miss_lats:    list[float] = []
    miss_lons:    list[float] = []

    for i, (lat, lon) in enumerate(zip(body.latitudes, body.longitudes)):
        key = _cache_key(lat, lon)
        if key in _cache:
            elevations[i] = _cache[key]
        else:
            miss_indices.append(i)
            miss_lats.append(lat)
            miss_lons.append(lon)

    log.info("elevation: %d total, %d cache hits, %d misses", n, n - len(miss_indices), len(miss_indices))

    # Fetch misses in batches
    for batch_start in range(0, len(miss_indices), BATCH_SIZE):
        batch_idx  = miss_indices[batch_start : batch_start + BATCH_SIZE]
        batch_lats = miss_lats[batch_start : batch_start + BATCH_SIZE]
        batch_lons = miss_lons[batch_start : batch_start + BATCH_SIZE]

        data = await _fetch_batch(client, batch_lats, batch_lons)

        for local_i, (orig_i, lat, lon) in enumerate(
            zip(batch_idx, batch_lats, batch_lons)
        ):
            ele = float(data[local_i]) if local_i < len(data) else 0.0
            elevations[orig_i] = ele
            _cache[_cache_key(lat, lon)] = ele

    return {"elevation": [e if e is not None else 0.0 for e in elevations]}

