"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-gpx";

// ─────────────────────────────────────────────────────────────────────────────
// Type extension for leaflet-gpx plugin
// ─────────────────────────────────────────────────────────────────────────────
declare module "leaflet" {
  class GPX extends L.FeatureGroup {
    constructor(gpx: string, options?: Record<string, unknown>);
    getBounds(): L.LatLngBounds;
  }
}

interface Coordinate {
  lon: number;
  lat: number;
}

interface MapViewProps {
  onMapClick?: (coord: Coordinate) => void;
  startCoord?: Coordinate | null;
  gpxData?: string | null;
  isClickMode?: boolean;
}

// Fix Leaflet's default marker icon 404 paths in Next.js / Webpack
delete (L.Icon.Default.prototype as any)._getIconUrl;

L.Icon.Default.mergeOptions({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

export default function MapView({
  onMapClick,
  startCoord,
  gpxData,
  isClickMode = false,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const startMarkerRef = useRef<L.Marker | null>(null);
  const gpxLayerRef = useRef<L.GPX | null>(null);

  const onMapClickRef = useRef(onMapClick);
  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  // ── Initialize Map ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [50.633333, 3.066667],
      zoom: 11,
      zoomControl: true,
    });

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    map.on("click", (e: L.LeafletMouseEvent) => {
      onMapClickRef.current?.({ lon: e.latlng.lng, lat: e.latlng.lat });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Handle Cursor Mode ───────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.style.cursor = isClickMode ? "crosshair" : "";
  }, [isClickMode]);

  // ── Render Start Marker ─────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (startMarkerRef.current) {
      map.removeLayer(startMarkerRef.current);
      startMarkerRef.current = null;
    }

    if (!startCoord) return;

    const customIcon = L.divIcon({
      className: "custom-start-pin",
      html: `
        <div style="
          width: 18px;
          height: 18px;
          background: #4f9cf9;
          border: 3px solid white;
          border-radius: 50%;
          box-shadow: 0 0 10px rgba(79, 156, 249, 0.8);
          transform: translate(-50%, -50%);
        "></div>
      `,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });

    const marker = L.marker([startCoord.lat, startCoord.lon], {
      icon: customIcon,
    }).addTo(map);
    startMarkerRef.current = marker;

    if (!gpxData) {
      map.flyTo([startCoord.lat, startCoord.lon], 13, { duration: 0.8 });
    }
  }, [startCoord, gpxData]);

  // ── Render GPX Track ──────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (gpxLayerRef.current) {
      map.removeLayer(gpxLayerRef.current);
      gpxLayerRef.current = null;
    }

    if (!gpxData) return;

    // Blank transparent pixel data-URI to prevent 404 network calls
    const emptyIconUrl = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

    const gpxLayer = new L.GPX(gpxData, {
      async: true,
      marker_options: {
        startIconUrl: emptyIconUrl,
        endIconUrl: emptyIconUrl,
        shadowUrl: emptyIconUrl,
        wptIconUrls: { "": emptyIconUrl },
      },
      polyline_options: {
        color: "#ff0000",
        weight: 5,
        opacity: 0.9,
        lineCap: "round",
        lineJoin: "round",
      },
    });

    gpxLayer.on("loaded", (e: { target: L.GPX }) => {
      const gpx = e.target;
      map.fitBounds(gpx.getBounds(), { padding: [50, 50] });
    });

    gpxLayer.addTo(map);
    gpxLayerRef.current = gpxLayer;
  }, [gpxData]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", position: "relative" }}
    />
  );
}