import { Activity, Users, AlertTriangle, ShieldCheck } from "lucide-react";

export default function AdminOverviewPage() {
  const stats = [
    { label: "Total Farmers", value: "24,591", icon: Users, color: "text-blue-400" },
    { label: "Active Alerts", value: "142", icon: AlertTriangle, color: "text-red-400" },
    { label: "ML API Health", value: "99.9%", icon: Activity, color: "text-green-400" },
    { label: "Sys Integrity", value: "Optimal", icon: ShieldCheck, color: "text-emerald-400" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Platform Overview</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, i) => (
          <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex items-center gap-4">
            <div className={`p-3 rounded-lg bg-slate-800 ${stat.color}`}>
              <stat.icon size={24} />
            </div>
            <div>
              <div className="text-2xl font-bold">{stat.value}</div>
              <div className="text-slate-400 text-sm">{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4">Recent System Logs</h2>
          <div className="space-y-3 font-mono text-sm">
            <div className="flex items-center gap-2 text-slate-400"><span className="text-blue-400">[INFO]</span> ML model flood_engine_v1.0.0 retrained.</div>
            <div className="flex items-center gap-2 text-slate-400"><span className="text-yellow-400">[WARN]</span> High latency on SoilGrids API. Using cached defaults.</div>
            <div className="flex items-center gap-2 text-slate-400"><span className="text-green-400">[OK]</span> 14,020 SMS alerts dispatched successfully.</div>
            <div className="flex items-center gap-2 text-slate-400"><span className="text-blue-400">[INFO]</span> New supply chain org registered: GlobalAgri.</div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4">Worker Status</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>climate-scan</div>
              <div className="flex items-center gap-2 text-green-400"><div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"/> Active</div>
            </div>
            <div className="flex items-center justify-between">
              <div>notification-dispatch</div>
              <div className="flex items-center gap-2 text-green-400"><div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"/> Active</div>
            </div>
            <div className="flex items-center justify-between">
              <div>satellite-ingest</div>
              <div className="flex items-center gap-2 text-slate-400"><div className="w-2 h-2 rounded-full bg-slate-400"/> Idle</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
