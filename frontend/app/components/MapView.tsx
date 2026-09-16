"use client";

import { useEffect, useRef, useCallback } from "react";
import type { Map as MaplibreMap, Marker, GeoJSONSource } from "maplibre-gl";

interface Coordinate {
  lon: number;
  lat: number;
}

interface MapViewProps {
  onMapClick?: (coord: Coordinate) => void;
  startCoord?: Coordinate | null;
  gpxBlob?: Blob | null;
  isClickMode?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// GPX → GeoJSON converter (lightweight, no deps)
// ─────────────────────────────────────────────────────────────────────────────
function gpxToGeoJson(gpxText: string): GeoJSON.FeatureCollection {
  const parser = new DOMParser();
  const doc = parser.parseFromString(gpxText, "application/xml");
  const trkpts = doc.querySelectorAll("trkpt");

  const coords: [number, number][] = Array.from(trkpts).map((pt) => [
    parseFloat(pt.getAttribute("lon") || "0"),
    parseFloat(pt.getAttribute("lat") || "0"),
  ]);

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: coords },
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function MapView({
  onMapClick,
  startCoord,
  gpxBlob,
  isClickMode = false,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const isInitialized = useRef(false);

  // ── Initialize map ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    let mapInstance: MaplibreMap | undefined;

    (async () => {
      const maplibre = await import("maplibre-gl");
      await import("maplibre-gl/dist/maplibre-gl.css");
      if (cancelled || !containerRef.current) return; // le composant a été démonté entre-temps

      const map = new maplibre.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            "osm-tiles": {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
              maxzoom: 19,
            },
          },
          layers: [
            {
              id: "osm-tiles",
              type: "raster",
              source: "osm-tiles",
              paint: {
                // Dark tint over OSM tiles to match the dark UI theme
                "raster-brightness-min": 0,
                "raster-brightness-max": 0.55,
                "raster-saturation": -0.4,
                "raster-contrast": 0.1,
              },
            },
          ],
        },
        center: [2.3488, 48.8534],  // Paris, France
        zoom: 11,
      });

      mapInstance = map;
      mapRef.current = map;

      // Map click handler
      map.on("click", (e) => {
        if (onMapClick) {
          onMapClick({ lon: e.lngLat.lng, lat: e.lngLat.lat });
        }
      });

      // Cursor style based on click mode
      map.getCanvas().style.cursor = isClickMode ? "crosshair" : "grab";

      // Route source + layer (filled in when GPX arrives)
      map.on("load", () => {
        map.addSource("route", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });

        // Route glow (thick, blurred-looking line behind the main one)
        map.addLayer({
          id: "route-glow",
          type: "line",
          source: "route",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#4f9cf9",
            "line-width": 8,
            "line-opacity": 0.25,
            "line-blur": 4,
          },
        });

        // Main route line
        map.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#4f9cf9",
            "line-width": 3,
            "line-opacity": 0.9,
          },
        });
      });
    })();

    return () => {
      cancelled = true;
      mapInstance?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Update cursor when click mode changes ────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.getCanvas().style.cursor = isClickMode ? "crosshair" : "grab";
  }, [isClickMode]);

  // ── Update start marker ──────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }

    if (!startCoord) return;

    const addMarker = async () => {
      const maplibre = await import("maplibre-gl");

      const el = document.createElement("div");
      el.className = "start-marker";
      el.innerHTML = `...`; // inchangé

      const marker = new maplibre.Marker({ element: el, anchor: "center" })
        .setLngLat([startCoord.lon, startCoord.lat])
        .addTo(map);

      markerRef.current = marker;
    };

    addMarker();
  }, [startCoord]);

  // ── Render GPX route on map ──────────────────────────────────────────────
  const renderRoute = useCallback(async (blob: Blob) => {
    const map = mapRef.current;
    if (!map || !map.loaded()) return;

    const text = await blob.text();
    const geojson = gpxToGeoJson(text);

    const source = map.getSource("route") as GeoJSONSource | undefined;
    if (source) {
      source.setData(geojson);
    }

    // Fit map to the route bounding box
    const coords = (geojson.features[0]?.geometry as GeoJSON.LineString)?.coordinates;
    if (coords && coords.length > 0) {
      const lons = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      map.fitBounds(
        [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
        { padding: 60, duration: 1000 }
      );
    }
  }, []);

  useEffect(() => {
    if (!gpxBlob) {
      // Clear route
      const map = mapRef.current;
      if (!map || !map.loaded()) return;
      const source = map.getSource("route") as GeoJSONSource | undefined;
      source?.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    renderRoute(gpxBlob);
  }, [gpxBlob, renderRoute]);

  return <div ref={containerRef} style={{ width: "100%", height: "600px" }} />;
}
