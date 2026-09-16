"""
Geocoding router — converts an address string to lat/lon coordinates
using the self-hosted Photon geocoder (OpenStreetMap-based).
"""

import os
from fastapi import APIRouter, Request, HTTPException, Query
from pydantic import BaseModel

router = APIRouter()

PHOTON_URL = os.getenv("PHOTON_URL", "http://localhost:2322")


class GeocodingResult(BaseModel):
    display_name: str
    lat: float
    lon: float
    type: str | None = None
    country: str | None = None
    city: str | None = None


@router.get("/geocoding", response_model=list[GeocodingResult])
async def geocode(
    request: Request,
    q: str = Query(..., description="Address or place name to geocode"),
    limit: int = Query(5, ge=1, le=10, description="Maximum number of results"),
    lang: str = Query("fr", description="Language for results (ISO 639-1)"),
):
    """
    Convert an address or place name to geographic coordinates.
    Uses the self-hosted Photon geocoder powered by OpenStreetMap data.
    """
    client = request.app.state.http_client

    try:
        resp = await client.get(
            f"{PHOTON_URL}/api",
            params={"q": q, "limit": limit, "lang": lang},
            headers={"User-Agent": "MapGenerator/1.0 (contact@mapgenerator.com)"},
        )
        resp.raise_for_status()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Geocoding service unavailable: {e}")

    data = resp.json()
    features = data.get("features", [])

    if not features:
        return []

    results = []
    for feat in features:
        props = feat.get("properties", {})
        coords = feat.get("geometry", {}).get("coordinates", [None, None])
        lon, lat = coords[0], coords[1]

        if lat is None or lon is None:
            continue

        # Build a human-readable display name from Photon's property fields
        parts = [
            props.get("name"),
            props.get("street"),
            props.get("postcode"),
            props.get("city"),
            props.get("country"),
        ]
        display = ", ".join(p for p in parts if p)

        results.append(
            GeocodingResult(
                display_name=display or "Unknown location",
                lat=lat,
                lon=lon,
                type=props.get("type"),
                country=props.get("country"),
                city=props.get("city"),
            )
        )

    return results
