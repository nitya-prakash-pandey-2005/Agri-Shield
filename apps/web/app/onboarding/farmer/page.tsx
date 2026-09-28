"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  User, MapPin, Sprout, Map, Bell, ChevronRight, ChevronLeft,
  Shield, Check, Loader2, Leaf, Wheat, Fish, Trees,
  Droplets, Wind, Sun
} from "lucide-react";
import confetti from "canvas-confetti";

const CROPS = [
  { id: "rice", label: "Rice", icon: "🌾", color: "#22c55e" },
  { id: "wheat", label: "Wheat", icon: "🌿", color: "#f59e0b" },
  { id: "maize", label: "Maize", icon: "🌽", color: "#fb923c" },
  { id: "sugarcane", label: "Sugarcane", icon: "🎋", color: "#84cc16" },
  { id: "jute", label: "Jute", icon: "🪢", color: "#a8a29e" },
  { id: "coconut", label: "Coconut", icon: "🥥", color: "#78716c" },
  { id: "vegetables", label: "Vegetables", icon: "🥬", color: "#4ade80" },
  { id: "banana", label: "Banana", icon: "🍌", color: "#fde68a" },
  { id: "mango", label: "Mango", icon: "🥭", color: "#fb7185" },
  { id: "potato", label: "Potato", icon: "🥔", color: "#d97706" },
  { id: "onion", label: "Onion", icon: "🧅", color: "#c084fc" },
  { id: "cotton", label: "Cotton", icon: "🌸", color: "#e0e7ff" },
];

const COUNTRIES = [
  "Bangladesh", "India", "Vietnam", "Philippines",
  "Indonesia", "Sri Lanka", "Myanmar", "Thailand",
  "Cambodia", "Pakistan", "Nepal",
];

const STEPS = [
  { id: 1, icon: User, label: "Personal Info" },
  { id: 2, icon: Sprout, label: "Farm Setup" },
  { id: 3, icon: Map, label: "Your Fields" },
  { id: 4, icon: Shield, label: "Risk Profile" },
  { id: 5, icon: Bell, label: "Notifications" },
];

export default function FarmerOnboardingPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  const [personalInfo, setPersonalInfo] = useState({
    name: "",
    district: "",
    country: "Bangladesh",
    experienceYears: "",
    language: "en",
  });

  const [farmInfo, setFarmInfo] = useState({
    farmName: "",
    totalArea: "",
    selectedCrops: [] as string[],
  });

  const [riskProfile, setRiskProfile] = useState({
    hasFloodHistory: null as boolean | null,
    floodFrequency: "",
    hasSalinityHistory: null as boolean | null,
    hasInsurance: null as boolean | null,
  });

  const [notifications, setNotifications] = useState({
    flood: true,
    salinity: true,
    planting: true,
    weather: true,
    channelSMS: true,
    channelWhatsApp: false,
    channelEmail: false,
    threshold: "medium",
    timing: "immediate",
  });

  const toggleCrop = (cropId: string) => {
    setFarmInfo((prev) => ({
      ...prev,
      selectedCrops: prev.selectedCrops.includes(cropId)
        ? prev.selectedCrops.filter((c) => c !== cropId)
        : [...prev.selectedCrops, cropId],
    }));
  };

  const handleComplete = async () => {
    setIsLoading(true);
    await new Promise((r) => setTimeout(r, 1500));
    setIsLoading(false);
    setIsComplete(true);
    // Confetti!
    confetti({
      particleCount: 200,
      spread: 80,
      origin: { y: 0.5 },
      colors: ["#22c55e", "#16a34a", "#86efac", "#4ade80", "#f59e0b"],
    });
    setTimeout(() => router.push("/dashboard/farmer"), 3000);
  };

  const progress = ((currentStep - 1) / (STEPS.length - 1)) * 100;

  if (isComplete) {
    return (
      <div className="min-h-screen gradient-hero flex items-center justify-center p-4">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-center space-y-6 max-w-md"
        >
          <div className="w-24 h-24 rounded-full bg-green-500/20 border-2 border-green-500 flex items-center justify-center mx-auto">
            <Check size={44} className="text-green-400" />
          </div>
          <h1 className="text-3xl font-black text-white">
            Welcome to Agri-SHIELD! 🎉
          </h1>
          <p className="text-white/60">
            Your farm profile is set up. Here are your first 3 personalized recommendations:
          </p>
          {[
            { icon: "🌊", text: "Flood risk is LOW this week — safe to proceed with planned irrigation", priority: "low" },
            { icon: "🌱", text: "Optimal planting window opens in 5 days — prepare seedbeds now", priority: "medium" },
            { icon: "💧", text: "Soil salinity in your district trending upward — monitor EC levels", priority: "medium" },
          ].map(({ icon, text, priority }, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 + i * 0.2 }}
              className="text-left p-4 rounded-xl bg-white/5 border border-white/10 flex gap-3"
            >
              <span className="text-2xl">{icon}</span>
              <span className="text-sm text-white/70">{text}</span>
            </motion.div>
          ))}
          <p className="text-white/40 text-sm">Redirecting to your dashboard...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen gradient-hero flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2">
            <Shield size={24} className="text-green-400" />
            <span className="font-bold text-xl text-white">
              Agri<span className="text-green-400">-SHIELD</span>
            </span>
          </div>
        </div>

        {/* Step indicator */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            {STEPS.map(({ id, icon: Icon, label }) => (
              <div
                key={id}
                className={`flex flex-col items-center gap-1 ${
                  id <= currentStep ? "opacity-100" : "opacity-30"
                }`}
              >
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                    id < currentStep
                      ? "bg-green-500 text-white"
                      : id === currentStep
                      ? "bg-green-500/20 border-2 border-green-500 text-green-400"
                      : "bg-white/5 border border-white/10 text-white/30"
                  }`}
                >
                  {id < currentStep ? <Check size={16} /> : <Icon size={14} />}
                </div>
                <span className="text-xs text-white/50 hidden sm:block">{label}</span>
              </div>
            ))}
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gradient-green"
              animate={{ width: `${progress}%` }}
              transition={{ ease: "easeInOut" }}
            />
          </div>
          <div className="text-right text-xs text-white/30 mt-1">
            Step {currentStep} of {STEPS.length}
          </div>
        </div>

        {/* Steps */}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="glass-dark rounded-3xl p-8 border border-white/8"
          >
            {/* ── Step 1: Personal Info ── */}
            {currentStep === 1 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-white mb-1">Welcome! Tell us about yourself</h2>
                  <p className="text-white/50 text-sm">We use this to personalize your alerts</p>
                </div>
                <div className="grid gap-4">
                  <div>
                    <label className="text-xs text-white/50 font-medium mb-1.5 block">Your Name</label>
                    <input
                      value={personalInfo.name}
                      onChange={(e) => setPersonalInfo((p) => ({ ...p, name: e.target.value }))}
                      className="input-base bg-white/5 border-white/10 text-white placeholder:text-white/20"
                      placeholder="Enter your full name"
                    />
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-white/50 font-medium mb-1.5 block">District / Upazila</label>
                      <input
                        value={personalInfo.district}
                        onChange={(e) => setPersonalInfo((p) => ({ ...p, district: e.target.value }))}
                        className="input-base bg-white/5 border-white/10 text-white placeholder:text-white/20"
                        placeholder="e.g. Barisal, Sylhet"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-white/50 font-medium mb-1.5 block">Country</label>
                      <select
                        value={personalInfo.country}
                        onChange={(e) => setPersonalInfo((p) => ({ ...p, country: e.target.value }))}
                        className="input-base bg-white/5 border-white/10 text-white"
                      >
                        {COUNTRIES.map((c) => (
                          <option key={c} value={c} className="bg-gray-900">{c}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-white/50 font-medium mb-1.5 block">Years of Farming Experience</label>
                    <input
                      type="number"
                      value={personalInfo.experienceYears}
                      onChange={(e) => setPersonalInfo((p) => ({ ...p, experienceYears: e.target.value }))}
                      className="input-base bg-white/5 border-white/10 text-white"
                      placeholder="e.g. 15"
                      min="0" max="70"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-white/50 font-medium mb-1.5 block">Preferred Language</label>
                    <select
                      value={personalInfo.language}
                      onChange={(e) => setPersonalInfo((p) => ({ ...p, language: e.target.value }))}
                      className="input-base bg-white/5 border-white/10 text-white"
                    >
                      {[
                        { code: "en", label: "🇬🇧 English" },
                        { code: "hi", label: "🇮🇳 हिन्दी (Hindi)" },
                        { code: "bn", label: "🇧🇩 বাংলা (Bengali)" },
                        { code: "vi", label: "🇻🇳 Tiếng Việt" },
                        { code: "fil", label: "🇵🇭 Filipino" },
                        { code: "id", label: "🇮🇩 Bahasa Indonesia" },
                        { code: "ta", label: "🇱🇰 தமிழ் (Tamil)" },
                        { code: "si", label: "🇱🇰 සිංහල (Sinhala)" },
                      ].map(({ code, label }) => (
                        <option key={code} value={code} className="bg-gray-900">{label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* ── Step 2: Farm Setup ── */}
            {currentStep === 2 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-white mb-1">Set up your farm</h2>
                  <p className="text-white/50 text-sm">What crops do you grow?</p>
                </div>
                <div className="grid gap-4">
                  <div>
                    <label className="text-xs text-white/50 font-medium mb-1.5 block">Farm Name</label>
                    <input
                      value={farmInfo.farmName}
                      onChange={(e) => setFarmInfo((p) => ({ ...p, farmName: e.target.value }))}
                      className="input-base bg-white/5 border-white/10 text-white placeholder:text-white/20"
                      placeholder="e.g. Green Valley Farm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-white/50 font-medium mb-1.5 block">Total Farm Area (hectares)</label>
                    <input
                      type="number"
                      value={farmInfo.totalArea}
                      onChange={(e) => setFarmInfo((p) => ({ ...p, totalArea: e.target.value }))}
                      className="input-base bg-white/5 border-white/10 text-white"
                      placeholder="e.g. 2.5"
                      step="0.1" min="0.1"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-white/50 font-medium mb-3 block">
                      Primary Crops{" "}
                      <span className="text-white/30">(select all that apply)</span>
                    </label>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {CROPS.map(({ id, label, icon, color }) => {
                        const isSelected = farmInfo.selectedCrops.includes(id);
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => toggleCrop(id)}
                            className={`p-3 rounded-xl border text-center transition-all ${
                              isSelected
                                ? "border-green-500 bg-green-500/15"
                                : "border-white/10 bg-white/3 hover:border-white/25"
                            }`}
                          >
                            <div className="text-2xl mb-1">{icon}</div>
                            <div className="text-xs font-medium text-white/70">{label}</div>
                            {isSelected && (
                              <div className="mt-1">
                                <Check size={12} className="text-green-400 mx-auto" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Step 3: Draw Fields ── */}
            {currentStep === 3 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-white mb-1">Map your fields</h2>
                  <p className="text-white/50 text-sm">
                    Draw your farm boundaries or enter GPS coordinates
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 overflow-hidden">
                  {/* Map placeholder — real Leaflet draws in dashboard */}
                  <div
                    className="relative flex items-center justify-center"
                    style={{ height: 300, background: "linear-gradient(135deg, #0a1929, #0d2818)" }}
                  >
                    <div className="text-center space-y-3">
                      <div className="w-16 h-16 rounded-full border-2 border-green-500/40 flex items-center justify-center mx-auto">
                        <MapPin size={28} className="text-green-400" />
                      </div>
                      <p className="text-white/50 text-sm">Interactive map loads with Mapbox / Leaflet</p>
                      <p className="text-white/30 text-xs">Click to draw polygon boundaries</p>
                    </div>
                    {/* Simulated field polygon */}
                    <svg className="absolute inset-0 w-full h-full opacity-30" viewBox="0 0 300 300">
                      <polygon
                        points="80,80 220,60 240,180 160,220 70,180"
                        fill="rgba(34,197,94,0.2)"
                        stroke="#22c55e"
                        strokeWidth="2"
                        strokeDasharray="6,3"
                      />
                      <circle cx="150" cy="140" r="5" fill="#22c55e" />
                    </svg>
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="p-4 rounded-xl border border-green-500/20 bg-green-500/5">
                    <div className="text-xs font-semibold text-green-400 mb-1">📍 Detected Location</div>
                    <div className="text-sm text-white">Barisal District, Bangladesh</div>
                    <div className="text-xs text-white/40 font-mono">22.7011° N, 90.3637° E</div>
                  </div>
                  <div className="p-4 rounded-xl border border-white/10 bg-white/3">
                    <div className="text-xs font-semibold text-white/50 mb-1">🗺️ Fields Mapped</div>
                    <div className="text-sm text-white">1 field drawn</div>
                    <div className="text-xs text-white/40">~2.3 hectares</div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Step 4: Risk Profile ── */}
            {currentStep === 4 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-white mb-1">Your risk history</h2>
                  <p className="text-white/50 text-sm">Helps us calibrate alerts for your specific situation</p>
                </div>
                <div className="space-y-5">
                  {[
                    {
                      question: "Has your farm flooded before?",
                      key: "hasFloodHistory" as const,
                      icon: "🌊",
                    },
                    {
                      question: "Have your crops shown salt damage (yellowing, wilting near coast)?",
                      key: "hasSalinityHistory" as const,
                      icon: "🧂",
                    },
                    {
                      question: "Do you have flood or crop insurance?",
                      key: "hasInsurance" as const,
                      icon: "📋",
                    },
                  ].map(({ question, key, icon }) => (
                    <div key={key} className="p-4 rounded-xl border border-white/8 bg-white/3">
                      <div className="flex items-start gap-3 mb-3">
                        <span className="text-xl">{icon}</span>
                        <p className="text-sm text-white font-medium">{question}</p>
                      </div>
                      <div className="flex gap-3">
                        {[
                          { value: true, label: "Yes" },
                          { value: false, label: "No" },
                        ].map(({ value, label }) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() =>
                              setRiskProfile((p) => ({ ...p, [key]: value }))
                            }
                            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                              riskProfile[key] === value
                                ? "border-green-500 bg-green-500/20 text-green-400"
                                : "border-white/10 text-white/50 hover:border-white/25"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Auto-detected info */}
                  <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5">
                    <div className="text-xs font-semibold text-amber-400 mb-2">
                      📍 Auto-detected from your location
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-white/40 text-xs">Distance to River</div>
                        <div className="text-white font-semibold">3.2 km</div>
                      </div>
                      <div>
                        <div className="text-white/40 text-xs">Distance to Coast</div>
                        <div className="text-white font-semibold">47 km</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Step 5: Notification Prefs ── */}
            {currentStep === 5 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-white mb-1">Alert preferences</h2>
                  <p className="text-white/50 text-sm">How and when should we reach you?</p>
                </div>
                <div className="space-y-5">
                  <div>
                    <label className="text-xs text-white/50 font-semibold uppercase tracking-wider mb-3 block">
                      Alert Types
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { key: "flood", label: "Flood Warning", icon: "🌊" },
                        { key: "salinity", label: "Salinity Alert", icon: "🧂" },
                        { key: "planting", label: "Planting Advice", icon: "🌱" },
                        { key: "weather", label: "Weather Forecast", icon: "☀️" },
                      ].map(({ key, label, icon }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() =>
                            setNotifications((p) => ({ ...p, [key]: !p[key as keyof typeof notifications] }))
                          }
                          className={`p-3 rounded-xl border text-left transition-all ${
                            notifications[key as keyof typeof notifications]
                              ? "border-green-500/50 bg-green-500/10"
                              : "border-white/10 bg-white/3"
                          }`}
                        >
                          <span className="text-lg block mb-1">{icon}</span>
                          <span className="text-xs text-white/70 font-medium">{label}</span>
                          <div className="mt-1.5 w-8 h-4 rounded-full transition-all relative"
                            style={{ background: notifications[key as keyof typeof notifications] ? "#22c55e" : "rgba(255,255,255,0.1)" }}>
                            <div className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                              style={{ left: notifications[key as keyof typeof notifications] ? "calc(100% - 14px)" : "2px" }} />
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-white/50 font-semibold uppercase tracking-wider mb-3 block">
                      Channels
                    </label>
                    <div className="flex gap-3">
                      {[
                        { key: "channelSMS", label: "📱 SMS" },
                        { key: "channelWhatsApp", label: "💬 WhatsApp" },
                        { key: "channelEmail", label: "📧 Email" },
                      ].map(({ key, label }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() =>
                            setNotifications((p) => ({ ...p, [key]: !p[key as keyof typeof notifications] }))
                          }
                          className={`flex-1 py-2.5 text-sm rounded-xl border transition-all ${
                            notifications[key as keyof typeof notifications]
                              ? "border-green-500/50 bg-green-500/10 text-green-400"
                              : "border-white/10 text-white/50"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-white/50 font-semibold uppercase tracking-wider mb-3 block">
                      Alert Threshold
                    </label>
                    <div className="flex gap-2">
                      {["low", "medium", "high"].map((level) => (
                        <button
                          key={level}
                          type="button"
                          onClick={() => setNotifications((p) => ({ ...p, threshold: level }))}
                          className={`flex-1 py-2.5 text-xs font-semibold rounded-xl border capitalize transition-all ${
                            notifications.threshold === level
                              ? "border-green-500/50 bg-green-500/10 text-green-400"
                              : "border-white/10 text-white/50"
                          }`}
                        >
                          {level}+ risk
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-white/30 mt-2">
                      We recommend &quot;medium&quot; — alerts fire when probability exceeds 40%
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Navigation buttons */}
            <div className="flex gap-3 mt-8">
              {currentStep > 1 && (
                <button
                  onClick={() => setCurrentStep((s) => s - 1)}
                  className="btn-ghost border border-white/10 px-6"
                >
                  <ChevronLeft size={16} />
                  Back
                </button>
              )}
              <button
                onClick={
                  currentStep < STEPS.length
                    ? () => setCurrentStep((s) => s + 1)
                    : handleComplete
                }
                disabled={isLoading}
                className="btn-primary flex-1"
              >
                {isLoading ? (
                  <><Loader2 size={18} className="animate-spin" /> Setting up your farm...</>
                ) : currentStep < STEPS.length ? (
                  <>Continue <ChevronRight size={16} /></>
                ) : (
                  <>🚀 Launch My Dashboard</>
                )}
              </button>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
