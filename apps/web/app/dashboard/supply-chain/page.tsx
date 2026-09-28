"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  Shield, TruckIcon, BarChart3, Map, Bell, Settings,
  LogOut, Home, Package, RefreshCcw, AlertTriangle,
  TrendingUp, TrendingDown, ChevronRight, ChevronDown,
  DollarSign, Zap, Globe2, Filter, Download, X, Check,
  Loader2, Building2
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ScatterChart,
  Scatter, ZAxis, Cell, PieChart, Pie
} from "recharts";

const TRACKED_COMMODITIES = [
  {
    id: "rice-bd", name: "Rice", region: "Bangladesh — Barisal",
    floodRisk: 72, salinityRisk: 38, supplyScore: 42,
    currentPrice: 485, priceForecast7d: 510, priceForecast30d: 540,
    volumeAtRisk: 1240, alternative: "Vietnam", status: "critical" as const,
    priceImpact: "+11%",
  },
  {
    id: "rice-vn", name: "Rice", region: "Vietnam — Mekong Delta",
    floodRisk: 55, salinityRisk: 62, supplyScore: 65,
    currentPrice: 392, priceForecast7d: 408, priceForecast30d: 425,
    volumeAtRisk: 880, alternative: "Thailand", status: "warning" as const,
    priceImpact: "+8%",
  },
  {
    id: "jute-bd", name: "Jute", region: "Bangladesh — Dhaka Div.",
    floodRisk: 48, salinityRisk: 22, supplyScore: 71,
    currentPrice: 1250, priceForecast7d: 1290, priceForecast30d: 1350,
    volumeAtRisk: 320, alternative: "India — Assam", status: "watch" as const,
    priceImpact: "+8%",
  },
  {
    id: "sugarcane-ph", name: "Sugarcane", region: "Philippines — Luzon",
    floodRisk: 35, salinityRisk: 18, supplyScore: 84,
    currentPrice: 280, priceForecast7d: 285, priceForecast30d: 290,
    volumeAtRisk: 150, alternative: "Brazil", status: "stable" as const,
    priceImpact: "+2%",
  },
];

const SCENARIOS = [
  {
    id: "sc1", name: "Ganges Delta Flood (Extreme)",
    probability: 72, impactUSD: 18200000, affectedCommodities: ["Rice (BD)", "Jute (BD)"],
    leadTime: "72 hours", recommendation: "Secure Vietnamese rice forward contracts immediately",
  },
  {
    id: "sc2", name: "Mekong Salinity Crisis (Moderate)",
    probability: 58, impactUSD: 9400000, affectedCommodities: ["Rice (VN)", "Shrimp (VN)"],
    leadTime: "14 days", recommendation: "Diversify to Thai Jasmine or Indian Parboiled",
  },
  {
    id: "sc3", name: "Multi-Region Simultaneous Event",
    probability: 28, impactUSD: 47000000, affectedCommodities: ["Rice (BD+VN)", "Jute", "Vegetables"],
    leadTime: "Unknown", recommendation: "Activate contingency suppliers in Thailand + Indonesia",
  },
];

const PRICE_FORECAST_DATA = Array.from({ length: 30 }, (_, i) => ({
  day: `D+${i + 1}`,
  rice_bd: Math.round(485 + i * 1.8 + (Math.random() - 0.3) * 8),
  rice_vn: Math.round(392 + i * 1.1 + (Math.random() - 0.3) * 6),
  jute: Math.round(1250 + i * 3.3 + (Math.random() - 0.3) * 20),
}));

const ROUTE_DATA = [
  { origin: "Barisal, BD", destination: "Dhaka", commodity: "Rice", risk: "high" as const, alternativeRoute: "Via Chandpur", delay: "2-3 days", costIncrease: "+18%" },
  { origin: "Can Tho, VN", destination: "Ho Chi Minh City", commodity: "Rice", risk: "medium" as const, alternativeRoute: "Via Vinh Long", delay: "1 day", costIncrease: "+8%" },
  { origin: "Khulna, BD", destination: "Chittagong Port", commodity: "Jute", risk: "low" as const, alternativeRoute: "Direct (clear)", delay: "None", costIncrease: "0%" },
];

const statusConfig = {
  critical: { label: "CRITICAL", color: "#7c3aed", bg: "bg-violet-500/10 border-violet-500/30" },
  warning: { label: "WARNING", color: "#ef4444", bg: "bg-red-500/10 border-red-500/30" },
  watch: { label: "WATCH", color: "#f59e0b", bg: "bg-amber-500/10 border-amber-500/30" },
  stable: { label: "STABLE", color: "#22c55e", bg: "bg-green-500/10 border-green-500/30" },
};

function CommodityCard({ c, expanded, onToggle }: {
  c: typeof TRACKED_COMMODITIES[0];
  expanded: boolean;
  onToggle: () => void;
}) {
  const status = statusConfig[c.status];
  const priceUp = c.priceForecast7d > c.currentPrice;

  return (
    <motion.div
      layout
      className={`rounded-2xl border p-5 transition-all cursor-pointer ${status.bg} ${expanded ? "shadow-lg" : ""}`}
      onClick={onToggle}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-bold text-white">{c.name}</span>
            <span className="text-xs text-white/40">·</span>
            <span className="text-xs text-white/50">{c.region}</span>
          </div>
          <div className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full`}
            style={{ background: `${status.color}20`, color: status.color }}>
            {status.label}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="font-black text-white text-lg">${c.currentPrice}</div>
          <div className={`text-xs font-semibold flex items-center justify-end gap-1 ${priceUp ? "text-red-400" : "text-green-400"}`}>
            {priceUp ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
            {c.priceImpact} (7d)
          </div>
        </div>
      </div>

      {/* Risk bars */}
      <div className="grid grid-cols-2 gap-3 mt-4">
        {[
          { label: "Flood Risk", value: c.floodRisk, color: "#3b82f6" },
          { label: "Salinity", value: c.salinityRisk, color: "#f59e0b" },
        ].map(({ label, value, color }) => (
          <div key={label}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-white/40">{label}</span>
              <span style={{ color }} className="font-semibold">{value}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${value}%`, background: color }} />
            </div>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 pt-4 border-t border-white/8 space-y-3"
          >
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center rounded-xl bg-white/5 p-2">
                <div className="text-xs text-white/40 mb-1">Supply Score</div>
                <div className={`font-bold text-lg ${c.supplyScore < 50 ? "text-red-400" : c.supplyScore < 70 ? "text-amber-400" : "text-green-400"}`}>
                  {c.supplyScore}
                </div>
              </div>
              <div className="text-center rounded-xl bg-white/5 p-2">
                <div className="text-xs text-white/40 mb-1">Volume at Risk</div>
                <div className="font-bold text-lg text-white">{c.volumeAtRisk}t</div>
              </div>
              <div className="text-center rounded-xl bg-white/5 p-2">
                <div className="text-xs text-white/40 mb-1">30d Forecast</div>
                <div className="font-bold text-lg text-red-400">${c.priceForecast30d}</div>
              </div>
            </div>
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs">
              <span className="text-amber-400 font-semibold">🔄 Alternative Source:</span>
              <span className="text-white/70 ml-1">{c.alternative} — {c.status === "critical" ? "Activate now" : "Monitor readiness"}</span>
            </div>
            <div className="flex gap-2">
              <button className="flex-1 btn-primary py-2 text-xs">Hedge Now</button>
              <button className="flex-1 btn-outline py-2 text-xs">View Route</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function SupplyChainDashboardPage() {
  const [activeSection, setActiveSection] = useState("overview");
  const [expandedCommodity, setExpandedCommodity] = useState<string | null>("rice-bd");
  const [runningScenario, setRunningScenario] = useState<string | null>(null);

  const navItems = [
    { id: "overview", icon: Home, label: "Overview" },
    { id: "commodities", icon: Package, label: "Commodities" },
    { id: "scenarios", icon: Zap, label: "Scenarios" },
    { id: "routes", icon: Map, label: "Routes" },
    { id: "analytics", icon: BarChart3, label: "Analytics" },
  ];

  return (
    <div className="min-h-screen text-white flex" style={{ background: "#0a1220" }}>
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 border-r border-amber-500/10 flex flex-col" style={{ background: "#0d1a2e" }}>
        <div className="p-5 border-b border-amber-500/10">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #f59e0b, #d97706)" }}>
              <Shield size={18} className="text-white" />
            </div>
            <div>
              <div className="font-bold text-sm text-white">Agri-SHIELD</div>
              <div className="text-xs text-amber-400">Supply Chain Portal</div>
            </div>
          </Link>
        </div>

        <div className="px-4 py-3 border-b border-amber-500/10">
          <div className="text-xs text-white/40">South Asia Agri Trading Co.</div>
          <div className="flex items-center gap-1.5 mt-1">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-xs text-amber-400">10 commodities tracked</span>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setActiveSection(id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
                activeSection === id
                  ? "bg-amber-500/15 border border-amber-500/25 text-amber-400"
                  : "text-white/40 hover:text-white hover:bg-white/5"
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-amber-500/10 space-y-1">
          <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-white/40 hover:text-white hover:bg-white/5 transition-all">
            <Settings size={16} />Settings
          </button>
          <Link href="/auth/signin" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-white/40 hover:text-white hover:bg-white/5 transition-all">
            <LogOut size={16} />Sign Out
          </Link>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <header className="sticky top-0 z-30 border-b backdrop-blur-xl" style={{ background: "rgba(10,18,32,0.9)", borderColor: "rgba(245,158,11,0.1)" }}>
          <div className="flex items-center justify-between px-6 h-16">
            <div>
              <h1 className="font-bold text-white">
                {navItems.find(n => n.id === activeSection)?.label ?? "Overview"}
              </h1>
              <p className="text-xs text-white/40">
                {TRACKED_COMMODITIES.filter(c => c.status === "critical" || c.status === "warning").length} commodities need attention · Updated 5 min ago
              </p>
            </div>
            <div className="flex gap-3">
              <button className="btn-outline py-2 px-4 text-sm border-amber-500/30 text-amber-400">
                <Download size={14} />
                Export Report
              </button>
              <button className="py-2 px-4 text-sm rounded-xl font-semibold transition-all"
                style={{ background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "white" }}>
                <RefreshCcw size={14} className="inline mr-2" />
                Sync Now
              </button>
            </div>
          </div>
        </header>

        <div className="p-6">
          <AnimatePresence mode="wait">
            {/* ── OVERVIEW ── */}
            {activeSection === "overview" && (
              <motion.div key="sc-overview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                {/* Supply chain KPIs */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { label: "Procurement at Risk", value: "$18.2M", icon: AlertTriangle, color: "#ef4444", change: "Next 30 days" },
                    { label: "Cost Avoided (YTD)", value: "$4.1M", icon: DollarSign, color: "#22c55e", change: "vs. no-hedge" },
                    { label: "Tracked Commodities", value: "10", icon: Package, color: "#f59e0b", change: "4 with alerts" },
                    { label: "Suppliers Activated", value: "3", icon: Globe2, color: "#8b5cf6", change: "Contingency" },
                  ].map(({ label, value, icon: Icon, color, change }) => (
                    <div key={label} className="rounded-2xl border border-white/8 p-5" style={{ background: "rgba(255,255,255,0.02)" }}>
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
                        style={{ background: `${color}20`, border: `1px solid ${color}30` }}>
                        <Icon size={18} style={{ color }} />
                      </div>
                      <div className="text-2xl font-black text-white">{value}</div>
                      <div className="text-xs text-white/40 mt-1">{label}</div>
                      <div className="text-xs text-white/25 mt-0.5">{change}</div>
                    </div>
                  ))}
                </div>

                {/* Commodity cards */}
                <div>
                  <h2 className="text-sm font-semibold text-white mb-3">Tracked Commodities</h2>
                  <div className="space-y-3">
                    {TRACKED_COMMODITIES.map((c) => (
                      <CommodityCard
                        key={c.id}
                        c={c}
                        expanded={expandedCommodity === c.id}
                        onToggle={() => setExpandedCommodity(expandedCommodity === c.id ? null : c.id)}
                      />
                    ))}
                  </div>
                </div>

                {/* Price forecast chart */}
                <div className="rounded-2xl border border-white/8 p-5" style={{ background: "rgba(255,255,255,0.02)" }}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-white">30-Day Price Forecast</h3>
                    <div className="flex gap-3 text-xs">
                      <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-blue-400" />Rice (BD)</div>
                      <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-green-400" />Rice (VN)</div>
                      <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-amber-400" />Jute</div>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={PRICE_FORECAST_DATA.slice(0, 14)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="day" stroke="#ffffff20" tick={{ fill: "#ffffff40", fontSize: 10 }} interval={1} />
                      <YAxis stroke="#ffffff20" tick={{ fill: "#ffffff40", fontSize: 10 }} />
                      <Tooltip contentStyle={{ background: "rgba(10,18,32,0.95)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 12 }} />
                      <Line type="monotone" dataKey="rice_bd" stroke="#3b82f6" strokeWidth={2.5} dot={false} name="Rice (BD) $/t" />
                      <Line type="monotone" dataKey="rice_vn" stroke="#22c55e" strokeWidth={2} dot={false} name="Rice (VN) $/t" />
                      <Line type="monotone" dataKey="jute" stroke="#f59e0b" strokeWidth={2} dot={false} name="Jute $/t" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </motion.div>
            )}

            {/* ── SCENARIOS ── */}
            {activeSection === "scenarios" && (
              <motion.div key="scenarios" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-white">Monte Carlo Disruption Scenarios</h2>
                    <p className="text-xs text-white/40 mt-0.5">10,000 simulations per scenario · Updated hourly</p>
                  </div>
                </div>

                {SCENARIOS.map((s) => (
                  <div key={s.id} className="rounded-2xl border border-white/8 p-5" style={{ background: "rgba(255,255,255,0.02)" }}>
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="font-semibold text-white mb-1">{s.name}</h3>
                        <div className="flex gap-3 text-xs text-white/40">
                          <span>🎯 Probability: <span className={`font-bold ${s.probability > 60 ? "text-red-400" : s.probability > 35 ? "text-amber-400" : "text-green-400"}`}>{s.probability}%</span></span>
                          <span>⏰ Lead time: {s.leadTime}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-black text-red-400">
                          ${(s.impactUSD / 1000000).toFixed(1)}M
                        </div>
                        <div className="text-xs text-white/40">potential impact</div>
                      </div>
                    </div>

                    {/* Probability bar */}
                    <div className="mb-4">
                      <div className="h-3 rounded-full bg-white/8 overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${s.probability}%` }}
                          transition={{ delay: 0.2, ease: "easeOut" }}
                          className="h-full rounded-full"
                          style={{
                            background: s.probability > 60 ? "linear-gradient(90deg, #ef4444, #7c3aed)" :
                              s.probability > 35 ? "linear-gradient(90deg, #f59e0b, #ef4444)" :
                                "#22c55e",
                          }}
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 mb-4">
                      {s.affectedCommodities.map((c) => (
                        <span key={c} className="text-xs px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white/60">{c}</span>
                      ))}
                    </div>

                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 mb-4">
                      💡 <strong>Recommendation:</strong> {s.recommendation}
                    </div>

                    <div className="flex gap-3">
                      <button
                        onClick={async () => {
                          setRunningScenario(s.id);
                          await new Promise(r => setTimeout(r, 2000));
                          setRunningScenario(null);
                        }}
                        disabled={runningScenario === s.id}
                        className="btn-primary py-2 px-4 text-xs flex-1"
                        style={runningScenario ? {} : { background: "linear-gradient(135deg, #f59e0b, #d97706)" }}
                      >
                        {runningScenario === s.id ? (
                          <><Loader2 size={12} className="animate-spin" /> Running 10k Simulations...</>
                        ) : (
                          <><Zap size={12} /> Run Scenario</>
                        )}
                      </button>
                      <button className="btn-outline py-2 px-4 text-xs border-amber-500/30 text-amber-400">
                        Hedge Strategy
                      </button>
                    </div>
                  </div>
                ))}
              </motion.div>
            )}

            {/* ── ROUTES ── */}
            {activeSection === "routes" && (
              <motion.div key="routes" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
                <h2 className="text-lg font-bold text-white">Supply Route Risk</h2>
                <div className="space-y-4">
                  {ROUTE_DATA.map((route, i) => (
                    <div key={i} className="rounded-2xl border border-white/8 p-5" style={{ background: "rgba(255,255,255,0.02)" }}>
                      <div className="flex items-center gap-4 mb-3">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-white/60">{route.origin}</span>
                          <span className="text-white/30">→</span>
                          <span className="text-white font-semibold">{route.destination}</span>
                        </div>
                        <span className="text-xs text-white/40">· {route.commodity}</span>
                        <div className={`ml-auto text-xs px-2 py-0.5 rounded-full font-semibold`}
                          style={{
                            background: route.risk === "high" ? "rgba(239,68,68,0.15)" : route.risk === "medium" ? "rgba(245,158,11,0.15)" : "rgba(34,197,94,0.15)",
                            color: route.risk === "high" ? "#ef4444" : route.risk === "medium" ? "#f59e0b" : "#22c55e",
                          }}>
                          {route.risk.toUpperCase()}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-xs">
                        <div>
                          <div className="text-white/30 mb-1">Alternative Route</div>
                          <div className="text-white">{route.alternativeRoute}</div>
                        </div>
                        <div>
                          <div className="text-white/30 mb-1">Expected Delay</div>
                          <div className={route.delay === "None" ? "text-green-400" : "text-amber-400"}>{route.delay}</div>
                        </div>
                        <div>
                          <div className="text-white/30 mb-1">Cost Increase</div>
                          <div className={route.costIncrease === "0%" ? "text-green-400" : "text-red-400"}>{route.costIncrease}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* ── ANALYTICS ── */}
            {activeSection === "analytics" && (
              <motion.div key="sc-analytics" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                <h2 className="text-lg font-bold text-white">Supply Chain Analytics</h2>
                <div className="grid lg:grid-cols-2 gap-6">
                  {/* Price forecast 30d */}
                  <div className="rounded-2xl border border-white/8 p-5" style={{ background: "rgba(255,255,255,0.02)" }}>
                    <h3 className="text-sm font-semibold text-white mb-4">30-Day Price Forecast — All Commodities</h3>
                    <ResponsiveContainer width="100%" height={250}>
                      <LineChart data={PRICE_FORECAST_DATA}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="day" stroke="#ffffff20" tick={{ fill: "#ffffff40", fontSize: 9 }} interval={4} />
                        <YAxis stroke="#ffffff20" tick={{ fill: "#ffffff40", fontSize: 10 }} />
                        <Tooltip contentStyle={{ background: "rgba(10,18,32,0.95)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 12 }} />
                        <Line type="monotone" dataKey="rice_bd" stroke="#3b82f6" strokeWidth={2} dot={false} name="Rice (BD) $/t" />
                        <Line type="monotone" dataKey="rice_vn" stroke="#22c55e" strokeWidth={2} dot={false} name="Rice (VN) $/t" />
                        <Line type="monotone" dataKey="jute" stroke="#f59e0b" strokeWidth={2} dot={false} name="Jute $/t" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Risk vs impact scatter */}
                  <div className="rounded-2xl border border-white/8 p-5" style={{ background: "rgba(255,255,255,0.02)" }}>
                    <h3 className="text-sm font-semibold text-white mb-4">Commodity Risk vs Volume at Risk</h3>
                    <ResponsiveContainer width="100%" height={250}>
                      <ScatterChart>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="floodRisk" name="Flood Risk %" stroke="#ffffff20" tick={{ fill: "#ffffff40", fontSize: 10 }} />
                        <YAxis dataKey="volumeAtRisk" name="Volume at Risk (t)" stroke="#ffffff20" tick={{ fill: "#ffffff40", fontSize: 10 }} />
                        <ZAxis range={[60, 400]} />
                        <Tooltip contentStyle={{ background: "rgba(10,18,32,0.95)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 12 }} />
                        <Scatter
                          data={TRACKED_COMMODITIES.map((c) => ({
                            floodRisk: c.floodRisk,
                            volumeAtRisk: c.volumeAtRisk,
                            name: c.name + " (" + c.region.split(" — ")[0].slice(-2) + ")",
                          }))}
                          fill="#f59e0b"
                        >
                          {TRACKED_COMMODITIES.map((c, i) => (
                            <Cell key={i} fill={
                              c.status === "critical" ? "#7c3aed" :
                                c.status === "warning" ? "#ef4444" :
                                  c.status === "watch" ? "#f59e0b" : "#22c55e"
                            } />
                          ))}
                        </Scatter>
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── COMMODITIES ── */}
            {activeSection === "commodities" && (
              <motion.div key="sc-commodities" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-white">Commodity Tracker</h2>
                  <button className="btn-outline py-2 px-4 text-sm border-amber-500/30 text-amber-400">
                    <Plus size={14} />
                    Add Commodity
                  </button>
                </div>
                <div className="space-y-3">
                  {TRACKED_COMMODITIES.map((c) => (
                    <CommodityCard
                      key={c.id}
                      c={c}
                      expanded={expandedCommodity === c.id}
                      onToggle={() => setExpandedCommodity(expandedCommodity === c.id ? null : c.id)}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
