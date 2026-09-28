"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Shield, Map, Bell, BarChart3, Settings, Package,
  FileText, AlertTriangle, Users, Layers, TrendingUp,
  TrendingDown, CheckCircle2, Clock, Send, Truck,
  ChevronRight, X, Plus, Filter, Download, Loader2,
  Building2, Globe2, Zap, LogOut, Home
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line
} from "recharts";

const GovMap = dynamic(() => import("@/components/maps/GovMap"), { ssr: false });

// Simulated government data
const KPI_DATA = [
  { label: "Monitored Area", value: "892,400", unit: "ha", icon: Globe2, change: "+12%", up: true, color: "#10b981" },
  { label: "High-Risk Zones", value: "23", unit: "active", icon: AlertTriangle, change: "+5", up: false, color: "#ef4444" },
  { label: "Farmers at Risk", value: "14,820", unit: "farmers", icon: Users, change: "-890", up: false, color: "#f59e0b" },
  { label: "Resources Dispatched", value: "47", unit: "units today", icon: Truck, change: "+8", up: true, color: "#3b82f6" },
  { label: "Alerts Sent", value: "2,341", unit: "this week", icon: Bell, change: "+340", up: true, color: "#8b5cf6" },
  { label: "Est. Crop Loss Averted", value: "$4.2M", unit: "this season", icon: TrendingUp, change: "+$0.8M", up: true, color: "#22c55e" },
];

const DISTRICTS = [
  { id: "barisal", name: "Barisal", risk: "high" as const, farmersAtRisk: 4200, floodProb24h: 78, floodProb48h: 85, floodProb72h: 91, pumpsNeeded: 45, pumpsAvailable: 12 },
  { id: "khulna", name: "Khulna", risk: "critical" as const, farmersAtRisk: 6800, floodProb24h: 88, floodProb48h: 92, floodProb72h: 95, pumpsNeeded: 80, pumpsAvailable: 20 },
  { id: "sylhet", name: "Sylhet", risk: "medium" as const, farmersAtRisk: 2100, floodProb24h: 45, floodProb48h: 58, floodProb72h: 65, pumpsNeeded: 25, pumpsAvailable: 18 },
  { id: "rajshahi", name: "Rajshahi", risk: "low" as const, farmersAtRisk: 320, floodProb24h: 18, floodProb48h: 22, floodProb72h: 30, pumpsNeeded: 5, pumpsAvailable: 12 },
  { id: "dhaka", name: "Dhaka Division", risk: "medium" as const, farmersAtRisk: 1400, floodProb24h: 42, floodProb48h: 55, floodProb72h: 61, pumpsNeeded: 20, pumpsAvailable: 15 },
];

const RESOURCE_INVENTORY = [
  { type: "Water Pumps", total: 250, deployed: 187, available: 63, critical: true, icon: "💧" },
  { type: "Sandbags", total: 12000, deployed: 8400, available: 3600, critical: false, icon: "🛢️" },
  { type: "Evacuation Buses", total: 85, deployed: 32, available: 53, critical: false, icon: "🚌" },
  { type: "Medical Kits", total: 500, deployed: 120, available: 380, critical: false, icon: "🏥" },
  { type: "Food Aid Packages", total: 8000, deployed: 2800, available: 5200, critical: false, icon: "🍱" },
];

const FLOOD_TREND_DATA = Array.from({ length: 12 }, (_, i) => ({
  month: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][i],
  "2025": Math.round(20 + 60 * Math.sin((i / 12) * Math.PI) + Math.random() * 15),
  "2026": Math.round(25 + 70 * Math.sin((i / 12) * Math.PI + 0.2) + Math.random() * 15),
}));

const RESPONSE_RATE_DATA = Array.from({ length: 8 }, (_, i) => ({
  week: `W${i + 1}`,
  responseRate: Math.round(55 + i * 5 + Math.random() * 8),
  cropSaved: Math.round(40 + i * 6 + Math.random() * 10),
}));

const riskBadgeClass = {
  low: "badge-risk-low",
  medium: "badge-risk-medium",
  high: "badge-risk-high",
  critical: "badge-risk-critical",
};

function KPICard({ label, value, unit, icon: Icon, change, up, color }: (typeof KPI_DATA)[0]) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-white/8 bg-white/3 p-5 hover:bg-white/5 transition-all"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: `${color}20`, border: `1px solid ${color}30` }}>
          <Icon size={18} style={{ color }} />
        </div>
        <div className={`flex items-center gap-1 text-xs font-semibold ${up ? "text-green-400" : "text-red-400"}`}>
          {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {change}
        </div>
      </div>
      <div className="text-2xl font-black text-white tabular-nums">{value}</div>
      <div className="text-xs text-white/40 mt-0.5">
        {unit} · <span className="font-medium">{label}</span>
      </div>
    </motion.div>
  );
}

function DistrictPanel({ district, onClose }: { district: (typeof DISTRICTS)[0]; onClose: () => void }) {
  const [dispatching, setDispatching] = useState(false);
  const pumpShortfall = district.pumpsNeeded - district.pumpsAvailable;

  return (
    <motion.div
      initial={{ x: "100%", opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "100%", opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="absolute right-0 top-0 h-full w-80 glass-dark border-l border-white/8 z-20 overflow-y-auto p-5"
    >
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-bold text-white">{district.name}</h3>
        <button onClick={onClose} className="text-white/30 hover:text-white transition-colors">
          <X size={18} />
        </button>
      </div>

      {/* Risk badge */}
      <div className={`${riskBadgeClass[district.risk]} mb-4 text-sm`}>
        {district.risk.toUpperCase()} RISK
      </div>

      {/* Flood probability timeline */}
      <div className="mb-5">
        <div className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">
          Flood Probability
        </div>
        {[
          { label: "24h", value: district.floodProb24h },
          { label: "48h", value: district.floodProb48h },
          { label: "72h", value: district.floodProb72h },
        ].map(({ label, value }) => (
          <div key={label} className="flex items-center gap-3 mb-2">
            <span className="text-xs text-white/40 w-6">{label}</span>
            <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${value}%` }}
                className="h-full rounded-full"
                style={{
                  background: value > 75 ? "#ef4444" : value > 50 ? "#f59e0b" : "#22c55e",
                }}
              />
            </div>
            <span className="text-xs font-bold text-white w-8">{value}%</span>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="rounded-xl bg-white/5 border border-white/8 p-3">
          <div className="text-xl font-black text-amber-400">
            {district.farmersAtRisk.toLocaleString()}
          </div>
          <div className="text-xs text-white/40">Farmers at Risk</div>
        </div>
        <div className={`rounded-xl p-3 border ${pumpShortfall > 0 ? "bg-red-500/10 border-red-500/20" : "bg-green-500/10 border-green-500/20"}`}>
          <div className={`text-xl font-black ${pumpShortfall > 0 ? "text-red-400" : "text-green-400"}`}>
            {pumpShortfall > 0 ? `-${pumpShortfall}` : "OK"}
          </div>
          <div className="text-xs text-white/40">Pump Shortfall</div>
        </div>
      </div>

      {/* Warning if shortage */}
      {pumpShortfall > 0 && (
        <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400">
          ⚠️ <strong>Critical shortage:</strong> {pumpShortfall} pumps needed. {district.farmersAtRisk.toLocaleString()} farmers at risk.
        </div>
      )}

      {/* Dispatch button */}
      <button
        onClick={async () => {
          setDispatching(true);
          await new Promise(r => setTimeout(r, 1500));
          setDispatching(false);
        }}
        disabled={dispatching}
        className="btn-primary w-full mb-3"
      >
        {dispatching ? (
          <><Loader2 size={16} className="animate-spin" /> Dispatching...</>
        ) : (
          <><Truck size={16} /> Dispatch Resources</>
        )}
      </button>

      <button className="btn-outline w-full text-sm">
        <Bell size={14} />
        Send District Alert
      </button>

      {/* Recent alerts */}
      <div className="mt-5">
        <div className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">
          Recent Alerts
        </div>
        {[
          { title: "Flood Warning Issued", time: "2h ago", severity: "warning" },
          { title: "Pump Request Received", time: "4h ago", severity: "watch" },
        ].map(({ title, time, severity }, i) => (
          <div key={i} className="flex items-center gap-2 py-2 border-b border-white/5">
            <div className={`w-2 h-2 rounded-full ${severity === "warning" ? "bg-red-400" : "bg-amber-400"}`} />
            <span className="text-xs text-white/60 flex-1">{title}</span>
            <span className="text-xs text-white/30">{time}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

export default function GovernmentDashboardPage() {
  const [activeSection, setActiveSection] = useState("overview");
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const [showAlertWizard, setShowAlertWizard] = useState(false);

  const selectedDistrictData = DISTRICTS.find((d) => d.id === selectedDistrict);

  const navItems = [
    { id: "overview", icon: Home, label: "Overview" },
    { id: "map", icon: Map, label: "Risk Map" },
    { id: "resources", icon: Package, label: "Resources" },
    { id: "alerts", icon: Bell, label: "Alerts" },
    { id: "analytics", icon: BarChart3, label: "Analytics" },
    { id: "policy", icon: FileText, label: "Policy" },
  ];

  return (
    <div className="min-h-screen bg-[#0f172a] text-white flex">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-white/5 flex flex-col">
        {/* Logo */}
        <div className="p-5 border-b border-white/5">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <Shield size={18} className="text-white" />
            </div>
            <div>
              <div className="font-bold text-sm text-white">Agri-SHIELD</div>
              <div className="text-xs text-emerald-400">Government Portal</div>
            </div>
          </Link>
        </div>

        {/* Org info */}
        <div className="px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-2 text-xs">
            <Building2 size={12} className="text-emerald-400" />
            <span className="text-white/60">Bangladesh Ministry of Agriculture</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-emerald-400">National Level Access</span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setActiveSection(id)}
              className={`sidebar-nav-item w-full ${activeSection === id ? "active" : ""}`}
            >
              <Icon size={16} />
              {label}
              {id === "alerts" && (
                <span className="ml-auto bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">3</span>
              )}
            </button>
          ))}
        </nav>

        {/* Bottom */}
        <div className="p-3 border-t border-white/5 space-y-1">
          <button className="sidebar-nav-item w-full">
            <Settings size={16} />
            Settings
          </button>
          <Link href="/auth/signin" className="sidebar-nav-item w-full">
            <LogOut size={16} />
            Sign Out
          </Link>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        {/* Top bar */}
        <header className="sticky top-0 z-30 border-b border-white/5 bg-[#0f172a]/90 backdrop-blur-xl">
          <div className="flex items-center justify-between px-6 h-16">
            <div>
              <h1 className="font-bold text-white">
                {navItems.find(n => n.id === activeSection)?.label ?? "Overview"}
              </h1>
              <p className="text-xs text-white/40">
                Bangladesh · National Dashboard · Updated 3 min ago
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowAlertWizard(true)}
                className="btn-primary py-2 px-4 text-sm"
              >
                <Bell size={14} />
                New Alert
              </button>
              <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-sm font-bold text-emerald-400">
                DA
              </div>
            </div>
          </div>
        </header>

        <div className="p-6">
          <AnimatePresence mode="wait">
            {/* ── OVERVIEW ── */}
            {activeSection === "overview" && (
              <motion.div key="overview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                {/* KPI Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                  {KPI_DATA.map((kpi) => (
                    <KPICard key={kpi.label} {...kpi} />
                  ))}
                </div>

                {/* Map + District List */}
                <div className="grid lg:grid-cols-3 gap-6">
                  {/* Map */}
                  <div className="lg:col-span-2 relative rounded-2xl overflow-hidden border border-white/8" style={{ height: 420 }}>
                    <GovMap
                      districts={DISTRICTS}
                      onDistrictClick={(id) => setSelectedDistrict(id === selectedDistrict ? null : id)}
                      selectedDistrict={selectedDistrict}
                    />
                    <AnimatePresence>
                      {selectedDistrict && selectedDistrictData && (
                        <DistrictPanel
                          district={selectedDistrictData}
                          onClose={() => setSelectedDistrict(null)}
                        />
                      )}
                    </AnimatePresence>
                  </div>

                  {/* District risk list */}
                  <div className="space-y-3">
                    <h2 className="text-sm font-semibold text-white/70">Districts by Risk Level</h2>
                    {DISTRICTS.sort((a, b) => {
                      const order = { critical: 0, high: 1, medium: 2, low: 3 };
                      return order[a.risk] - order[b.risk];
                    }).map((d) => (
                      <button
                        key={d.id}
                        onClick={() => setSelectedDistrict(d.id === selectedDistrict ? null : d.id)}
                        className={`w-full text-left p-4 rounded-xl border transition-all ${
                          selectedDistrict === d.id
                            ? "border-emerald-500/50 bg-emerald-500/5"
                            : "border-white/8 bg-white/3 hover:border-white/20"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-semibold text-sm text-white">{d.name}</span>
                          <span className={riskBadgeClass[d.risk]}>{d.risk}</span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-white/40">
                          <span>👤 {d.farmersAtRisk.toLocaleString()} at risk</span>
                          <span>🌊 {d.floodProb24h}% / 24h</span>
                        </div>
                        {/* Mini probability bar */}
                        <div className="mt-2 h-1 rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${d.floodProb24h}%`,
                              background: d.risk === "critical" ? "#7c3aed" : d.risk === "high" ? "#ef4444" : d.risk === "medium" ? "#f59e0b" : "#22c55e",
                            }}
                          />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Charts row */}
                <div className="grid lg:grid-cols-2 gap-6">
                  <div className="rounded-2xl border border-white/8 bg-white/3 p-5">
                    <h3 className="text-sm font-semibold text-white mb-4">Flood Events — 2025 vs 2026</h3>
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={FLOOD_TREND_DATA}>
                        <defs>
                          <linearGradient id="color2025" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="color2026" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="month" stroke="#ffffff20" tick={{ fill: "#ffffff40", fontSize: 11 }} />
                        <YAxis stroke="#ffffff20" tick={{ fill: "#ffffff40", fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{ background: "rgba(17,24,39,0.9)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }}
                          labelStyle={{ color: "white" }}
                        />
                        <Area type="monotone" dataKey="2025" stroke="#3b82f6" fill="url(#color2025)" strokeWidth={2} />
                        <Area type="monotone" dataKey="2026" stroke="#10b981" fill="url(#color2026)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="rounded-2xl border border-white/8 bg-white/3 p-5">
                    <h3 className="text-sm font-semibold text-white mb-4">Alert Response Rate & Crop Saved (%)</h3>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={RESPONSE_RATE_DATA}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="week" stroke="#ffffff20" tick={{ fill: "#ffffff40", fontSize: 11 }} />
                        <YAxis stroke="#ffffff20" tick={{ fill: "#ffffff40", fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{ background: "rgba(17,24,39,0.9)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }}
                        />
                        <Bar dataKey="responseRate" fill="#10b981" radius={[4, 4, 0, 0]} name="Response Rate %" />
                        <Bar dataKey="cropSaved" fill="#22c55e" radius={[4, 4, 0, 0]} name="Crop Saved %" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── RESOURCES ── */}
            {activeSection === "resources" && (
              <motion.div key="resources" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-white">Resource Inventory</h2>
                  <button className="btn-primary py-2 px-4 text-sm">
                    <Plus size={14} />
                    Request Resupply
                  </button>
                </div>

                <div className="grid gap-4">
                  {RESOURCE_INVENTORY.map(({ type, total, deployed, available, critical, icon }) => {
                    const pct = Math.round((available / total) * 100);
                    return (
                      <div
                        key={type}
                        className={`rounded-2xl border p-5 ${critical ? "border-red-500/30 bg-red-500/5" : "border-white/8 bg-white/3"}`}
                      >
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <span className="text-2xl">{icon}</span>
                            <div>
                              <div className="font-semibold text-white">{type}</div>
                              <div className="text-xs text-white/40">
                                {deployed} deployed · {available} available of {total} total
                              </div>
                            </div>
                          </div>
                          {critical && (
                            <div className="badge-risk-high">
                              ⚠️ Critical Stock
                            </div>
                          )}
                        </div>
                        {/* Progress bar */}
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-2.5 rounded-full bg-white/10 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${pct}%`,
                                background: pct < 25 ? "#ef4444" : pct < 50 ? "#f59e0b" : "#22c55e",
                              }}
                            />
                          </div>
                          <span className={`text-sm font-bold ${pct < 25 ? "text-red-400" : pct < 50 ? "text-amber-400" : "text-green-400"}`}>
                            {pct}% available
                          </span>
                        </div>
                        <div className="flex gap-3 mt-3">
                          <button className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-white/50 hover:border-emerald-500/30 hover:text-emerald-400 transition-all">
                            View Locations
                          </button>
                          <button className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-white/50 hover:border-blue-500/30 hover:text-blue-400 transition-all">
                            Dispatch Units
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* ── ALERTS ── */}
            {activeSection === "alerts" && (
              <motion.div key="alerts-gov" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-white">Alert Management</h2>
                  <button
                    onClick={() => setShowAlertWizard(true)}
                    className="btn-primary py-2 px-4 text-sm"
                  >
                    <Plus size={14} />
                    Create Alert
                  </button>
                </div>

                {/* Alert creation wizard modal */}
                <AnimatePresence>
                  {showAlertWizard && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                      onClick={(e) => { if (e.target === e.currentTarget) setShowAlertWizard(false); }}
                    >
                      <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.9, opacity: 0 }}
                        className="glass-dark rounded-3xl p-8 border border-white/8 w-full max-w-lg"
                      >
                        <div className="flex items-center justify-between mb-6">
                          <h3 className="text-xl font-bold text-white">Create New Alert</h3>
                          <button onClick={() => setShowAlertWizard(false)} className="text-white/30 hover:text-white">
                            <X size={20} />
                          </button>
                        </div>

                        <div className="space-y-4">
                          <div>
                            <label className="text-xs text-white/50 font-medium mb-1.5 block">Alert Type</label>
                            <select className="input-base bg-white/5 border-white/10 text-white">
                              <option className="bg-gray-900" value="flood">🌊 Flood Warning</option>
                              <option className="bg-gray-900" value="salinity">🧂 Salinity Alert</option>
                              <option className="bg-gray-900" value="storm">🌀 Storm Advisory</option>
                              <option className="bg-gray-900" value="drought">☀️ Drought Watch</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-xs text-white/50 font-medium mb-1.5 block">Severity</label>
                            <div className="flex gap-3">
                              {["watch", "warning", "emergency"].map((s) => (
                                <button key={s} className="flex-1 py-2 rounded-xl border border-white/10 text-xs text-white/50 capitalize hover:border-emerald-500/30 hover:text-emerald-400 transition-all">
                                  {s}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <label className="text-xs text-white/50 font-medium mb-1.5 block">Target Districts</label>
                            <div className="flex flex-wrap gap-2">
                              {DISTRICTS.map((d) => (
                                <button key={d.id} className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-white/50 hover:border-emerald-500/30 hover:text-emerald-400 transition-all">
                                  {d.name}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <label className="text-xs text-white/50 font-medium mb-1.5 block">Alert Message</label>
                            <textarea
                              className="input-base bg-white/5 border-white/10 text-white placeholder:text-white/20 h-24 resize-none"
                              placeholder="Describe the alert and recommended actions..."
                            />
                          </div>
                          <div>
                            <label className="text-xs text-white/50 font-medium mb-1.5 block">Channels</label>
                            <div className="flex gap-3">
                              {["📱 App", "💬 SMS", "📲 WhatsApp", "📧 Email"].map((ch) => (
                                <button key={ch} className="flex-1 py-2 rounded-xl border border-emerald-500/30 text-xs text-emerald-400 bg-emerald-500/5 text-center">
                                  {ch}
                                </button>
                              ))}
                            </div>
                          </div>
                          <button
                            onClick={() => setShowAlertWizard(false)}
                            className="btn-primary w-full"
                          >
                            <Send size={16} />
                            Broadcast Alert
                          </button>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Alert history */}
                <div className="space-y-3">
                  {[
                    { title: "Flood Warning — Khulna District", severity: "emergency" as const, sent: "2h ago", delivered: 6800, read: 4200 },
                    { title: "Salinity Alert — Barisal Coastal Zone", severity: "warning" as const, sent: "6h ago", delivered: 2100, read: 1850 },
                    { title: "Heavy Rain Advisory — Sylhet", severity: "watch" as const, sent: "1d ago", delivered: 8900, read: 7200 },
                  ].map(({ title, severity, sent, delivered, read }, i) => (
                    <div key={i} className={`alert-card-${severity} rounded-xl p-4`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-semibold text-sm text-white">{title}</div>
                        <span className={`badge-risk-${severity === "emergency" ? "critical" : severity === "warning" ? "high" : "medium"} text-xs`}>
                          {severity}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-white/40">
                        <span className="flex items-center gap-1"><Clock size={10} /> {sent}</span>
                        <span>✅ {delivered.toLocaleString()} delivered</span>
                        <span>👁 {read.toLocaleString()} read</span>
                        <span>📊 {Math.round((read/delivered)*100)}% read rate</span>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* ── ANALYTICS ── */}
            {activeSection === "analytics" && (
              <motion.div key="analytics" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-white">Analytics & Reporting</h2>
                  <button className="btn-outline py-2 px-4 text-sm">
                    <Download size={14} />
                    Export PDF Report
                  </button>
                </div>

                <div className="grid lg:grid-cols-2 gap-6">
                  <div className="rounded-2xl border border-white/8 bg-white/3 p-5">
                    <h3 className="text-sm font-semibold text-white mb-4">Flood Risk Trend (2026)</h3>
                    <ResponsiveContainer width="100%" height={250}>
                      <LineChart data={FLOOD_TREND_DATA}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="month" stroke="#ffffff20" tick={{ fill: "#ffffff40", fontSize: 11 }} />
                        <YAxis stroke="#ffffff20" tick={{ fill: "#ffffff40", fontSize: 11 }} />
                        <Tooltip contentStyle={{ background: "rgba(17,24,39,0.9)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }} />
                        <Line type="monotone" dataKey="2026" stroke="#10b981" strokeWidth={2.5} dot={{ fill: "#10b981", r: 3 }} />
                        <Line type="monotone" dataKey="2025" stroke="#3b82f6" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="rounded-2xl border border-white/8 bg-white/3 p-5">
                    <h3 className="text-sm font-semibold text-white mb-4">Farmer Action Rate by Alert Type</h3>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={[
                        { type: "Flood", rate: 78 },
                        { type: "Salinity", rate: 65 },
                        { type: "Storm", rate: 82 },
                        { type: "Drought", rate: 54 },
                        { type: "Planting", rate: 71 },
                      ]}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="type" stroke="#ffffff20" tick={{ fill: "#ffffff40", fontSize: 11 }} />
                        <YAxis stroke="#ffffff20" tick={{ fill: "#ffffff40", fontSize: 11 }} />
                        <Tooltip contentStyle={{ background: "rgba(17,24,39,0.9)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }} />
                        <Bar dataKey="rate" fill="#10b981" radius={[6, 6, 0, 0]} name="Action Rate %" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── POLICY ── */}
            {activeSection === "policy" && (
              <motion.div key="policy" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                <h2 className="text-lg font-bold text-white">AI-Generated Policy Recommendations</h2>
                {[
                  {
                    title: "Embankment Reinforcement — Khulna Division",
                    summary: "Based on Q3 2026 flood data, 3 districts (Khulna, Satkhira, Bagerhat) show a 40% increase in flood probability over 5 years. We recommend prioritizing embankment reinforcement investment.",
                    priority: "High Priority",
                    cost: "$12.4M estimated",
                    beneficiaries: "89,000 farmers",
                    confidence: 87,
                    color: "#ef4444",
                  },
                  {
                    title: "Coastal IoT Sensor Network Expansion",
                    summary: "32 coastal upazilas currently lack real-time EC/salinity sensors. A 250-node sensor network would improve salinity forecast accuracy from 68% to 91% for coastal farmers.",
                    priority: "Medium Priority",
                    cost: "$2.1M estimated",
                    beneficiaries: "41,000 farmers",
                    confidence: 92,
                    color: "#f59e0b",
                  },
                  {
                    title: "Salt-Tolerant Variety Subsidy Program",
                    summary: "EC levels in 8 coastal districts exceeded 4 dS/m for 60+ days in 2026. Subsidizing salt-tolerant varieties (BRRI dhan 47/67) could reduce crop loss by an estimated $8M annually.",
                    priority: "High Priority",
                    cost: "$4.8M/year subsidy",
                    beneficiaries: "55,000 farmers",
                    confidence: 79,
                    color: "#22c55e",
                  },
                ].map(({ title, summary, priority, cost, beneficiaries, confidence, color }, i) => (
                  <div key={i} className="rounded-2xl border border-white/8 bg-white/3 p-5">
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <h3 className="font-semibold text-white">{title}</h3>
                      <span className="badge-risk-medium flex-shrink-0 text-xs" style={{ color }}>{priority}</span>
                    </div>
                    <p className="text-sm text-white/60 mb-4">{summary}</p>
                    <div className="flex flex-wrap gap-4 text-xs">
                      <span className="text-white/40">💰 {cost}</span>
                      <span className="text-white/40">👥 {beneficiaries} beneficiaries</span>
                      <span className="text-white/40">🎯 {confidence}% model confidence</span>
                    </div>
                    <div className="flex gap-3 mt-4">
                      <button className="btn-primary py-2 px-4 text-xs">Review & Approve</button>
                      <button className="btn-outline py-2 px-4 text-xs">Download Brief</button>
                    </div>
                  </div>
                ))}
              </motion.div>
            )}

            {/* ── MAP ── */}
            {activeSection === "map" && (
              <motion.div key="gov-map" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="relative rounded-2xl overflow-hidden border border-white/8"
                style={{ height: "calc(100vh - 160px)" }}>
                <GovMap
                  districts={DISTRICTS}
                  onDistrictClick={(id) => setSelectedDistrict(id === selectedDistrict ? null : id)}
                  selectedDistrict={selectedDistrict}
                />
                <AnimatePresence>
                  {selectedDistrict && selectedDistrictData && (
                    <DistrictPanel district={selectedDistrictData} onClose={() => setSelectedDistrict(null)} />
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
