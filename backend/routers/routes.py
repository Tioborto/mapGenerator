"""
Routes router — main GPX generation endpoint.

Routing strategy:
  - Loop mode  → GraphHopper (native round_trip algorithm) → returns GPX
  - A-to-B mode → BRouter (best trail quality via .brf profiles) → returns GPX

Hybrid loop (optional, best quality):
  GraphHopper generates the loop skeleton → waypoints extracted →
  BRouter re-routes between waypoints with the activity profile.
"""

import os
from enum import Enum
from typing import Literal

import httpx
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator

from routers.profiles import BROUTER_PROFILE_MAP, GRAPHHOPPER_PROFILE_MAP

router = APIRouter()

BROUTER_URL      = os.getenv("BROUTER_URL",      "http://localhost:17777")
GRAPHHOPPER_URL  = os.getenv("GRAPHHOPPER_URL",  "http://localhost:8989")


# ─────────────────────────────────────────────────────────────────────────────
# Request / Response schemas
# ─────────────────────────────────────────────────────────────────────────────

class RouteMode(str, Enum):
    loop         = "loop"
    point_to_point = "point_to_point"


class RouteRequest(BaseModel):
    # Starting point: either [lon, lat] array or address string (pre-geocoded)
    start_lon: float = Field(..., description="Start longitude (WGS84)", ge=-180, le=180)
    start_lat: float = Field(..., description="Start latitude (WGS84)",  ge=-90,  le=90)

    profile: str = Field(
        ...,
        description="Activity profile ID: trail_running | road_running | hiking | cycling",
    )
    mode: RouteMode = Field(RouteMode.loop, description="Route mode: loop or point_to_point")

    # Loop settings
    distance_km: float | None = Field(
        None, gt=0, le=500,
        description="Target loop distance in km (required for loop mode)",
    )
    direction_deg: int | None = Field(
        None, ge=0, le=360,
        description="Initial heading in degrees (0=North, 90=East). Omit for random.",
    )
    seed: int | None = Field(
        42, description="Reproducibility seed for loop generation (GraphHopper)"
    )

    # Point-to-point settings
    end_lon: float | None = Field(None, description="End longitude (required for point_to_point)", ge=-180, le=180)
    end_lat: float | None = Field(None, description="End latitude (required for point_to_point)",  ge=-90,  le=90)

    # Output format
    format: Literal["gpx", "geojson"] = Field("gpx", description="Output format")

    @field_validator("profile")
    @classmethod
    def validate_profile(cls, v: str) -> str:
        valid = list(BROUTER_PROFILE_MAP.keys())
        if v not in valid:
            raise ValueError(f"Unknown profile '{v}'. Valid: {valid}")
        return v

    @field_validator("distance_km")
    @classmethod
    def validate_distance_for_loop(cls, v, info):
        # Validation is done at endpoint level since we need mode context
        return v


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/routes")
async def generate_route(body: RouteRequest, request: Request):
    """
    Generate a GPX route file based on activity profile and route settings.

    - **loop** mode: uses GraphHopper's native round_trip algorithm.
    - **point_to_point** mode: uses BRouter with the selected .brf profile.
    """
    client: httpx.AsyncClient = request.app.state.http_client

    if body.mode == RouteMode.loop:
        if not body.distance_km:
            raise HTTPException(400, detail="distance_km is required for loop mode")
        gpx_data = await _generate_loop(client, body)
    else:
        if body.end_lon is None or body.end_lat is None:
            raise HTTPException(400, detail="end_lon and end_lat are required for point_to_point mode")
        gpx_data = await _generate_point_to_point(client, body)

    if body.format == "gpx":
        return Response(
            content=gpx_data,
            media_type="application/gpx+xml",
            headers={"Content-Disposition": 'attachment; filename="route.gpx"'},
        )
    else:
        return Response(content=gpx_data, media_type="application/json")


# ─────────────────────────────────────────────────────────────────────────────
# Loop routing via GraphHopper
# ─────────────────────────────────────────────────────────────────────────────

async def _generate_loop(client: httpx.AsyncClient, body: RouteRequest) -> bytes:
    """Call GraphHopper with algorithm=round_trip to generate a loop route."""
    gh_profile = GRAPHHOPPER_PROFILE_MAP.get(body.profile)
    if not gh_profile:
        raise HTTPException(400, detail=f"Profile '{body.profile}' not supported for loop routing")

    payload: dict = {
        "points":               [[body.start_lon, body.start_lat]],
        "algorithm":            "round_trip",
        "round_trip.distance":  int(body.distance_km * 1000),  # GH expects meters
        "round_trip.seed":      body.seed or 42,
        "ch.disable":           True,   # Required for round_trip algorithm
        "profile":              "gravel",
        "points_encoded":       False,
        "locale":               "fr",
    }

    if body.direction_deg is not None:
        payload["headings"]          = [body.direction_deg]
        payload["heading_penalty"]   = 120
        payload["pass_through"]      = False

    # GraphHopper GPX export
    if body.format == "gpx":
        payload["type"] = "gpx"

    try:
        resp = await client.post(
            f"{GRAPHHOPPER_URL}/route",
            json=payload,
            headers={"Content-Type": "application/json"},
        )
        resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        detail = f"GraphHopper error: {e.response.text}"
        raise HTTPException(status_code=502, detail=detail)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"GraphHopper unavailable: {e}")

    print(resp.json())

    return resp.content


# ─────────────────────────────────────────────────────────────────────────────
# A-to-B routing via BRouter
# ─────────────────────────────────────────────────────────────────────────────

async def _generate_point_to_point(client: httpx.AsyncClient, body: RouteRequest) -> bytes:
    """Call BRouter to generate an A-to-B route with the selected .brf profile."""
    brf_profile = BROUTER_PROFILE_MAP.get(body.profile)
    if not brf_profile:
        raise HTTPException(400, detail=f"Profile '{body.profile}' not supported for A-to-B routing")

    lonlats = f"{body.start_lon},{body.start_lat}|{body.end_lon},{body.end_lat}"
    fmt = "gpx" if body.format == "gpx" else "geojson"

    params = {
        "lonlats":        lonlats,
        "profile":        "gravel",
        "alternativeidx": 0,
        "format":         fmt,
    }

    try:
        resp = await client.get(f"{BROUTER_URL}/brouter", params=params)
        resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        detail = f"BRouter error: {e.response.text}"
        raise HTTPException(status_code=502, detail=detail)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"BRouter unavailable: {e}")

    return resp.content
