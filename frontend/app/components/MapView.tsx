"use client";

import { useEffect, useRef, useCallback } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

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
// GPX → GeoJSON converter
// ─────────────────────────────────────────────────────────────────────────────
function gpxToGeoJson(gpxText: string): GeoJSON.FeatureCollection {
  const parser = new DOMParser();
  const doc = parser.parseFromString(gpxText, "application/xml");

  const allElements = Array.from(doc.getElementsByTagName("*"));
  const points = allElements.filter((el) => {
    const tag = el.localName.toLowerCase();
    return tag === "trkpt" || tag === "rtept" || tag === "wpt";
  });

  const coords: [number, number][] = points
    .map((pt): [number, number] | null => {
      const latStr = pt.getAttribute("lat");
      const lonStr = pt.getAttribute("lon");

      if (!latStr || !lonStr) return null;

      const lat = parseFloat(latStr);
      const lon = parseFloat(lonStr);

      if (isNaN(lat) || isNaN(lon)) return null;

      return [lon, lat];
    })
    .filter((c): c is [number, number] => c !== null);

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: coords,
        },
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
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const isLoadedRef = useRef(false);

  const onMapClickRef = useRef(onMapClick);
  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  // ── Initialize Map ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          "osm-tiles": {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
            maxzoom: 19,
          },
        },
        layers: [
          {
            id: "osm-tiles",
            type: "raster",
            source: "osm-tiles",
          },
        ],
      },
      center: [3.066667, 50.633333], // Lille
      zoom: 11,
    });

    mapRef.current = map;

    map.on("load", () => {
      isLoadedRef.current = true;
      map.resize();
    });

    map.on("click", (e) => {
      onMapClickRef.current?.({ lon: e.lngLat.lng, lat: e.lngLat.lat });
    });

    return () => {
      isLoadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Update cursor mode ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.getCanvas().style.cursor = isClickMode ? "crosshair" : "grab";
  }, [isClickMode]);

  // ── Render GPX route ───────────────────────────────────────────────────────
  const renderRoute = useCallback(async (blob: Blob) => {
    const map = mapRef.current;
    if (!map) return;

    const text = await blob.text();
    const geojson = gpxToGeoJson(text);

    const applyData = () => {
      if (!mapRef.current || !isLoadedRef.current) return false;

      let source = map.getSource("route") as maplibregl.GeoJSONSource | undefined;

      if (!source) {
        map.addSource("route", {
          type: "geojson",
          data: geojson,
        });

        // Glowing backdrop
        map.addLayer({
          id: "route-glow",
          type: "line",
          source: "route",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#ff0000",
            "line-width": 10,
            "line-opacity": 0.3,
          },
        });

        // Main line (thick bright red to eliminate visibility issues)
        map.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#ff0000",
            "line-width": 6,
            "line-opacity": 1,
          },
        });
      } else {
        source.setData(geojson);
      }

      // Re-framing logic
      const coords = (geojson.features[0]?.geometry as GeoJSON.LineString)?.coordinates;
      if (coords && coords.length > 0) {
        let minLon = Infinity, maxLon = -Infinity;
        let minLat = Infinity, maxLat = -Infinity;

        for (const [lon, lat] of coords) {
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }

        map.resize();
        map.fitBounds(
          [[minLon, minLat], [maxLon, maxLat]],
          { padding: 80, duration: 800 }
        );
      }
      return true;
    };

    if (!applyData()) {
      const interval = setInterval(() => {
        if (applyData()) clearInterval(interval);
      }, 50);
      setTimeout(() => clearInterval(interval), 3000);
    }
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!gpxBlob) {
      if (!map || !isLoadedRef.current) return;
      const source = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
      source?.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    renderRoute(gpxBlob);
  }, [gpxBlob, renderRoute]);

  // ── Update start marker ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }

    if (!startCoord) return;

    const el = document.createElement("div");
    el.className = "start-marker";
    el.innerHTML = `
      <div style="
        width: 20px; height: 20px;
        background: #4f9cf9;
        border: 3px solid white;
        border-radius: 50%;
        box-shadow: 0 0 12px rgba(79,156,249,0.6), 0 2px 8px rgba(0,0,0,0.4);
      "></div>
    `;

    const marker = new maplibregl.Marker({ element: el, anchor: "center" })
      .setLngLat([startCoord.lon, startCoord.lat])
      .addTo(map);

    markerRef.current = marker;

    map.flyTo({
      center: [startCoord.lon, startCoord.lat],
      zoom: Math.max(map.getZoom(), 13),
      duration: 1000,
    });
  }, [startCoord]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", minHeight: "500px", position: "relative" }}
    />
  );
}