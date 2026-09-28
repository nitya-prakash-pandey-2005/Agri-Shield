"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Shield, Loader2, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";

export default function SignInPage() {
  const [method, setMethod] = useState<"phone" | "email">("phone");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [magicSent, setMagicSent] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    await new Promise((r) => setTimeout(r, 1200));
    setIsLoading(false);
    if (method === "phone") {
      router.push("/auth/otp-verify");
    } else {
      setMagicSent(true);
    }
  };

  // Demo quick logins
  const demoLogins = [
    { label: "🌾 Farmer Demo", email: "farmer@demo.agrishield.io", href: "/dashboard/farmer" },
    { label: "🏛️ Government Demo", email: "gov@demo.agrishield.io", href: "/dashboard/government" },
    { label: "🚛 Supply Chain Demo", email: "supply@demo.agrishield.io", href: "/dashboard/supply-chain" },
  ];

  return (
    <div className="min-h-screen gradient-hero flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -right-1/4 w-96 h-96 rounded-full opacity-10"
          style={{ background: "radial-gradient(circle, #22c55e, transparent)" }} />
      </div>

      <div className="relative w-full max-w-md">
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

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-dark rounded-3xl p-8 border border-white/8"
        >
          <h1 className="text-2xl font-bold text-white mb-2">Welcome back</h1>
          <p className="text-white/50 text-sm mb-6">Sign in to your Agri-SHIELD account</p>

          {/* Method toggle */}
          <div className="flex rounded-xl bg-white/5 p-1 mb-6">
            {[
              { key: "phone", label: "Phone OTP" },
              { key: "email", label: "Email" },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setMethod(key as "phone" | "email")}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                  method === key
                    ? "bg-green-500 text-white shadow-sm"
                    : "text-white/50 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {magicSent ? (
            <div className="text-center py-8 space-y-3">
              <div className="text-4xl">📧</div>
              <p className="text-white font-semibold">Check your email!</p>
              <p className="text-white/50 text-sm">
                We sent a magic link to <span className="text-green-400">{email}</span>
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {method === "phone" ? (
                <div>
                  <label className="text-xs text-white/50 font-medium mb-1.5 block">Phone Number</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="input-base bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:ring-green-500/50"
                    placeholder="+880 1XXXXXXXXX"
                    required
                  />
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-xs text-white/50 font-medium mb-1.5 block">Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="input-base bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:ring-green-500/50"
                      placeholder="you@example.com"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs text-white/50 font-medium mb-1.5 block">Password</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="input-base bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:ring-green-500/50"
                      placeholder="Your password"
                      required
                    />
                  </div>
                </>
              )}

              <motion.button
                whileTap={{ scale: 0.97 }}
                type="submit"
                disabled={isLoading}
                className="btn-primary w-full"
              >
                {isLoading ? (
                  <><Loader2 size={18} className="animate-spin" /> Signing in...</>
                ) : method === "phone" ? (
                  <>Send OTP <ArrowRight size={16} /></>
                ) : (
                  <>Send Magic Link <ArrowRight size={16} /></>
                )}
              </motion.button>
            </form>
          )}

          {/* Demo quick access */}
          <div className="mt-6 pt-6 border-t border-white/8">
            <p className="text-xs text-white/30 text-center mb-3">
              🎮 Hackathon Demo — Quick Access
            </p>
            <div className="grid grid-cols-3 gap-2">
              {demoLogins.map(({ label, href }) => (
                <Link
                  key={href}
                  href={href}
                  className="text-xs text-center py-2 px-1 rounded-xl border border-white/10 text-white/50 hover:text-white hover:border-green-500/30 transition-all"
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>

          <p className="text-center text-sm text-white/40 mt-6">
            New to Agri-SHIELD?{" "}
            <Link href="/auth/signup" className="text-green-400 hover:text-green-300">
              Create account
            </Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
