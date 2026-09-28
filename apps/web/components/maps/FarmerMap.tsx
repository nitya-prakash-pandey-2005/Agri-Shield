"use client";

import { useEffect, useRef, useState } from "react";
import { Layers, Minus, Plus, Locate, Info, Clock } from "lucide-react";

// Leaflet-based map component for farmer dashboard
// Falls back to OpenStreetMap tiles — no Mapbox key required
export default function FarmerMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const [activeLayer, setActiveLayer] = useState<string>("flood-risk");
  const [mapInstance, setMapInstance] = useState<unknown>(null);
  const [showLegend, setShowLegend] = useState(true);
  const [sliderDay, setSliderDay] = useState(0);

  useEffect(() => {
    let map: unknown;
    async function initMap() {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");

      if (!mapRef.current || mapInstance) return;

      // Center on Bangladesh (Barisal demo farm)
      map = L.map(mapRef.current, {
        center: [22.7011, 90.3637],
        zoom: 11,
        zoomControl: false,
        attributionControl: true,
      });

      // Base tile layer — OSM (free, no key)
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map as ReturnType<typeof L.map>);

      // Demo farm field polygon (North Paddy Field)
      const fieldPolygon = L.polygon(
        [
          [22.710, 90.355],
          [22.720, 90.360],
          [22.718, 90.375],
          [22.708, 90.372],
          [22.705, 90.360],
        ],
        {
          color: "#22c55e",
          fillColor: "#22c55e",
          fillOpacity: 0.2,
          weight: 2,
          dashArray: "6 4",
        }
      ).addTo(map as ReturnType<typeof L.map>);

      fieldPolygon.bindPopup(`
        <div style="font-family: Inter, sans-serif; padding: 4px;">
          <div style="font-weight: 700; font-size: 14px; color: #22c55e; margin-bottom: 4px;">🌾 North Paddy Field</div>
          <div style="color: #9ca3af; font-size: 12px;">Rice · 2.1 ha</div>
          <div style="margin-top: 8px; font-size: 12px;">
            <span style="color: #ef4444;">⚠ Flood Risk: 72%</span><br/>
            <span style="color: #f59e0b;">🧂 Salinity: 3.4 dS/m</span><br/>
            <span style="color: #22c55e;">🌿 NDVI: 0.68 (Healthy)</span>
          </div>
        </div>
      `);

      // Second field
      L.polygon(
        [
          [22.695, 90.380],
          [22.703, 90.385],
          [22.700, 90.395],
          [22.692, 90.390],
        ],
        {
          color: "#f59e0b",
          fillColor: "#f59e0b",
          fillOpacity: 0.15,
          weight: 2,
        }
      )
        .addTo(map as ReturnType<typeof L.map>)
        .bindPopup(`
          <div style="font-family: Inter, sans-serif; padding: 4px;">
            <div style="font-weight: 700; font-size: 14px; color: #f59e0b; margin-bottom: 4px;">🪢 South Jute Plot</div>
            <div style="color: #9ca3af; font-size: 12px;">Jute · 1.4 ha</div>
            <div style="margin-top: 8px; font-size: 12px;">
              <span style="color: #f59e0b;">⚠ Flood Risk: 55%</span><br/>
              <span style="color: #f59e0b;">🧂 Salinity: 4.0 dS/m</span><br/>
              <span style="color: #22c55e;">🌿 NDVI: 0.71 (Good)</span>
            </div>
          </div>
        `);

      // Flood risk heatmap (simulated circles)
      const floodZones = [
        { lat: 22.712, lon: 90.362, radius: 1200, risk: 0.72, color: "#ef4444" },
        { lat: 22.695, lon: 90.355, radius: 800, risk: 0.55, color: "#f59e0b" },
        { lat: 22.730, lon: 90.380, radius: 600, risk: 0.30, color: "#22c55e" },
      ];

      floodZones.forEach(({ lat, lon, radius, risk, color }) => {
        L.circle([lat, lon], {
          radius,
          color,
          fillColor: color,
          fillOpacity: 0.15,
          weight: 1,
          dashArray: "4 4",
        })
          .addTo(map as ReturnType<typeof L.map>)
          .bindPopup(`Flood risk: <strong>${Math.round(risk * 100)}%</strong>`);
      });

      // Farm location marker
      const farmIcon = L.divIcon({
        html: `<div style="
          width: 36px; height: 36px; border-radius: 50%;
          background: linear-gradient(135deg, #22c55e, #16a34a);
          border: 3px solid white;
          display: flex; align-items: center; justify-content: center;
          font-size: 16px;
          box-shadow: 0 4px 12px rgba(34,197,94,0.4);
        ">🌾</div>`,
        className: "",
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });

      L.marker([22.7011, 90.3637], { icon: farmIcon })
        .addTo(map as ReturnType<typeof L.map>)
        .bindPopup("<strong>Green Valley Farm</strong><br>Barisal District");

      setMapInstance(map);
    }

    initMap();

    return () => {
      if (map && (map as { remove?: () => void }).remove) {
        (map as { remove: () => void }).remove();
      }
    };
  }, []);

  const LAYERS = [
    { id: "flood-risk", label: "Flood Risk", color: "#ef4444" },
    { id: "salinity", label: "Salinity", color: "#f59e0b" },
    { id: "ndvi", label: "Crop Health (NDVI)", color: "#22c55e" },
    { id: "rainfall", label: "Rainfall", color: "#3b82f6" },
    { id: "satellite", label: "Satellite", color: "#8b5cf6" },
  ];

  return (
    <div className="relative w-full h-full">
      {/* Map */}
      <div ref={mapRef} className="w-full h-full" />

      {/* Layer controls — top right */}
      <div className="absolute top-4 right-4 z-[1000] space-y-2">
        <div className="glass-dark rounded-2xl p-3 border border-white/8 min-w-[160px]">
          <div className="flex items-center gap-2 mb-3">
            <Layers size={14} className="text-green-400" />
            <span className="text-xs font-semibold text-white">Layers</span>
          </div>
          {LAYERS.map(({ id, label, color }) => (
            <button
              key={id}
              onClick={() => setActiveLayer(id)}
              className={`w-full flex items-center gap-2 text-xs py-1.5 px-2 rounded-lg mb-1 transition-all ${
                activeLayer === id ? "bg-white/10" : "hover:bg-white/5"
              }`}
            >
              <div
                className="w-3 h-3 rounded-sm flex-shrink-0"
                style={{ background: color, opacity: activeLayer === id ? 1 : 0.4 }}
              />
              <span className={activeLayer === id ? "text-white" : "text-white/40"}>
                {label}
              </span>
            </button>
          ))}
        </div>

        {/* Zoom controls */}
        <div className="glass-dark rounded-xl border border-white/8 overflow-hidden">
          <button className="w-9 h-9 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all border-b border-white/5">
            <Plus size={16} />
          </button>
          <button className="w-9 h-9 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all">
            <Minus size={16} />
          </button>
        </div>

        <button className="glass-dark rounded-xl border border-white/8 w-9 h-9 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all">
          <Locate size={16} />
        </button>
      </div>

      {/* Legend — bottom left */}
      {showLegend && (
        <div className="absolute bottom-4 left-4 z-[1000] glass-dark rounded-2xl p-3 border border-white/8">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Info size={11} className="text-white/40" />
              <span className="text-xs font-semibold text-white/60">Risk Level</span>
            </div>
            <button
              onClick={() => setShowLegend(false)}
              className="text-white/20 hover:text-white/50 ml-4"
            >
              ×
            </button>
          </div>
          {[
            { color: "#22c55e", label: "Low (<30%)" },
            { color: "#f59e0b", label: "Medium (30-60%)" },
            { color: "#ef4444", label: "High (60-80%)" },
            { color: "#7c3aed", label: "Critical (>80%)" },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-2 text-xs text-white/60 mb-1">
              <div className="w-3 h-3 rounded-sm" style={{ background: color }} />
              {label}
            </div>
          ))}
        </div>
      )}

      {/* Timeline slider */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] glass-dark rounded-xl p-3 border border-white/8 flex items-center gap-3">
        <Clock size={14} className="text-white/40" />
        <span className="text-xs text-white/40">Now</span>
        <input
          type="range"
          min={0}
          max={6}
          value={sliderDay}
          onChange={(e) => setSliderDay(Number(e.target.value))}
          className="w-32"
          style={{ accentColor: "#22c55e" }}
        />
        <span className="text-xs text-white/40">+7d</span>
        <span className="text-xs font-mono text-green-400">
          {sliderDay === 0 ? "Now" : `+${sliderDay}d`}
        </span>
      </div>
    </div>
  );
}
