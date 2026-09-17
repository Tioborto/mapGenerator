"""
Profiles router — returns the list of available activity profiles.
"""

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class Profile(BaseModel):
    id: str
    label: str
    description: str
    engine: str            # "brouter" | "graphhopper" | "both"
    icon: str              # emoji for quick UI rendering


PROFILES: list[Profile] = [
    Profile(
        id="trail_running",
        label="Trail Running",
        description="Natural trails, dirt paths, forest tracks. Penalizes asphalt and roads.",
        engine="both",
        icon="🏃",
    ),
    Profile(
        id="road_running",
        label="Road Running",
        description="Smooth paved roads, sidewalks, quiet residential streets.",
        engine="both",
        icon="🛣️",
    ),
    Profile(
        id="hiking",
        label="Hiking",
        description="Marked hiking trails and natural paths. SAC scale aware.",
        engine="both",
        icon="🥾",
    ),
    Profile(
        id="cycling",
        label="Road Cycling",
        description="Cycle lanes, paved roads. Minimizes climbs and avoids gravel.",
        engine="both",
        icon="🚴",
    ),
]

# Map profile ID → BRouter .brf filename (without extension)
BROUTER_PROFILE_MAP = {
    "road_running": "road-running",
    "trail_running": "trail-running",
    "hiking": "hiking",
    "cycling": "cycling",
}

# Map profile ID → GraphHopper profile name (as defined in config.yml)
GRAPHHOPPER_PROFILE_MAP: dict[str, str] = {
    "trail_running": "trail_running",
    "road_running":  "road_running",
    "hiking":        "hiking",
    "cycling":       "cycling",
}


@router.get("/profiles", response_model=list[Profile])
async def list_profiles():
    """List all available activity profiles."""
    return PROFILES
