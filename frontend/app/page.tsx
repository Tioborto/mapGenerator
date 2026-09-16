"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import dynamic from "next/dynamic";

// MapLibre must be client-side only (uses browser APIs)
const MapView = dynamic(() => import("./components/MapView"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-bg)",
        color: "var(--color-text-muted)",
        fontSize: "14px",
      }}
    >
      Loading map…
    </div>
  ),
});

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ProfileId = "trail_running" | "road_running" | "hiking" | "cycling";
type Mode = "loop" | "point_to_point";

interface Coordinate { lon: number; lat: number; }
interface GeocodingResult { display_name: string; lat: number; lon: number; }

interface RouteStats {
  distanceKm: number;
  elevationGain: number;
  time: string;
}

const PROFILES = [
  { id: "trail_running" as ProfileId, icon: "🏃", name: "Trail Run", color: "#48bb78" },
  { id: "road_running" as ProfileId, icon: "🛣️", name: "Road Run", color: "#4f9cf9" },
  { id: "hiking" as ProfileId, icon: "🥾", name: "Hiking", color: "#f6ad55" },
  { id: "cycling" as ProfileId, icon: "🚴", name: "Cycling", color: "#b794f4" },
];

const DIRECTIONS = [
  { value: "-1", label: "🎲 Random" },
  { value: "0", label: "⬆️ North" },
  { value: "45", label: "↗️ North-East" },
  { value: "90", label: "➡️ East" },
  { value: "135", label: "↘️ South-East" },
  { value: "180", label: "⬇️ South" },
  { value: "225", label: "↙️ South-West" },
  { value: "270", label: "⬅️ West" },
  { value: "315", label: "↖️ North-West" },
];

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export default function Home() {
  // Form state
  const [profile, setProfile] = useState<ProfileId>("trail_running");
  const [mode, setMode] = useState<Mode>("loop");
  const [distanceKm, setDistanceKm] = useState(10);
  const [directionDeg, setDirectionDeg] = useState("-1");
  const [startCoord, setStartCoord] = useState<Coordinate | null>(null);
  const [endCoord, setEndCoord] = useState<Coordinate | null>(null);

  // Address autocomplete
  const [addressQuery, setAddressQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeocodingResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [endAddressQuery, setEndAddressQuery] = useState("");
  const [endSuggestions, setEndSuggestions] = useState<GeocodingResult[]>([]);
  const [showEndSuggestions, setShowEndSuggestions] = useState(false);

  // Route result
  const [gpxBlob, setGpxBlob] = useState<Blob | null>(null);
  const [routeStats, setRouteStats] = useState<RouteStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPickingCoord, setIsPickingCoord] = useState(false);

  const geocodeTimer = useRef<NodeJS.Timeout | null>(null);
  const endGeoTimer = useRef<NodeJS.Timeout | null>(null);

  // ── Geocoding debounce ──────────────────────────────────────────────────
  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 3) { setSuggestions([]); return; }
    try {
      const res = await fetch(`${API_URL}/api/geocoding?q=${encodeURIComponent(q)}&limit=5&lang=fr`);
      const data: GeocodingResult[] = await res.json();
      setSuggestions(data);
      setShowSuggestions(true);
    } catch { setSuggestions([]); }
  }, []);

  const fetchEndSuggestions = useCallback(async (q: string) => {
    if (q.length < 3) { setEndSuggestions([]); return; }
    try {
      const res = await fetch(`${API_URL}/api/geocoding?q=${encodeURIComponent(q)}&limit=5&lang=fr`);
      const data: GeocodingResult[] = await res.json();
      setEndSuggestions(data);
      setShowEndSuggestions(true);
    } catch { setEndSuggestions([]); }
  }, []);

  const handleAddressChange = (val: string) => {
    setAddressQuery(val);
    if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    geocodeTimer.current = setTimeout(() => fetchSuggestions(val), 300);
  };

  const handleEndAddressChange = (val: string) => {
    setEndAddressQuery(val);
    if (endGeoTimer.current) clearTimeout(endGeoTimer.current);
    endGeoTimer.current = setTimeout(() => fetchEndSuggestions(val), 300);
  };

  const selectSuggestion = (s: GeocodingResult) => {
    setStartCoord({ lon: s.lon, lat: s.lat });
    setAddressQuery(s.display_name);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const selectEndSuggestion = (s: GeocodingResult) => {
    setEndCoord({ lon: s.lon, lat: s.lat });
    setEndAddressQuery(s.display_name);
    setEndSuggestions([]);
    setShowEndSuggestions(false);
  };

  // ── Map click (coordinate picking) ─────────────────────────────────────
  const handleMapClick = useCallback((coord: Coordinate) => {
    setStartCoord(coord);
    setAddressQuery(`${coord.lat.toFixed(5)}, ${coord.lon.toFixed(5)}`);
    setIsPickingCoord(false);
  }, []);

  // ── Generate route ──────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!startCoord) {
      setError("Please set a starting point.");
      return;
    }
    if (mode === "point_to_point" && !endCoord) {
      setError("Please set a destination.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setGpxBlob(null);
    setRouteStats(null);

    try {
      const body: Record<string, unknown> = {
        start_lon: startCoord.lon,
        start_lat: startCoord.lat,
        profile,
        mode,
        format: "gpx",
      };

      if (mode === "loop") {
        body.distance_km = distanceKm;
        body.direction_deg = directionDeg === "-1" ? null : parseInt(directionDeg);
        body.seed = 42;
      } else {
        body.end_lon = endCoord!.lon;
        body.end_lat = endCoord!.lat;
      }

      const res = await fetch(`${API_URL}/api/routes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || "Route generation failed");
      }

      const blob = await res.blob();
      setGpxBlob(blob);

      // Parse basic stats from GPX
      const text = await blob.text();
      const stats = parseGpxStats(text);
      setRouteStats(stats);

    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "An unexpected error occurred.");
    } finally {
      setIsLoading(false);
    }
  };

  // ── GPX Download ────────────────────────────────────────────────────────
  const handleDownload = () => {
    if (!gpxBlob) return;
    const url = URL.createObjectURL(gpxBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mapgenerator-${profile}-${mode}.gpx`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const canGenerate = !!startCoord && (mode === "loop" || !!endCoord) && !isLoading;
  const activeProfile = PROFILES.find((p) => p.id === profile)!;

  return (
    <main className="app-layout">
      {/* ── Side Panel ── */}
      <aside className="side-panel">
        {/* Header */}
        <div className="panel-header">
          <div className="panel-logo">
            <div className="panel-logo-icon">🗺️</div>
            <h1>MapGenerator</h1>
          </div>
          <p className="panel-subtitle">GPX route generator · Powered by BRouter &amp; GraphHopper</p>
        </div>

        <div className="panel-body">

          {/* ── Starting Point ── */}
          <section>
            <p className="section-label">Starting Point</p>
            <div className="address-input-wrapper">
              <input
                id="start-address"
                type="text"
                className="address-input"
                placeholder="Search address or click map…"
                value={addressQuery}
                onChange={(e) => handleAddressChange(e.target.value)}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                autoComplete="off"
              />
              <span className="address-search-icon">
                {startCoord ? "📍" : "🔍"}
              </span>

              {showSuggestions && suggestions.length > 0 && (
                <div className="autocomplete-dropdown" role="listbox">
                  {suggestions.map((s, i) => (
                    <div
                      key={i}
                      className="autocomplete-item"
                      role="option"
                      onMouseDown={() => selectSuggestion(s)}
                    >
                      <span className="autocomplete-item-icon">📍</span>
                      <span className="autocomplete-item-text">{s.display_name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => setIsPickingCoord((v) => !v)}
              style={{
                marginTop: 8,
                width: "100%",
                padding: "8px",
                background: isPickingCoord ? "rgba(79,156,249,0.12)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${isPickingCoord ? "rgba(79,156,249,0.4)" : "rgba(255,255,255,0.06)"}`,
                borderRadius: "var(--radius-md)",
                color: isPickingCoord ? "var(--color-accent)" : "var(--color-text-muted)",
                fontFamily: "Outfit, sans-serif",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                transition: "all 0.2s ease",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              {isPickingCoord ? "🎯 Click on the map to place the start" : "🖱️ Pick on map"}
            </button>
          </section>

          <div className="divider" />

          {/* ── Activity Profile ── */}
          <section>
            <p className="section-label">Activity</p>
            <div className="profile-grid">
              {PROFILES.map((p) => (
                <button
                  key={p.id}
                  id={`profile-${p.id}`}
                  className={`profile-card ${profile === p.id ? "active" : ""}`}
                  style={{ ["--profile-color" as string]: p.color }}
                  onClick={() => setProfile(p.id)}
                >
                  <span className="profile-icon">{p.icon}</span>
                  <span className="profile-name">{p.name}</span>
                </button>
              ))}
            </div>
          </section>

          <div className="divider" />

          {/* ── Route Mode ── */}
          <section>
            <p className="section-label">Route Type</p>
            <div className="mode-toggle" role="group" aria-label="Route type">
              <button
                id="mode-loop"
                className={`mode-btn ${mode === "loop" ? "active" : ""}`}
                onClick={() => setMode("loop")}
              >
                🔄 Loop
              </button>
              <button
                id="mode-point-to-point"
                className={`mode-btn ${mode === "point_to_point" ? "active" : ""}`}
                onClick={() => setMode("point_to_point")}
              >
                ➡️ A → B
              </button>
            </div>
          </section>

          {/* ── Loop Settings ── */}
          {mode === "loop" && (
            <section className="input-group">
              {/* Distance */}
              <div className="input-row">
                <label className="input-label" htmlFor="distance-slider">
                  Distance
                  <span className="input-value">{distanceKm} km</span>
                </label>
                <input
                  id="distance-slider"
                  type="range"
                  className="range-slider"
                  min={1}
                  max={100}
                  step={1}
                  value={distanceKm}
                  onChange={(e) => setDistanceKm(Number(e.target.value))}
                />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                  <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>1 km</span>
                  <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>100 km</span>
                </div>
              </div>

              {/* Direction */}
              <div className="input-row">
                <label className="input-label" htmlFor="direction-select">
                  Initial Direction
                </label>
                <select
                  id="direction-select"
                  className="direction-select"
                  value={directionDeg}
                  onChange={(e) => setDirectionDeg(e.target.value)}
                >
                  {DIRECTIONS.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
            </section>
          )}

          {/* ── A-to-B Settings ── */}
          {mode === "point_to_point" && (
            <section>
              <p className="section-label">Destination</p>
              <div className="address-input-wrapper">
                <input
                  id="end-address"
                  type="text"
                  className="endpoint-input"
                  placeholder="Search destination…"
                  value={endAddressQuery}
                  onChange={(e) => handleEndAddressChange(e.target.value)}
                  onFocus={() => endSuggestions.length > 0 && setShowEndSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowEndSuggestions(false), 150)}
                  autoComplete="off"
                />
                <span className="address-search-icon">
                  {endCoord ? "🏁" : "🔍"}
                </span>
                {showEndSuggestions && endSuggestions.length > 0 && (
                  <div className="autocomplete-dropdown" role="listbox">
                    {endSuggestions.map((s, i) => (
                      <div
                        key={i}
                        className="autocomplete-item"
                        role="option"
                        onMouseDown={() => selectEndSuggestion(s)}
                      >
                        <span className="autocomplete-item-icon">🏁</span>
                        <span className="autocomplete-item-text">{s.display_name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          <div className="divider" />

          {/* ── Error ── */}
          {error && (
            <div className="error-banner" role="alert">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {/* ── Generate Button ── */}
          <button
            id="generate-route-btn"
            className={`generate-btn ${isLoading ? "loading" : ""}`}
            onClick={handleGenerate}
            disabled={!canGenerate}
          >
            {isLoading ? (
              <>
                <div className="spinner" />
                Calculating route…
              </>
            ) : (
              <>
                {activeProfile.icon} Generate GPX
              </>
            )}
          </button>

          {/* ── Route Stats ── */}
          {routeStats && (
            <div className="route-stats">
              <p className="section-label" style={{ marginBottom: 10 }}>Route Summary</p>
              <div className="route-stats-grid">
                <div className="stat-item">
                  <span className="stat-value">{routeStats.distanceKm.toFixed(1)}</span>
                  <span className="stat-label">km</span>
                </div>
                <div className="stat-item">
                  <span className="stat-value">{routeStats.elevationGain}</span>
                  <span className="stat-label">m gain</span>
                </div>
                <div className="stat-item">
                  <span className="stat-value">{routeStats.time}</span>
                  <span className="stat-label">est. time</span>
                </div>
              </div>
            </div>
          )}

          {/* ── Download ── */}
          {gpxBlob && (
            <button id="download-gpx-btn" className="download-btn" onClick={handleDownload}>
              ⬇️ Download GPX
            </button>
          )}
        </div>
      </aside>

      {/* ── Map ── */}
      <div className="map-container">
        <MapView
          onMapClick={isPickingCoord ? handleMapClick : undefined}
          startCoord={startCoord}
          gpxBlob={gpxBlob}
          isClickMode={isPickingCoord}
        />

        {/* Map hint overlay */}
        {!startCoord && !isPickingCoord && (
          <div className="map-hint">
            🗺️ Search an address or click <strong style={{ color: "var(--color-accent)", marginLeft: 4 }}>Pick on map</strong>
          </div>
        )}

        {isPickingCoord && (
          <div className="map-hint" style={{ borderColor: "rgba(79,156,249,0.3)", color: "var(--color-accent)" }}>
            🎯 Click anywhere on the map to set your start point
          </div>
        )}
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GPX stats parser
// ─────────────────────────────────────────────────────────────────────────────

function parseGpxStats(gpxText: string): RouteStats {
  const parser = new DOMParser();
  const doc = parser.parseFromString(gpxText, "application/xml");
  const trkpts = doc.querySelectorAll("trkpt");

  let totalDist = 0;
  let elevGain = 0;
  let prevLat: number | null = null;
  let prevLon: number | null = null;
  let prevEle: number | null = null;

  trkpts.forEach((pt) => {
    const lat = parseFloat(pt.getAttribute("lat") || "0");
    const lon = parseFloat(pt.getAttribute("lon") || "0");
    const ele = parseFloat(pt.querySelector("ele")?.textContent || "0");

    if (prevLat !== null && prevLon !== null) {
      totalDist += haversineKm(prevLat, prevLon, lat, lon);
    }
    if (prevEle !== null && ele > prevEle) {
      elevGain += ele - prevEle;
    }

    prevLat = lat; prevLon = lon; prevEle = ele;
  });

  // Rough time estimate (minutes per km by activity — simplified)
  const minsPerKm = 8; // conservative default
  const totalMins = Math.round(totalDist * minsPerKm);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  const time = h > 0 ? `${h}h${m.toString().padStart(2, "0")}` : `${m}min`;

  return {
    distanceKm: Math.round(totalDist * 10) / 10,
    elevationGain: Math.round(elevGain),
    time,
  };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dL = ((lat2 - lat1) * Math.PI) / 180;
  const dN = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dL / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dN / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
