"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  Home, Map, Bell, MessageSquare, User,
  Shield, Droplets, Waves, Thermometer, Wind,
  Satellite, ChevronRight, CheckCircle2, Clock,
  TrendingUp, TrendingDown, Leaf, AlertTriangle,
  RefreshCcw, Download, Settings, LogOut, Zap,
  Mic, Send, BarChart2, Eye, Filter, X
} from "lucide-react";
import { RiskMeter } from "@/components/ui/RiskMeter";
import { AlertCard } from "@/components/ui/AlertCard";
import dynamic from "next/dynamic";

const FarmerMap = dynamic(() => import("@/components/maps/FarmerMap"), { ssr: false });

// Simulated real-time data (in production, fetched from tRPC)
const DEMO_FARMER = {
  name: "Ratan Das",
  farmName: "Green Valley Farm",
  district: "Barisal",
  country: "Bangladesh",
  crops: ["Rice", "Jute"],
  totalAreaHa: 3.5,
  language: "en",
};

const DEMO_WEATHER = {
  temperatureC: 32,
  humidityPct: 87,
  rainfallMmToday: 12.4,
  windSpeedKmh: 18,
  lastUpdated: new Date(),
};

const DEMO_RISK = {
  floodRisk: 72,
  salinityRisk: 38,
  ndviScore: 0.64,
  lastSatelliteScan: "2 hours ago",
};

const DEMO_ALERTS = [
  {
    id: "alert-1",
    alertType: "flood" as const,
    severity: "warning" as const,
    title: "Elevated Flood Risk — Barisal District",
    description: "72-hour rainfall accumulation of 145mm expected. River Kirtonkhola showing 0.8m above normal. Probability of field-level flooding: 72%.",
    recommendedActions: [
      "Harvest any mature rice immediately",
      "Move farm equipment to elevated ground",
      "Prepare temporary water channels for drainage",
    ],
    validFrom: new Date(),
    validUntil: new Date(Date.now() + 72 * 3600 * 1000),
    predictedImpact: {},
    regionId: null,
    createdAt: new Date(),
    isActive: true,
  },
  {
    id: "alert-2",
    alertType: "salinity" as const,
    severity: "watch" as const,
    title: "Salinity Trend Alert — Coastal Proximity",
    description: "EC measurements in nearby stations trending upward (2.8 → 3.4 dS/m). Risk to rice crops at current levels: moderate.",
    recommendedActions: [
      "Apply freshwater flush if irrigation available",
      "Monitor leaf yellowing for signs of salt stress",
    ],
    validFrom: new Date(),
    validUntil: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    predictedImpact: {},
    regionId: null,
    createdAt: new Date(),
    isActive: true,
  },
];

const DEMO_FIELDS = [
  {
    id: "field-1",
    name: "North Paddy Field",
    cropType: "Rice",
    areaHa: 2.1,
    ndviScore: 0.68,
    daysToHarvest: 42,
    floodRisk: 72,
    salinityRisk: 35,
    status: "warning" as const,
  },
  {
    id: "field-2",
    name: "South Jute Plot",
    cropType: "Jute",
    areaHa: 1.4,
    ndviScore: 0.71,
    daysToHarvest: 88,
    floodRisk: 55,
    salinityRisk: 40,
    status: "caution" as const,
  },
];

const FORECAST_HOURS = Array.from({ length: 24 }, (_, i) => ({
  hour: i,
  rainfallProb: Math.round(30 + 50 * Math.sin((i / 24) * Math.PI * 2 + 1) + Math.random() * 15),
  temp: Math.round(28 + 6 * Math.sin((i / 24) * Math.PI * 2) + Math.random() * 2),
}));

const AI_ADVISOR_STARTERS = [
  "What should I do about the flood warning?",
  "Is it safe to plant now?",
  "What crop works on salt-affected land?",
  "How do I drain my field fast?",
];

function WeatherCard() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[
        { icon: Thermometer, value: `${DEMO_WEATHER.temperatureC}°C`, label: "Temperature", color: "#ef4444" },
        { icon: Droplets, value: `${DEMO_WEATHER.humidityPct}%`, label: "Humidity", color: "#3b82f6" },
        { icon: Waves, value: `${DEMO_WEATHER.rainfallMmToday}mm`, label: "Today's Rain", color: "#22c55e" },
        { icon: Wind, value: `${DEMO_WEATHER.windSpeedKmh}km/h`, label: "Wind Speed", color: "#f59e0b" },
      ].map(({ icon: Icon, value, label, color }) => (
        <div key={label} className="rounded-xl bg-white/3 border border-white/8 p-3 text-center">
          <Icon size={18} style={{ color }} className="mx-auto mb-1.5" />
          <div className="font-bold text-white text-sm">{value}</div>
          <div className="text-xs text-white/40">{label}</div>
        </div>
      ))}
    </div>
  );
}

function ForecastStrip() {
  return (
    <div className="overflow-x-auto no-scrollbar">
      <div className="flex gap-2 pb-2" style={{ minWidth: "max-content" }}>
        {FORECAST_HOURS.slice(0, 18).map(({ hour, rainfallProb, temp }) => (
          <div
            key={hour}
            className="flex flex-col items-center gap-1 rounded-xl bg-white/3 border border-white/5 px-3 py-2 min-w-[56px]"
          >
            <div className="text-xs text-white/40 font-mono">
              {hour.toString().padStart(2, "0")}:00
            </div>
            {/* Rain prob bar */}
            <div className="w-6 flex flex-col-reverse items-center" style={{ height: 40 }}>
              <div
                className="w-full rounded-full transition-all"
                style={{
                  height: `${rainfallProb}%`,
                  background:
                    rainfallProb > 70
                      ? "#ef4444"
                      : rainfallProb > 40
                      ? "#f59e0b"
                      : "#22c55e",
                  opacity: 0.8,
                }}
              />
            </div>
            <div className="text-xs font-semibold"
              style={{ color: rainfallProb > 70 ? "#ef4444" : rainfallProb > 40 ? "#f59e0b" : "#22c55e" }}>
              {rainfallProb}%
            </div>
            <div className="text-xs text-white/40">{temp}°</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FieldCard({ field }: { field: typeof DEMO_FIELDS[0] }) {
  const [expanded, setExpanded] = useState(false);
  const ndviColor = field.ndviScore > 0.6 ? "#22c55e" : field.ndviScore > 0.4 ? "#f59e0b" : "#ef4444";

  return (
    <motion.div
      layout
      className="rounded-2xl border border-white/8 bg-white/3 overflow-hidden cursor-pointer hover:border-green-500/30 transition-all"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold text-white text-sm">{field.name}</div>
            <div className="text-xs text-white/40 mt-0.5">
              {field.cropType} · {field.areaHa} ha
            </div>
          </div>
          <div className={`badge-risk-${field.status === "warning" ? "high" : "medium"} text-xs`}>
            {field.status === "warning" ? "⚠ Warning" : "⚡ Caution"}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-3">
          <div className="text-center">
            <div className="text-sm font-bold" style={{ color: ndviColor }}>
              {field.ndviScore.toFixed(2)}
            </div>
            <div className="text-xs text-white/30">NDVI</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-bold text-red-400">{field.floodRisk}%</div>
            <div className="text-xs text-white/30">Flood Risk</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-bold text-amber-400">{field.daysToHarvest}d</div>
            <div className="text-xs text-white/30">To Harvest</div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-white/5 p-4 space-y-2"
          >
            <div className="text-xs text-white/50 font-semibold mb-2">FIELD RECOMMENDATIONS</div>
            {[
              "🚿 Prepare drainage channels before rainfall",
              "📸 Last satellite scan shows healthy canopy — no disease detected",
              "🌾 Consider early harvest if flood risk exceeds 80%",
            ].map((rec, i) => (
              <div key={i} className="text-xs text-white/60 flex gap-2">
                <span>{rec}</span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function AIAdvisorTab() {
  const [messages, setMessages] = useState<{ role: "user" | "ai"; content: string }[]>([
    {
      role: "ai",
      content: `Good morning, ${DEMO_FARMER.name}! I'm your Agri-SHIELD AI Advisor. Based on your farm data:\n\n🌊 **Flood risk: 72%** — elevated for next 72 hours\n🧂 **Salinity EC: 3.4 dS/m** — moderate risk to rice\n☁️ **Weather:** 145mm rainfall expected\n\nI recommend immediate review of your harvest schedule. How can I help you today?`,
    },
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  const AI_RESPONSES: Record<string, string> = {
    "flood": `Based on your farm at **Barisal (72% flood probability)**:\n\n**Immediate actions (next 24h):**\n1. 🌾 Harvest any rice that's 80%+ mature — don't wait\n2. 🚜 Move farm equipment and tools to high ground\n3. 💧 Clear drainage channels now — remove any blockages\n\n**If flooding occurs:**\n- Rice submerged <3 days at 0.5m usually recovers\n- Apply Potassium (K2SO4) post-flood to speed recovery\n- Contact your field officer for emergency pump support\n\n📋 **Confidence: 87%** | Based on CHIRPS rainfall data + your field elevation`,
    "plant": `**Current planting assessment for your location:**\n\n🚫 **NOT RECOMMENDED** for the next 7 days\n\nReason: 72% flood probability makes seedling establishment risky. Flooded seedbeds in the first 2 weeks cause ~90% germination failure.\n\n✅ **Optimal window:** Days 8-14 from now (after expected rainfall clears)\n\n**Recommended variety:** BRRI dhan 52 (flood-tolerant) or BINA dhan 11 (salinity-tolerant)\n\nWould you like me to set an alert when the planting window opens?`,
    "salt": `**Salt-tolerant crop options for EC 3.4 dS/m:**\n\n| Crop | Tolerance | Risk Level |\n|------|-----------|------------|\n| Barley | 8.0 dS/m | ✅ Safe |\n| Sorghum | 4.0 dS/m | ✅ Safe |\n| Cotton | 7.7 dS/m | ✅ Safe |\n| BRRI dhan 47 | ~6.0 dS/m | ✅ Safe |\n| Regular Rice | 3.0 dS/m | ⚠️ Risky |\n\n**Soil remediation (before planting):**\n1. Apply gypsum: 2-4 tonnes/hectare\n2. Flush with 150-200mm freshwater if available\n3. Wait 2 weeks before planting\n\nShall I show you the nearest gypsum suppliers in Barisal?`,
    "drain": `**Emergency field drainage guide for ${DEMO_FARMER.name}:**\n\n**Priority sequence:**\n1. Open all field bunds (embankments) toward the nearest canal\n2. Use portable pump: 3-inch centrifugal pump can drain 2ha in ~4 hours\n3. Create V-shaped drainage channels toward the lowest corner\n\n**Government support available:**\n📞 Barisal DAE Office: 0431-XXXXXX\n🆘 Emergency pump request: Click "Request Resources" in your alerts\n\n**If no pump available:**\n- Prioritize fields closest to harvest\n- Rice can tolerate 72h of ankle-deep water\n- Jute actually tolerates waterlogging better — focus on rice first\n\nDo you want me to automatically send a pump request to your district officer?`,
  };

  const getAIResponse = (question: string): string => {
    const q = question.toLowerCase();
    if (q.includes("flood") || q.includes("warning")) return AI_RESPONSES["flood"];
    if (q.includes("plant") || q.includes("sow")) return AI_RESPONSES["plant"];
    if (q.includes("salt") || q.includes("salinity")) return AI_RESPONSES["salt"];
    if (q.includes("drain")) return AI_RESPONSES["drain"];
    return `I've analyzed your farm data at **Barisal District** (flood risk: 72%, EC: 3.4 dS/m).\n\nFor "${question}", here's my recommendation: Given current conditions, prioritize flood preparedness over the next 72 hours. Your rice field (North Paddy) is most at risk given its proximity to the river (3.2 km) and current soil saturation levels.\n\nWould you like specific action steps?`;
  };

  const handleSend = async (text?: string) => {
    const msg = text ?? input;
    if (!msg.trim()) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: msg }]);
    setIsTyping(true);
    await new Promise((r) => setTimeout(r, 1200 + Math.random() * 800));
    setIsTyping(false);
    setMessages((m) => [...m, { role: "ai", content: getAIResponse(msg) }]);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1" style={{ maxHeight: "calc(100vh - 400px)" }}>
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
            <div
              className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold"
              style={{
                background: msg.role === "ai" ? "linear-gradient(135deg, #22c55e, #16a34a)" : "rgba(255,255,255,0.1)",
              }}
            >
              {msg.role === "ai" ? "🛡" : DEMO_FARMER.name[0]}
            </div>
            <div
              className={`rounded-2xl px-4 py-3 text-sm max-w-xs sm:max-w-md ${
                msg.role === "user"
                  ? "bg-green-500/20 border border-green-500/20 text-white ml-auto"
                  : "bg-white/5 border border-white/8 text-white/80"
              }`}
            >
              {msg.content.split("\n").map((line, j) => (
                <p key={j} className={line.startsWith("**") ? "font-semibold text-white" : ""}
                  dangerouslySetInnerHTML={{
                    __html: line
                      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                      .replace(/✅|🚫|🌾|💧|🚜|📋|⚠️|📞|🆘|🌊|🧂|☁️/g, (m) => `<span>${m}</span>`),
                  }}
                />
              ))}
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-sm" style={{ background: "linear-gradient(135deg, #22c55e, #16a34a)" }}>
              🛡
            </div>
            <div className="bg-white/5 border border-white/8 rounded-2xl px-4 py-3">
              <div className="flex gap-1">
                {[0, 0.2, 0.4].map((delay) => (
                  <div key={delay} className="w-2 h-2 rounded-full bg-green-400 animate-bounce"
                    style={{ animationDelay: `${delay}s` }} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Quick prompts */}
      <div className="mt-4 flex gap-2 flex-wrap">
        {AI_ADVISOR_STARTERS.map((starter) => (
          <button
            key={starter}
            onClick={() => handleSend(starter)}
            className="text-xs px-3 py-1.5 rounded-lg border border-green-500/20 text-green-400 hover:bg-green-500/10 transition-all"
          >
            {starter}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="mt-3 flex gap-2">
        <button className="btn-ghost p-2.5 border border-white/10 rounded-xl">
          <Mic size={18} className="text-white/40" />
        </button>
        <div className="flex-1 flex gap-2 bg-white/5 border border-white/10 rounded-xl overflow-hidden">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Ask about your farm, crops, or weather..."
            className="flex-1 bg-transparent px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none"
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim()}
            className="px-4 text-green-400 hover:text-green-300 transition-colors disabled:opacity-30"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FarmerDashboardPage() {
  const [activeTab, setActiveTab] = useState("home");
  const [actioned, setActioned] = useState<string[]>([]);

  const tabs = [
    { id: "home", icon: Home, label: "Home" },
    { id: "map", icon: Map, label: "Map" },
    { id: "alerts", icon: Bell, label: "Alerts", badge: DEMO_ALERTS.length },
    { id: "advisor", icon: MessageSquare, label: "Advisor" },
    { id: "profile", icon: User, label: "Profile" },
  ];

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white flex flex-col">
      {/* Top header */}
      <header className="sticky top-0 z-40 glass-dark border-b border-white/5">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-green flex items-center justify-center">
              <Shield size={14} className="text-white" />
            </div>
            <span className="font-bold text-sm text-white">
              Agri<span className="text-green-400">-SHIELD</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-green-500/10 border border-green-500/20 rounded-full px-3 py-1">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-green-400 font-medium">Live</span>
            </div>
            <div className="w-8 h-8 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center text-sm font-bold text-green-400">
              {DEMO_FARMER.name[0]}
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto pb-20">
        <AnimatePresence mode="wait">
          {/* ── HOME TAB ── */}
          {activeTab === "home" && (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="p-4 space-y-5"
            >
              {/* Greeting */}
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-xl font-bold text-white">
                    Good morning, {DEMO_FARMER.name.split(" ")[0]}! 👋
                  </h1>
                  <p className="text-white/40 text-sm">{DEMO_FARMER.farmName} · {DEMO_FARMER.district}</p>
                </div>
                <button className="btn-ghost p-2">
                  <RefreshCcw size={16} className="text-white/40" />
                </button>
              </div>

              {/* Risk meters */}
              <div className="rounded-2xl border border-white/8 bg-white/3 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-white">Farm Risk Status</h2>
                  <div className="flex items-center gap-1 text-xs text-white/30">
                    <Satellite size={11} />
                    Updated {DEMO_RISK.lastSatelliteScan}
                  </div>
                </div>
                <div className="flex justify-around">
                  <RiskMeter
                    value={DEMO_RISK.floodRisk}
                    label="Flood Risk"
                    size="md"
                  />
                  <RiskMeter
                    value={DEMO_RISK.salinityRisk}
                    label="Salinity Risk"
                    size="md"
                  />
                  <div className="text-center">
                    <div className="text-4xl font-black text-green-400 mb-1">
                      {(DEMO_RISK.ndviScore * 100).toFixed(0)}
                    </div>
                    <div className="text-xs text-white/40">NDVI Score</div>
                    <div className="text-xs text-green-400 font-semibold">Healthy</div>
                  </div>
                </div>
              </div>

              {/* Weather today */}
              <div>
                <h2 className="text-sm font-semibold text-white mb-2">Today's Weather</h2>
                <WeatherCard />
              </div>

              {/* 24h forecast strip */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-semibold text-white">Rainfall Forecast (24h)</h2>
                  <span className="text-xs text-white/30">Probability %</span>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/3 p-3">
                  <ForecastStrip />
                </div>
              </div>

              {/* Active alerts */}
              {DEMO_ALERTS.filter((a) => a.isActive).length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-sm font-semibold text-white">
                      Active Alerts
                      <span className="ml-2 bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                        {DEMO_ALERTS.filter((a) => a.isActive).length}
                      </span>
                    </h2>
                    <button
                      onClick={() => setActiveTab("alerts")}
                      className="text-xs text-green-400 hover:text-green-300"
                    >
                      View all →
                    </button>
                  </div>
                  <div className="space-y-3">
                    {DEMO_ALERTS.slice(0, 2).map((alert) => (
                      <AlertCard
                        key={alert.id}
                        alert={alert}
                        onAction={(id) => setActioned((a) => [...a, id])}
                        compact
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* My fields */}
              <div>
                <h2 className="text-sm font-semibold text-white mb-2">My Fields</h2>
                <div className="space-y-3">
                  {DEMO_FIELDS.map((field) => (
                    <FieldCard key={field.id} field={field} />
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* ── MAP TAB ── */}
          {activeTab === "map" && (
            <motion.div
              key="map"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="relative"
              style={{ height: "calc(100vh - 112px)" }}
            >
              <FarmerMap />
            </motion.div>
          )}

          {/* ── ALERTS TAB ── */}
          {activeTab === "alerts" && (
            <motion.div
              key="alerts"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h1 className="text-xl font-bold text-white">Alert Center</h1>
                <div className="flex gap-2">
                  {["All", "Flood", "Salinity", "Weather"].map((f) => (
                    <button
                      key={f}
                      className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-white/50 hover:border-green-500/30 hover:text-green-400 transition-all"
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {DEMO_ALERTS.map((alert) => (
                  <div key={alert.id}>
                    <AlertCard
                      alert={alert}
                      onAction={(id) => {
                        setActioned((a) => [...a, id]);
                      }}
                    />
                    {actioned.includes(alert.id) && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        className="mt-2 px-4 py-2 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center gap-2 text-sm text-green-400"
                      >
                        <CheckCircle2 size={14} />
                        Marked as actioned — your response has been logged
                      </motion.div>
                    )}
                  </div>
                ))}
              </div>

              {/* Historical alerts */}
              <div className="pt-4 border-t border-white/8">
                <h2 className="text-sm font-semibold text-white/50 mb-3">Past 7 Days</h2>
                {[
                  { type: "Flood Watch", date: "5 days ago", outcome: "No flooding — precautions taken", saved: true },
                  { type: "Heavy Rain Advisory", date: "3 days ago", outcome: "Drainage prepared, 0% crop loss", saved: true },
                ].map(({ type, date, outcome, saved }, i) => (
                  <div key={i} className="flex items-center gap-3 py-3 border-b border-white/5">
                    <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                    <div className="flex-1">
                      <div className="text-sm text-white/50">{type}</div>
                      <div className="text-xs text-white/30">{date} · {outcome}</div>
                    </div>
                    {saved && <span className="badge-risk-low">✓ Actioned</span>}
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── AI ADVISOR TAB ── */}
          {activeTab === "advisor" && (
            <motion.div
              key="advisor"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 h-full flex flex-col"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-2xl bg-gradient-green flex items-center justify-center text-lg">
                  🛡
                </div>
                <div>
                  <h1 className="text-lg font-bold text-white">AI Farm Advisor</h1>
                  <p className="text-xs text-green-400">Context-aware · RAG-powered · 8 languages</p>
                </div>
                <div className="ml-auto flex items-center gap-1 bg-green-500/10 border border-green-500/20 rounded-full px-3 py-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-xs text-green-400">Online</span>
                </div>
              </div>
              <AIAdvisorTab />
            </motion.div>
          )}

          {/* ── PROFILE TAB ── */}
          {activeTab === "profile" && (
            <motion.div
              key="profile"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 space-y-5"
            >
              {/* Profile header */}
              <div className="rounded-2xl border border-white/8 bg-white/3 p-5 flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-green-500/20 border border-green-500/30 flex items-center justify-center text-2xl font-black text-green-400">
                  {DEMO_FARMER.name[0]}
                </div>
                <div>
                  <h2 className="font-bold text-white text-lg">{DEMO_FARMER.name}</h2>
                  <p className="text-sm text-white/50">{DEMO_FARMER.farmName}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="badge-risk-low">🌱 Farmer Pro</span>
                    <span className="text-xs text-white/30">{DEMO_FARMER.district}, {DEMO_FARMER.country}</span>
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { value: "3.5 ha", label: "Total Farm" },
                  { value: "2 fields", label: "Active Fields" },
                  { value: "87%", label: "Alert Response" },
                ].map(({ value, label }) => (
                  <div key={label} className="text-center rounded-xl border border-white/8 bg-white/3 p-3">
                    <div className="font-bold text-white text-base">{value}</div>
                    <div className="text-xs text-white/40">{label}</div>
                  </div>
                ))}
              </div>

              {/* Settings list */}
              <div className="rounded-2xl border border-white/8 bg-white/3 overflow-hidden">
                {[
                  { icon: Settings, label: "Edit Farm Profile", href: "#" },
                  { icon: Bell, label: "Notification Preferences", href: "#" },
                  { icon: Download, label: "Download My Data (CSV)", href: "#" },
                  { icon: Zap, label: "Upgrade to Farmer Pro", href: "/pricing", highlight: true },
                  { icon: LogOut, label: "Sign Out", href: "/auth/signin", danger: true },
                ].map(({ icon: Icon, label, href, highlight, danger }) => (
                  <Link
                    key={label}
                    href={href}
                    className={`flex items-center gap-3 px-4 py-3.5 border-b border-white/5 last:border-0 transition-colors ${
                      highlight ? "text-green-400 hover:bg-green-500/5" :
                      danger ? "text-red-400 hover:bg-red-500/5" :
                      "text-white/70 hover:text-white hover:bg-white/3"
                    }`}
                  >
                    <Icon size={16} />
                    <span className="text-sm font-medium">{label}</span>
                    <ChevronRight size={14} className="ml-auto opacity-40" />
                  </Link>
                ))}
              </div>

              {/* Subscription card */}
              <div className="rounded-2xl border border-green-500/20 bg-green-500/5 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-green-400">🌱 Farmer Free Plan</span>
                  <span className="text-xs text-white/30">Renews never</span>
                </div>
                <p className="text-xs text-white/50 mb-3">
                  Upgrade to Farmer Pro for 72h advance alerts, AI Advisor, and satellite scans.
                </p>
                <button className="btn-primary w-full py-2 text-sm">
                  Upgrade for ₹199/month
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Bottom navigation (mobile) */}
      <nav className="fixed bottom-0 inset-x-0 z-40 glass-dark border-t border-white/5">
        <div className="flex">
          {tabs.map(({ id, icon: Icon, label, badge }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-3 transition-colors relative ${
                activeTab === id ? "text-green-400" : "text-white/30 hover:text-white/60"
              }`}
            >
              <div className="relative">
                <Icon size={20} />
                {badge && badge > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium">{label}</span>
              {activeTab === id && (
                <motion.div
                  layoutId="tab-indicator"
                  className="absolute top-0 inset-x-4 h-0.5 rounded-full bg-green-400"
                />
              )}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
