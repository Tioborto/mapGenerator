# MapGenerator

A self-hosted, AI-callable web application that generates GPX routes from a coordinate and user preferences. It uses a combination of **GraphHopper** (for round-trip/loop route generation) and **BRouter** (for precise trail/road quality routing).

## Features
- **Profiles**: Trail Running, Road Running, Hiking, Road Cycling.
- **Routing**: A-to-B routing or Loop (round-trip) generation with specified distance and direction.
- **Self-hosted**: Entirely offline capable after downloading OSM map data.
- **Geocoding**: Powered by a self-hosted Photon instance (OSM-based).
- **Beautiful UI**: Modern glassmorphism UI with interactive MapLibre map.

## Architecture
- **Frontend**: Next.js 15 (App Router), MapLibre GL JS
- **Backend API**: FastAPI (Python)
- **Routing Engines**: 
  - BRouter (Port 17777): Built from source, uses `.brf` profiles.
  - GraphHopper (Port 8989): Uses native `round_trip` algorithm.
- **Geocoding**: Photon (Port 2322)
- **Reverse Proxy**: Nginx (Port 80)

## Getting Started

### 1. Download Map Data
The routing engines require OpenStreetMap data for your region. We have provided a script to download the data for **France** (BRouter `.rd5` segments + GraphHopper `.osm.pbf`).

```bash
chmod +x scripts/download-france-data.sh
./scripts/download-france-data.sh
```
*Note: This will download several GB of data. The GraphHopper PBF file is ~4GB.*

### 2. Start the Stack
Use Docker Compose to build and start all services:

```bash
docker-compose up --build
```

*Note: On the very first run, GraphHopper will take 5–15 minutes to process the France PBF file into its internal routing graph. BRouter builds from source which also takes a couple of minutes.*

### 3. Access the App
Once all services are healthy, the web UI is available at:
**http://localhost**

## API Endpoints (for AI/LLM integration)
The FastAPI backend exposes endpoints that an AI agent can call:
- `GET /api/profiles`: List available routing profiles.
- `GET /api/geocoding?q={address}`: Geocode an address.
- `POST /api/routes`: Generate a GPX route.

Example Payload for a Loop Route:
```json
{
  "start_lon": 2.3488,
  "start_lat": 48.8534,
  "profile": "trail_running",
  "mode": "loop",
  "distance_km": 15,
  "format": "gpx"
}
```
# mapGenerator
