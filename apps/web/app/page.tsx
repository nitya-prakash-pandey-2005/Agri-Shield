"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  Waves,
  Droplets,
  Satellite,
  Brain,
  Bell,
  Tractor,
  Building2,
  TruckIcon,
  ArrowRight,
  Shield,
  Globe2,
  ChevronDown,
  CheckCircle2,
  Star,
  Zap,
  BarChart3,
  Map,
  Smartphone,
} from "lucide-react";

const HeroGlobe = dynamic(
  () =>
    import("@/components/landing/HeroGlobe").then((m) => ({
      default: m.HeroGlobe,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center">
        <div className="w-80 h-80 rounded-full border border-green-500/20 animate-pulse-glow" />
      </div>
    ),
  }
);

// Animated counter hook
function useCounter(target: number, duration = 2000, start = false) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!start) return;
    let startTime: number | null = null;
    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 4);
      setCount(Math.round(eased * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration, start]);
  return count;
}

// Intersection observer hook
function useInView(threshold = 0.2) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setInView(true);
      },
      { threshold }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [threshold]);
  return { ref, inView };
}

// Live stats (simulated real data)
function LiveStats() {
  const { ref, inView } = useInView(0.3);
  const farmers = useCounter(15847, 2000, inView);
  const alerts = useCounter(2341, 1800, inView);
  const hectares = useCounter(892400, 2200, inView);

  return (
    <div ref={ref} className="flex items-center gap-6 flex-wrap">
      {[
        { value: farmers, suffix: "+", label: "Farmers Protected" },
        { value: alerts, suffix: "", label: "Alerts Sent This Week" },
        { value: hectares, suffix: "ha", label: "Land Monitored" },
      ].map(({ value, suffix, label }) => (
        <div key={label} className="flex items-center gap-3">
          <div
            className="w-2 h-2 rounded-full bg-green-400 animate-pulse"
          />
          <div>
            <span className="text-white font-bold tabular-nums text-sm">
              {value.toLocaleString("en-IN")}
              {suffix}
            </span>
            <span className="text-white/50 text-xs ml-1.5">{label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

const FEATURES_PIPELINE = [
  {
    step: "01",
    icon: Satellite,
    title: "Satellite + Sensor Data",
    description:
      "Sentinel-2 NDVI/NDWI imagery, CHIRPS rainfall, IoT soil sensors, and real-time river gauge readings are ingested every 30 minutes.",
    detail:
      "Open-Meteo API (hourly, 16-day) · SoilGrids 2.0 · GloFAS flood archive · ESA WorldCover · CMEMS sea level",
  },
  {
    step: "02",
    icon: Brain,
    title: "ML Risk Inference",
    description:
      "Hybrid LSTM + XGBoost models run flood prediction. LightGBM ensemble predicts EC levels for saltwater intrusion. All outputs include confidence intervals.",
    detail:
      "72h flood probability · EC forecast (7d / 30d / 90d) · NDVI health scoring · Supply chain overlap analysis",
  },
  {
    step: "03",
    icon: BarChart3,
    title: "Role-Specific Intelligence",
    description:
      "Raw predictions are transformed into context-specific insights for each stakeholder — actionable, prioritized, and in their local language.",
    detail:
      "8 languages · RAG-powered AI advisor · Government resource plans · Supply chain disruption scenarios",
  },
  {
    step: "04",
    icon: Bell,
    title: "Proactive Action",
    description:
      "Alerts reach farmers via SMS/WhatsApp within 30 seconds. Governments get one-click resource dispatch. Supply chains get automated ERP webhooks.",
    detail:
      "Twilio SMS · WhatsApp Business · FCM push · Email · API webhooks · Offline PWA fallback",
  },
];

const PORTALS = [
  {
    id: "farmer",
    icon: Tractor,
    title: "Farmer Portal",
    subtitle: "Mobile-first · PWA · 8 languages",
    color: "#22c55e",
    gradient: "from-green-500/20 to-emerald-900/20",
    border: "border-green-500/20 hover:border-green-500/50",
    features: [
      "72h advance flood & salinity warnings",
      "AI Farm Advisor (RAG-powered, voice input)",
      "Satellite field health scanning (NDVI)",
      "Personalized crop recommendations",
      "SMS + WhatsApp alerts in local language",
      "Offline PWA — works without internet",
    ],
    cta: "Start Free",
    href: "/auth/signup?role=farmer",
  },
  {
    id: "government",
    icon: Building2,
    title: "Government Portal",
    subtitle: "District · Province · National level",
    color: "#10b981",
    gradient: "from-emerald-500/20 to-teal-900/20",
    border: "border-emerald-500/20 hover:border-emerald-500/50",
    features: [
      "National / provincial / district dashboards",
      "One-click resource dispatch workflow",
      "Multi-channel alert broadcasting",
      "AI-generated policy briefs",
      "Season-over-season crop loss analytics",
      "API access for ministry systems",
    ],
    cta: "Request Demo",
    href: "/auth/signup?role=government",
  },
  {
    id: "supply-chain",
    icon: TruckIcon,
    title: "Supply Chain Portal",
    subtitle: "Commodity · Route · Risk Intelligence",
    color: "#f59e0b",
    gradient: "from-amber-500/20 to-orange-900/20",
    border: "border-amber-500/20 hover:border-amber-500/50",
    features: [
      "Real-time commodity flood risk scoring",
      "Monte Carlo disruption scenario modeling",
      "Alternative supplier routing map",
      "Price impact forecasting (7/14/30 days)",
      "ERP webhook integration",
      "Forward contract hedge recommendations",
    ],
    cta: "See Pricing",
    href: "/auth/signup?role=supply_chain",
  },
];

const PRICING = [
  {
    name: "Farmer Free",
    price: "₹0",
    period: "/month",
    color: "#22c55e",
    description: "Essential protection for smallholders",
    features: [
      "2 farm fields (max 10 ha)",
      "24h advance flood alerts",
      "7-day weather forecast",
      "5 SMS alerts/month",
      "English only",
    ],
    cta: "Get Started Free",
    href: "/auth/signup?role=farmer&plan=free",
    highlighted: false,
  },
  {
    name: "Farmer Pro",
    price: "₹199",
    period: "/month",
    color: "#22c55e",
    description: "Full protection for serious farmers",
    features: [
      "Unlimited fields",
      "72h advance flood + salinity alerts",
      "AI Advisor (50 queries/month)",
      "All 8 languages",
      "Weekly satellite field scans",
      "WhatsApp alerts",
      "Crop insurance recommendations",
    ],
    cta: "Start 14-Day Free Trial",
    href: "/auth/signup?role=farmer&plan=farmer_pro",
    highlighted: true,
    badge: "Most Popular",
  },
  {
    name: "Government Basic",
    price: "$299",
    period: "/month per agency",
    color: "#10b981",
    description: "Provincial-level climate coordination",
    features: [
      "Regional dashboard (1 province)",
      "Alert broadcasting to farmers",
      "Resource tracking",
      "Monthly PDF reports",
      "API access",
    ],
    cta: "Contact Sales",
    href: "/auth/signup?role=government&plan=gov_basic",
    highlighted: false,
  },
  {
    name: "Supply Chain",
    price: "$499",
    period: "/month",
    color: "#f59e0b",
    description: "Commodity & logistics risk intelligence",
    features: [
      "10 commodity risk tracks",
      "Scenario modeling (Monte Carlo)",
      "ERP webhook integration",
      "Alternative supplier intelligence",
      "Dedicated onboarding support",
    ],
    cta: "Start Trial",
    href: "/auth/signup?role=supply_chain&plan=supply_chain",
    highlighted: false,
  },
];

const IMPACT_STATS = [
  { value: "15,000+", label: "Farmers Onboarded", icon: Tractor },
  { value: "23", label: "Government Agencies", icon: Building2 },
  { value: "₹450 Cr", label: "Crop Loss Prevented (Simulated)", icon: Shield },
  { value: "72h", label: "Average Warning Lead Time", icon: Zap },
];

const TESTIMONIALS = [
  {
    name: "Ratan Das",
    role: "Rice farmer, Barisal District, Bangladesh",
    content:
      "I received the flood warning 3 days before it hit. I was able to harvest 60% of my crop early and move it to high ground. Without Agri-SHIELD I would have lost everything.",
    rating: 5,
    avatar: "RD",
    region: "🇧🇩",
  },
  {
    name: "Dr. Nguyen Thi Lan",
    role: "Deputy Director, Vietnam MARD",
    content:
      "The government dashboard gives us an unprecedented view of risk across all provinces. We dispatched pumping equipment 48 hours before the Mekong Delta flood and saved an estimated 12,000 tonnes of rice.",
    rating: 5,
    avatar: "NL",
    region: "🇻🇳",
  },
  {
    name: "Krishnamurthy R.",
    role: "Procurement Head, South India Agri Trading Co.",
    content:
      "The commodity risk tracker flagged Odisha rice disruption risk 14 days in advance. We secured forward contracts at pre-surge prices. Saved $2.1M in procurement costs.",
    rating: 5,
    avatar: "KR",
    region: "🇮🇳",
  },
];

export default function LandingPage() {
  const [activePortal, setActivePortal] = useState<number | null>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll();
  const heroOpacity = useTransform(scrollY, [0, 600], [1, 0]);
  const heroY = useTransform(scrollY, [0, 600], [0, -80]);

  return (
    <div className="relative overflow-x-hidden">
      {/* ── Navigation ─────────────────────────────────────── */}
      <nav className="fixed top-0 inset-x-0 z-50">
        <div className="glass-dark border-b border-white/5">
          <div className="container flex h-16 items-center justify-between">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-green flex items-center justify-center">
                <Shield size={18} className="text-white" />
              </div>
              <span className="font-bold text-lg text-white">
                Agri<span className="text-green-400">-SHIELD</span>
              </span>
            </Link>

            <div className="hidden md:flex items-center gap-8">
              {["How It Works", "Portals", "Pricing", "About"].map((item) => (
                <a
                  key={item}
                  href={`#${item.toLowerCase().replace(" ", "-")}`}
                  className="text-sm text-white/60 hover:text-white transition-colors"
                >
                  {item}
                </a>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/auth/signin"
                className="text-sm text-white/70 hover:text-white transition-colors"
              >
                Sign In
              </Link>
              <Link href="/auth/signup" className="btn-primary py-2 px-4 text-xs">
                Get Started Free
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* ═══════════════════════════════════════════════════════
          HERO SECTION
         ═══════════════════════════════════════════════════════ */}
      <section
        ref={heroRef}
        className="relative min-h-screen gradient-hero flex items-center overflow-hidden"
        id="hero"
      >
        {/* Background grid */}
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `linear-gradient(rgba(34,197,94,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(34,197,94,0.3) 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />

        {/* Radial glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 70% 50%, rgba(34,197,94,0.08) 0%, transparent 70%)",
          }}
        />

        <motion.div
          style={{ opacity: heroOpacity, y: heroY }}
          className="container relative z-10 grid lg:grid-cols-2 gap-12 items-center py-32"
        >
          {/* Left — Copy */}
          <div className="space-y-8">
            {/* Tag */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <span className="section-tag">
                <Globe2 size={12} />
                Asian Hackathon for Green Future 2026
              </span>
            </motion.div>

            {/* Headline */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="space-y-3"
            >
              <h1 className="gradient-text-hero text-balance">
                Act Before the Flood Hits.
              </h1>
              <h1 className="text-white/80 text-balance">
                Save Before the Salt Spreads.
              </h1>
            </motion.div>

            {/* Subheadline */}
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="text-lg text-white/60 max-w-xl leading-relaxed"
            >
              Agri-SHIELD turns climate satellite data into{" "}
              <span className="text-green-400 font-semibold">
                role-specific, real-time, actionable intelligence
              </span>{" "}
              for farmers, governments, and supply chains across Asia —{" "}
              <strong className="text-white">72 hours before the disaster strikes.</strong>
            </motion.p>

            {/* CTAs */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="flex flex-wrap gap-4"
            >
              <Link href="/auth/signup?role=farmer" className="btn-primary">
                <Tractor size={18} />
                Start Free for Farmers
              </Link>
              <Link href="/auth/signup?role=government" className="btn-outline">
                <Building2 size={18} />
                Request Government Demo
              </Link>
            </motion.div>

            {/* Live Stats */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
            >
              <LiveStats />
            </motion.div>
          </div>

          {/* Right — Globe */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3, duration: 0.8, ease: "easeOut" }}
            className="relative w-full aspect-square max-w-xl mx-auto"
          >
            <div className="absolute inset-0 rounded-full"
              style={{
                background: "radial-gradient(circle, rgba(34,197,94,0.06) 0%, transparent 70%)",
              }}
            />
            <HeroGlobe />

            {/* Floating risk badges */}
            <motion.div
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              className="absolute top-8 left-0 glass-dark rounded-xl px-3 py-2 text-xs"
            >
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-red-400 font-semibold">Flood Warning</span>
              </div>
              <div className="text-white/60 mt-0.5">Ganges Delta · 78% probability</div>
            </motion.div>

            <motion.div
              animate={{ y: [0, 8, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 1 }}
              className="absolute bottom-16 right-0 glass-dark rounded-xl px-3 py-2 text-xs"
            >
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-amber-400 font-semibold">Salinity Alert</span>
              </div>
              <div className="text-white/60 mt-0.5">Mekong Delta · EC 4.2 dS/m</div>
            </motion.div>

            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut", delay: 2 }}
              className="absolute top-1/2 right-2 glass-dark rounded-xl px-3 py-2 text-xs"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 size={12} className="text-green-400" />
                <span className="text-green-400 font-semibold">Alert Sent</span>
              </div>
              <div className="text-white/60 mt-0.5">1,240 farmers notified</div>
            </motion.div>
          </motion.div>
        </motion.div>

        {/* Scroll indicator */}
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 text-white/30"
        >
          <ChevronDown size={24} />
        </motion.div>
      </section>

      {/* ═══════════════════════════════════════════════════════
          PROBLEM SECTION
         ═══════════════════════════════════════════════════════ */}
      <section className="py-32 bg-black/20" id="problem">
        <div className="container">
          <div className="text-center mb-16 space-y-4">
            <span className="section-tag">The Problem</span>
            <h2 className="text-white text-balance">
              $27B Lost Every Year to Floods & Salinity —
              <br />
              <span className="gradient-text">Because Farmers Have No Warning</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {/* WITHOUT */}
            <motion.div
              initial={{ opacity: 0, x: -40 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="rounded-2xl p-8 border border-red-500/20 bg-red-500/5"
            >
              <div className="text-red-400 font-bold text-sm uppercase tracking-wider mb-4">
                ❌ Without Agri-SHIELD
              </div>
              <div className="space-y-4 text-sm">
                {[
                  "Farmer learns about flood when water reaches ankles",
                  "Government dispatches resources after the disaster",
                  "Supply chain scrambles for alternatives with 0 warning",
                  "72% of avoidable crop loss happens in the first 24 hours",
                  "Insurance claims take months, livelihoods destroyed",
                  "SMS alerts are generic, impractical, ignored",
                ].map((item, i) => (
                  <div key={i} className="flex gap-3 text-white/70">
                    <span className="text-red-500 flex-shrink-0 mt-0.5">✗</span>
                    {item}
                  </div>
                ))}
              </div>
              <div className="mt-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
                <div className="text-2xl font-black text-red-400">$27B</div>
                <div className="text-xs text-white/50">Annual crop loss from flooding + salinity (Asia)</div>
              </div>
            </motion.div>

            {/* WITH */}
            <motion.div
              initial={{ opacity: 0, x: 40 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="rounded-2xl p-8 border border-green-500/20 bg-green-500/5"
            >
              <div className="text-green-400 font-bold text-sm uppercase tracking-wider mb-4">
                ✅ With Agri-SHIELD
              </div>
              <div className="space-y-4 text-sm">
                {[
                  "72-hour advance flood probability with field-level precision",
                  "Government pre-positions pumps and sandbags 2 days early",
                  "Supply chain secures alternatives before disruption hits",
                  "AI Advisor tells farmer exactly what to do, in their language",
                  "Insurance recommendations triggered automatically on alert",
                  "Offline PWA works in flood zones with no connectivity",
                ].map((item, i) => (
                  <div key={i} className="flex gap-3 text-white/70">
                    <CheckCircle2 size={14} className="text-green-500 flex-shrink-0 mt-0.5" />
                    {item}
                  </div>
                ))}
              </div>
              <div className="mt-6 p-4 rounded-xl bg-green-500/10 border border-green-500/20">
                <div className="text-2xl font-black text-green-400">72h</div>
                <div className="text-xs text-white/50">Average advance warning window</div>
              </div>
            </motion.div>
          </div>

          {/* Big stat callouts */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-16">
            {IMPACT_STATS.map(({ value, label, icon: Icon }, i) => (
              <motion.div
                key={label}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="text-center p-6 rounded-2xl glass border border-white/5"
              >
                <Icon size={24} className="text-green-400 mx-auto mb-3" />
                <div className="text-3xl font-black text-white">{value}</div>
                <div className="text-xs text-white/50 mt-1">{label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════
          HOW IT WORKS
         ═══════════════════════════════════════════════════════ */}
      <section className="py-32" id="how-it-works">
        <div className="container">
          <div className="text-center mb-16 space-y-4">
            <span className="section-tag">How It Works</span>
            <h2 className="text-white">
              From Satellite to{" "}
              <span className="gradient-text">Farmer's Phone</span>
              <br />in Under 30 Minutes
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {FEATURES_PIPELINE.map(({ step, icon: Icon, title, description, detail }, i) => (
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.15 }}
                className="relative group"
              >
                {/* Connector line */}
                {i < FEATURES_PIPELINE.length - 1 && (
                  <div className="hidden lg:block absolute top-8 left-full w-full h-px bg-gradient-to-r from-green-500/50 to-transparent z-0" />
                )}

                <div className="relative z-10 card-hover h-full p-6 bg-white/3 border-white/5 hover:border-green-500/20 group-hover:bg-green-500/3">
                  <div className="text-xs font-bold text-green-500/50 mb-4">{step}</div>
                  <div className="w-12 h-12 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center justify-center mb-4 group-hover:bg-green-500/20 transition-colors">
                    <Icon size={22} className="text-green-400" />
                  </div>
                  <h3 className="text-white font-bold text-base mb-2">{title}</h3>
                  <p className="text-sm text-white/60 mb-4">{description}</p>
                  <div className="text-xs text-white/30 border-t border-white/5 pt-3 leading-relaxed">
                    {detail}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════
          THREE PORTALS
         ═══════════════════════════════════════════════════════ */}
      <section className="py-32 bg-black/20" id="portals">
        <div className="container">
          <div className="text-center mb-16 space-y-4">
            <span className="section-tag">Three Portals. One Platform.</span>
            <h2 className="text-white">
              Built for Every Stakeholder in{" "}
              <span className="gradient-text">Asia's Food System</span>
            </h2>
            <p className="text-white/50 max-w-2xl mx-auto">
              Whether you're protecting a 2-hectare rice field, coordinating
              district-level evacuation, or managing a $500M commodity supply chain — Agri-SHIELD has a purpose-built portal for you.
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {PORTALS.map((portal, i) => {
              const Icon = portal.icon;
              const isActive = activePortal === i;
              return (
                <motion.div
                  key={portal.id}
                  initial={{ opacity: 0, y: 40 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.15 }}
                  onHoverStart={() => setActivePortal(i)}
                  onHoverEnd={() => setActivePortal(null)}
                  className={`rounded-2xl p-8 border transition-all duration-300 cursor-pointer bg-gradient-to-b ${portal.gradient} ${portal.border} ${isActive ? "shadow-lg scale-[1.02]" : ""}`}
                >
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6"
                    style={{ background: `${portal.color}20`, border: `1px solid ${portal.color}30` }}
                  >
                    <Icon size={26} style={{ color: portal.color }} />
                  </div>

                  <div className="mb-1">
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: `${portal.color}15`, color: portal.color }}
                    >
                      {portal.subtitle}
                    </span>
                  </div>
                  <h3 className="text-2xl font-bold text-white mt-3 mb-4">
                    {portal.title}
                  </h3>

                  <ul className="space-y-2.5 mb-8">
                    {portal.features.map((f, j) => (
                      <li key={j} className="flex items-start gap-2.5 text-sm text-white/70">
                        <CheckCircle2
                          size={14}
                          style={{ color: portal.color }}
                          className="flex-shrink-0 mt-0.5"
                        />
                        {f}
                      </li>
                    ))}
                  </ul>

                  <Link
                    href={portal.href}
                    className="inline-flex items-center gap-2 text-sm font-semibold transition-all"
                    style={{ color: portal.color }}
                  >
                    {portal.cta}
                    <ArrowRight size={16} className={isActive ? "translate-x-1" : ""} style={{ transition: "transform 0.2s" }} />
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════
          LIVE DEMO MAP TEASER
         ═══════════════════════════════════════════════════════ */}
      <section className="py-32" id="demo">
        <div className="container">
          <div className="text-center mb-12 space-y-4">
            <span className="section-tag">
              <Map size={12} />
              Live Demo
            </span>
            <h2 className="text-white">
              Real Climate Risk Data —{" "}
              <span className="gradient-text">Right Now</span>
            </h2>
            <p className="text-white/50 max-w-xl mx-auto">
              No login required. Explore active flood and salinity risk zones across Asia's most vulnerable agricultural regions.
            </p>
          </div>

          <div className="relative rounded-3xl overflow-hidden border border-white/10 shadow-2xl" style={{ minHeight: 500 }}>
            {/* Overlay gradient */}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/50 z-10 pointer-events-none" />

            {/* Map embed placeholder — real Leaflet map is in the dashboard */}
            <div
              className="w-full"
              style={{
                height: 500,
                background: "linear-gradient(135deg, #0a1929 0%, #0d2818 50%, #0a1929 100%)",
              }}
            >
              {/* Simulated map visual */}
              <div className="relative w-full h-full flex items-center justify-center">
                <div className="text-center space-y-4">
                  <div className="w-20 h-20 rounded-full border-2 border-green-500/30 mx-auto flex items-center justify-center animate-pulse">
                    <Map size={32} className="text-green-400" />
                  </div>
                  <div className="text-white/60 text-sm">
                    Interactive climate map loads in dashboard
                  </div>
                  <Link href="/dashboard/farmer" className="btn-primary inline-flex">
                    <Map size={16} />
                    Open Live Map
                  </Link>
                </div>
              </div>
            </div>

            {/* Risk legend */}
            <div className="absolute bottom-4 left-4 z-20 glass-dark rounded-xl p-3">
              <div className="text-xs text-white/50 mb-2 font-semibold">RISK LEVEL</div>
              {[
                { color: "#22c55e", label: "Low" },
                { color: "#f59e0b", label: "Medium" },
                { color: "#ef4444", label: "High" },
                { color: "#7c3aed", label: "Critical" },
              ].map(({ color, label }) => (
                <div key={label} className="flex items-center gap-2 text-xs text-white/70 mb-1">
                  <div className="w-3 h-3 rounded-sm" style={{ background: color }} />
                  {label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════
          TESTIMONIALS
         ═══════════════════════════════════════════════════════ */}
      <section className="py-32 bg-black/20">
        <div className="container">
          <div className="text-center mb-16 space-y-4">
            <span className="section-tag">Impact Stories</span>
            <h2 className="text-white">
              Real People.{" "}
              <span className="gradient-text">Real Outcomes.</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="card-hover p-6 bg-white/3 border-white/5"
              >
                <div className="flex mb-3">
                  {Array.from({ length: t.rating }).map((_, j) => (
                    <Star key={j} size={14} className="text-amber-400 fill-amber-400" />
                  ))}
                </div>
                <p className="text-white/70 text-sm leading-relaxed mb-6">
                  &ldquo;{t.content}&rdquo;
                </p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center text-sm font-bold text-green-400">
                    {t.avatar}
                  </div>
                  <div>
                    <div className="text-white font-semibold text-sm">
                      {t.region} {t.name}
                    </div>
                    <div className="text-white/40 text-xs">{t.role}</div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════
          PRICING
         ═══════════════════════════════════════════════════════ */}
      <section className="py-32" id="pricing">
        <div className="container">
          <div className="text-center mb-16 space-y-4">
            <span className="section-tag">Pricing</span>
            <h2 className="text-white">
              Protect Your Livelihood.{" "}
              <span className="gradient-text">Start Free.</span>
            </h2>
            <p className="text-white/50 max-w-xl mx-auto">
              14-day free trial on all paid plans. No credit card required. Farmers in Bangladesh get subsidized rates — contact us.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {PRICING.map((plan, i) => (
              <motion.div
                key={plan.name}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className={`relative rounded-2xl p-6 border transition-all ${
                  plan.highlighted
                    ? "border-green-500/50 bg-green-500/5 scale-105"
                    : "border-white/10 bg-white/2 hover:border-white/20"
                }`}
              >
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="bg-green-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                      {plan.badge}
                    </span>
                  </div>
                )}

                <div className="mb-4">
                  <div className="text-sm font-bold text-white/70 mb-1">{plan.name}</div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-black text-white">{plan.price}</span>
                    <span className="text-xs text-white/40">{plan.period}</span>
                  </div>
                  <div className="text-xs text-white/40 mt-1">{plan.description}</div>
                </div>

                <ul className="space-y-2 mb-6">
                  {plan.features.map((f, j) => (
                    <li key={j} className="flex items-start gap-2 text-xs text-white/60">
                      <CheckCircle2 size={12} style={{ color: plan.color }} className="flex-shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>

                <Link
                  href={plan.href}
                  className="block w-full text-center text-sm font-semibold py-2.5 rounded-xl transition-all"
                  style={
                    plan.highlighted
                      ? {
                          background: `linear-gradient(135deg, ${plan.color}, #16a34a)`,
                          color: "white",
                          boxShadow: `0 4px 14px ${plan.color}40`,
                        }
                      : {
                          border: `1px solid ${plan.color}40`,
                          color: plan.color,
                        }
                  }
                >
                  {plan.cta}
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════
          CTA SECTION
         ═══════════════════════════════════════════════════════ */}
      <section className="py-32 relative overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(34,197,94,0.12) 0%, transparent 70%)",
          }}
        />
        <div className="container relative text-center space-y-8">
          <h2 className="text-white max-w-3xl mx-auto text-balance">
            The Next Flood Doesn't Wait.
            <br />
            <span className="gradient-text">Neither Should You.</span>
          </h2>
          <p className="text-white/50 max-w-xl mx-auto">
            Join 15,000+ farmers, 23 government agencies, and hundreds of supply chain operators already using Agri-SHIELD to stay ahead of climate risk.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Link href="/auth/signup" className="btn-primary text-base px-8 py-4">
              <Shield size={20} />
              Start Protecting Your Farm — Free
            </Link>
            <Link href="/pitch" className="btn-outline text-base px-8 py-4">
              <Smartphone size={20} />
              View Hackathon Pitch
            </Link>
          </div>
          <p className="text-xs text-white/30">
            No credit card required · Farmer accounts always free · 14-day trial on Pro plans
          </p>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════
          FOOTER
         ═══════════════════════════════════════════════════════ */}
      <footer className="border-t border-white/5 py-16">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
            {/* Brand */}
            <div className="col-span-2">
              <Link href="/" className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-lg bg-gradient-green flex items-center justify-center">
                  <Shield size={18} className="text-white" />
                </div>
                <span className="font-bold text-lg text-white">
                  Agri<span className="text-green-400">-SHIELD</span>
                </span>
              </Link>
              <p className="text-sm text-white/40 max-w-xs">
                AI-powered climate decision intelligence for farmers, governments, and supply chains across Asia.
              </p>
              <div className="flex gap-3 mt-4">
                {["SDG 2", "SDG 13", "SDG 17"].map((sdg) => (
                  <span
                    key={sdg}
                    className="text-xs px-2 py-1 rounded-lg border border-green-500/20 text-green-400"
                  >
                    {sdg}
                  </span>
                ))}
              </div>
            </div>

            {/* Links */}
            {[
              {
                title: "Platform",
                links: ["Farmer Portal", "Government Portal", "Supply Chain Portal", "Pitch Page"],
              },
              {
                title: "Resources",
                links: ["Documentation", "API Reference", "Methodology", "Data Sources"],
              },
              {
                title: "Company",
                links: ["About", "Blog", "Careers", "Contact"],
              },
            ].map(({ title, links }) => (
              <div key={title}>
                <h4 className="text-sm font-semibold text-white mb-4">{title}</h4>
                <ul className="space-y-2.5">
                  {links.map((link) => (
                    <li key={link}>
                      <a
                        href="#"
                        className="text-sm text-white/40 hover:text-white/70 transition-colors"
                      >
                        {link}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="border-t border-white/5 pt-8 flex flex-wrap items-center justify-between gap-4">
            <p className="text-xs text-white/30">
              © 2026 Agri-SHIELD. Built for Asian Hackathon for Green Future 2026.
            </p>
            <div className="flex gap-6">
              {["Privacy Policy", "Terms of Service", "Cookie Policy"].map((item) => (
                <a key={item} href="#" className="text-xs text-white/30 hover:text-white/60 transition-colors">
                  {item}
                </a>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
