"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, Eye, EyeOff, Tractor, Building2, TruckIcon, ArrowRight, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

const ROLES = [
  {
    id: "farmer",
    icon: Tractor,
    title: "Farmer",
    description: "Protect your crops and get field-level alerts",
    color: "#22c55e",
    border: "border-green-500/30 hover:border-green-500",
  },
  {
    id: "government",
    icon: Building2,
    title: "Government Officer",
    description: "Coordinate resources and broadcast alerts",
    color: "#10b981",
    border: "border-emerald-500/30 hover:border-emerald-500",
  },
  {
    id: "supply_chain",
    icon: TruckIcon,
    title: "Supply Chain Manager",
    description: "Track commodity risk and disruption scenarios",
    color: "#f59e0b",
    border: "border-amber-500/30 hover:border-amber-500",
  },
];

export default function SignUpPage() {
  const [step, setStep] = useState<"role" | "details" | "otp">("role");
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [otpDigits, setOtpDigits] = useState(["", "", "", "", "", ""]);
  const router = useRouter();
  const searchParams = useSearchParams();

  const prefillRole = searchParams.get("role");

  const handleRoleSelect = (roleId: string) => {
    setSelectedRole(roleId);
    setStep("details");
  };

  const handleDetailsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    // Simulate API call
    await new Promise((r) => setTimeout(r, 1200));
    setIsLoading(false);
    if (selectedRole === "farmer") {
      setStep("otp");
    } else {
      // Government/Supply chain goes to org onboarding
      router.push(`/onboarding/${selectedRole === "government" ? "government" : "supply-chain"}`);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    await new Promise((r) => setTimeout(r, 1000));
    setIsLoading(false);
    router.push("/onboarding/farmer");
  };

  return (
    <div className="min-h-screen gradient-hero flex items-center justify-center p-4">
      {/* Background effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -left-1/4 w-96 h-96 rounded-full opacity-10"
          style={{ background: "radial-gradient(circle, #22c55e, transparent)" }} />
        <div className="absolute -bottom-1/4 -right-1/4 w-96 h-96 rounded-full opacity-5"
          style={{ background: "radial-gradient(circle, #10b981, transparent)" }} />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-green flex items-center justify-center">
              <Shield size={22} className="text-white" />
            </div>
            <span className="font-bold text-2xl text-white">
              Agri<span className="text-green-400">-SHIELD</span>
            </span>
          </Link>
        </div>

        <AnimatePresence mode="wait">
          {/* ── STEP 1: Role Selection ── */}
          {step === "role" && (
            <motion.div
              key="role"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="glass-dark rounded-3xl p-8 border border-white/8"
            >
              <h1 className="text-2xl font-bold text-white text-center mb-2">
                Join Agri-SHIELD
              </h1>
              <p className="text-white/50 text-sm text-center mb-8">
                Select your role to get started
              </p>

              <div className="space-y-3">
                {ROLES.map((role) => {
                  const Icon = role.icon;
                  return (
                    <motion.button
                      key={role.id}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleRoleSelect(role.id)}
                      className={`w-full flex items-center gap-4 p-4 rounded-2xl border transition-all text-left ${role.border} bg-white/3 hover:bg-white/6`}
                    >
                      <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: `${role.color}20`, border: `1px solid ${role.color}30` }}
                      >
                        <Icon size={22} style={{ color: role.color }} />
                      </div>
                      <div>
                        <div className="font-semibold text-white">{role.title}</div>
                        <div className="text-xs text-white/50">{role.description}</div>
                      </div>
                      <ArrowRight size={16} className="ml-auto text-white/30" />
                    </motion.button>
                  );
                })}
              </div>

              <p className="text-center text-sm text-white/40 mt-6">
                Already have an account?{" "}
                <Link href="/auth/signin" className="text-green-400 hover:text-green-300">
                  Sign in
                </Link>
              </p>
            </motion.div>
          )}

          {/* ── STEP 2: Account Details ── */}
          {step === "details" && (
            <motion.div
              key="details"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="glass-dark rounded-3xl p-8 border border-white/8"
            >
              <button
                onClick={() => setStep("role")}
                className="text-white/40 hover:text-white text-sm mb-6 flex items-center gap-1 transition-colors"
              >
                ← Back
              </button>

              <h1 className="text-2xl font-bold text-white mb-2">Create your account</h1>
              <p className="text-white/50 text-sm mb-8">
                {selectedRole === "farmer"
                  ? "You'll verify via SMS OTP next"
                  : "An admin will verify your organization"}
              </p>

              <form onSubmit={handleDetailsSubmit} className="space-y-4">
                <div>
                  <label className="text-xs text-white/50 font-medium mb-1.5 block">
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="input-base bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:ring-green-500/50"
                    placeholder="Enter your name"
                    required
                  />
                </div>

                {selectedRole === "farmer" ? (
                  <div>
                    <label className="text-xs text-white/50 font-medium mb-1.5 block">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                      className="input-base bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:ring-green-500/50"
                      placeholder="+880 1XXXXXXXXX"
                      required
                    />
                    <p className="text-xs text-white/30 mt-1">
                      We'll send you a one-time OTP
                    </p>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="text-xs text-white/50 font-medium mb-1.5 block">
                        Work Email
                      </label>
                      <input
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                        className="input-base bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:ring-green-500/50"
                        placeholder="you@agency.gov"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs text-white/50 font-medium mb-1.5 block">
                        Password
                      </label>
                      <div className="relative">
                        <input
                          type={showPassword ? "text" : "password"}
                          value={form.password}
                          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                          className="input-base bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:ring-green-500/50 pr-11"
                          placeholder="Min 12 characters"
                          required
                          minLength={12}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                        >
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>
                  </>
                )}

                <motion.button
                  whileTap={{ scale: 0.97 }}
                  type="submit"
                  disabled={isLoading}
                  className="btn-primary w-full mt-2"
                >
                  {isLoading ? (
                    <><Loader2 size={18} className="animate-spin" /> Processing...</>
                  ) : selectedRole === "farmer" ? (
                    "Send OTP →"
                  ) : (
                    "Create Account →"
                  )}
                </motion.button>
              </form>
            </motion.div>
          )}

          {/* ── STEP 3: OTP Verification ── */}
          {step === "otp" && (
            <motion.div
              key="otp"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="glass-dark rounded-3xl p-8 border border-white/8 text-center"
            >
              <div className="w-16 h-16 rounded-2xl bg-green-500/20 border border-green-500/30 flex items-center justify-center mx-auto mb-6">
                <span className="text-3xl">📱</span>
              </div>
              <h1 className="text-2xl font-bold text-white mb-2">Verify Your Phone</h1>
              <p className="text-white/50 text-sm mb-8">
                Enter the 6-digit OTP sent to{" "}
                <span className="text-white">{form.phone || "+880 1XXXXXXXXX"}</span>
                <br />
                <span className="text-green-400 text-xs">(Demo: use 123456)</span>
              </p>

              <form onSubmit={handleOtpSubmit}>
                <div className="flex gap-3 justify-center mb-6">
                  {otpDigits.map((digit, i) => (
                    <input
                      key={i}
                      id={`otp-${i}`}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/, "");
                        const next = [...otpDigits];
                        next[i] = val;
                        setOtpDigits(next);
                        if (val && i < 5) {
                          document.getElementById(`otp-${i + 1}`)?.focus();
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Backspace" && !digit && i > 0) {
                          document.getElementById(`otp-${i - 1}`)?.focus();
                        }
                      }}
                      className="w-12 h-14 text-center text-xl font-bold rounded-xl bg-white/5 border border-white/10 text-white focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none transition-all"
                    />
                  ))}
                </div>

                <motion.button
                  whileTap={{ scale: 0.97 }}
                  type="submit"
                  disabled={isLoading || otpDigits.join("").length < 6}
                  className="btn-primary w-full"
                >
                  {isLoading ? (
                    <><Loader2 size={18} className="animate-spin" /> Verifying...</>
                  ) : (
                    "Verify & Continue →"
                  )}
                </motion.button>
              </form>

              <button className="text-xs text-white/30 hover:text-white/60 mt-4 transition-colors">
                Didn't receive it? Resend in 45s
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
