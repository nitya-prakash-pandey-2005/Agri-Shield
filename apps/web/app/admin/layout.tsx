import { ReactNode } from "react";
import Link from "next/link";
import { Users, Settings, Database, Server, Home } from "lucide-react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex">
      {/* Admin Sidebar */}
      <aside className="w-64 border-r border-slate-800 bg-slate-900/50 p-4 flex flex-col gap-4">
        <div className="font-bold text-xl mb-4 text-emerald-400">Agri-SHIELD Admin</div>
        
        <nav className="flex flex-col gap-2">
          <Link href="/admin" className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-800 transition-colors">
            <Home size={18} /> Overview
          </Link>
          <Link href="/admin/users" className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-800 transition-colors">
            <Users size={18} /> User Management
          </Link>
          <Link href="/admin/infrastructure" className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-800 transition-colors">
            <Server size={18} /> Infrastructure
          </Link>
          <Link href="/admin/database" className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-800 transition-colors">
            <Database size={18} /> Database
          </Link>
        </nav>

        <div className="mt-auto">
          <Link href="/admin/settings" className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-800 transition-colors">
            <Settings size={18} /> Settings
          </Link>
        </div>
      </aside>

      {/* Admin Content */}
      <main className="flex-1 p-8 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
