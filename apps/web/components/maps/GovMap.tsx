"use client";

import { useEffect, useRef } from "react";

const RISK_COLORS: Record<string, string> = {
  low: "#22c55e",
  medium: "#f59e0b",
  high: "#ef4444",
  critical: "#7c3aed",
};

interface District {
  id: string;
  name: string;
  risk: "low" | "medium" | "high" | "critical";
  farmersAtRisk: number;
  floodProb24h: number;
}

interface GovMapProps {
  districts: District[];
  onDistrictClick: (id: string) => void;
  selectedDistrict: string | null;
}

export default function GovMap({ districts, onDistrictClick, selectedDistrict }: GovMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);

  useEffect(() => {
    async function initMap() {
      if (!mapRef.current || mapInstanceRef.current) return;

      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");

      const map = L.map(mapRef.current, {
        center: [23.5, 90.0],
        zoom: 7,
        zoomControl: false,
        attributionControl: true,
      });

      // Dark OSM tiles for gov portal
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18,
        opacity: 0.6,
      }).addTo(map);

      // Overlay for dark effect
      // District markers with risk coloring
      const DISTRICT_COORDS: Record<string, [number, number]> = {
        barisal: [22.7011, 90.3637],
        khulna: [22.8456, 89.5403],
        sylhet: [24.8949, 91.8687],
        rajshahi: [24.3636, 88.6241],
        dhaka: [23.8103, 90.4125],
      };

      districts.forEach((d) => {
        const coords = DISTRICT_COORDS[d.id];
        if (!coords) return;

        const color = RISK_COLORS[d.risk];
        const radius = 8000 + d.farmersAtRisk * 0.5;

        // Risk circle
        L.circle(coords, {
          radius,
          color,
          fillColor: color,
          fillOpacity: 0.2,
          weight: 2,
          dashArray: d.risk === "critical" ? undefined : "6 4",
        })
          .addTo(map)
          .on("click", () => onDistrictClick(d.id))
          .bindTooltip(`
            <div style="font-family: Inter; font-size: 12px; color: white;">
              <strong>${d.name}</strong><br>
              Risk: <span style="color: ${color}; font-weight: bold; text-transform: uppercase;">${d.risk}</span><br>
              Flood 24h: ${d.floodProb24h}%<br>
              Farmers at risk: ${d.farmersAtRisk.toLocaleString()}
            </div>
          `, {
            className: "custom-tooltip",
            permanent: false,
            direction: "top",
          });

        // Marker
        const icon = L.divIcon({
          html: `<div style="
            padding: 4px 8px;
            border-radius: 8px;
            border: 2px solid ${color};
            background: rgba(0,0,0,0.85);
            color: white;
            font-size: 11px;
            font-weight: 700;
            font-family: Inter, sans-serif;
            white-space: nowrap;
            backdrop-filter: blur(8px);
            box-shadow: 0 0 12px ${color}60;
          ">
            <span style="color: ${color}; margin-right: 4px;">●</span>
            ${d.name}
          </div>`,
          className: "",
          iconSize: [80, 24],
          iconAnchor: [40, 12],
        });

        L.marker(coords, { icon })
          .addTo(map)
          .on("click", () => onDistrictClick(d.id));
      });

      // Zoom controls
      L.control.zoom({ position: "topleft" }).addTo(map);

      mapInstanceRef.current = map;
    }

    initMap();

    return () => {
      if (mapInstanceRef.current) {
        (mapInstanceRef.current as { remove: () => void }).remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div ref={mapRef} className="w-full h-full" style={{ minHeight: 400 }} />
  );
}
