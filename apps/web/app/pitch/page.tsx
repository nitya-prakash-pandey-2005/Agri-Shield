import Link from "next/link";
import { Shield, ChevronRight, Play, Server, Database, Globe2, Activity } from "lucide-react";

export default function PitchPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans selection:bg-emerald-500/30">
      {/* Navbar */}
      <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-slate-950/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center">
              <Shield size={18} className="text-slate-950" />
            </div>
            <span className="font-bold tracking-tight">Agri-SHIELD</span>
          </Link>
          <div className="flex gap-4">
            <Link href="/" className="text-sm font-medium text-white/60 hover:text-white transition-colors">Home</Link>
            <Link href="/dashboard/farmer" className="text-sm font-medium text-emerald-400">View Demo</Link>
          </div>
        </div>
      </nav>

      <main className="pt-32 pb-24">
        <div className="max-w-4xl mx-auto px-6 text-center mb-24">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold mb-6 tracking-wide uppercase">
            Asian Hackathon for Green Future 2026
          </div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-8">
            Climate Decision Intelligence <br/><span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">for the Next Billion Farmers.</span>
          </h1>
          <p className="text-xl text-slate-400 mb-10 max-w-2xl mx-auto">
            Agri-SHIELD translates complex climate models into actionable, role-specific intelligence for farmers, governments, and supply chains.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link href="/dashboard/farmer" className="px-8 py-4 rounded-full bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400 transition-colors flex items-center gap-2">
              <Play size={18} fill="currentColor" /> Play Live Demo
            </Link>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-6 grid md:grid-cols-3 gap-8 mb-24">
          {[
            {
              title: "Farmer Portal",
              desc: "Offline-capable PWA. Real-time local flood/salinity alerts. AI voice advisor for agronomy.",
              link: "/dashboard/farmer",
              color: "emerald"
            },
            {
              title: "Gov Portal",
              desc: "National risk map. Resource dispatch workflows. AI-generated policy recommendations.",
              link: "/dashboard/government",
              color: "blue"
            },
            {
              title: "Supply Chain",
              desc: "Commodity disruption modeling. Price impact forecasting. Alternate sourcing intelligence.",
              link: "/dashboard/supply-chain",
              color: "amber"
            }
          ].map((portal, i) => (
            <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-8 hover:border-slate-700 transition-colors">
              <h3 className="text-2xl font-bold mb-4">{portal.title}</h3>
              <p className="text-slate-400 mb-8">{portal.desc}</p>
              <Link href={portal.link} className={`text-${portal.color}-400 font-semibold flex items-center gap-1 hover:gap-2 transition-all`}>
                Open Portal <ChevronRight size={16} />
              </Link>
            </div>
          ))}
        </div>

        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-3xl font-bold mb-12 text-center">Technical Architecture</h2>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 overflow-hidden relative">
            <div className="grid sm:grid-cols-2 gap-8 relative z-10">
              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-slate-800 rounded-xl text-blue-400"><Server size={20} /></div>
                  <div>
                    <h4 className="font-bold text-lg mb-1">Frontend (Turborepo + Next.js)</h4>
                    <p className="text-sm text-slate-400">React 19, TailwindCSS, Framer Motion, Recharts, Leaflet/Mapbox, Socket.io client.</p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-slate-800 rounded-xl text-emerald-400"><Activity size={20} /></div>
                  <div>
                    <h4 className="font-bold text-lg mb-1">ML API (Python + FastAPI)</h4>
                    <p className="text-sm text-slate-400">Scikit-learn, LangChain, Domain-formula scoring algorithms calibrated to GloFAS/CHIRPS data.</p>
                  </div>
                </div>
              </div>
              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-slate-800 rounded-xl text-purple-400"><Database size={20} /></div>
                  <div>
                    <h4 className="font-bold text-lg mb-1">Database (PostgreSQL + PostGIS)</h4>
                    <p className="text-sm text-slate-400">Managed via Drizzle ORM. Geospatial queries for risk intersections. Redis for BullMQ.</p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-slate-800 rounded-xl text-amber-400"><Globe2 size={20} /></div>
                  <div>
                    <h4 className="font-bold text-lg mb-1">External APIs</h4>
                    <p className="text-sm text-slate-400">Open-Meteo (Weather), SoilGrids (Soil), Twilio (Alerts), OpenAI (RAG Advisor).</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
