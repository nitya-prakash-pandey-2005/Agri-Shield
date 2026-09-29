"use client";

/**
 * Early Warning Management (spec §4.5): alert creation wizard with
 * multi-channel preview, broadcast history with receipts, escalation rules.
 */
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, BookOpenCheck, CheckCheck, History, Megaphone, Send, ShieldAlert } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { SectionHeader, Skeleton, SourceTag, StatTile } from "@/components/hud";
import { useGovInput } from "@/components/government/scope";
import { ErrorNote, Segmented } from "@/components/government/ui";
import { AlertWizard } from "@/components/government/alerts-wizard";
import { AlertHistory } from "@/components/government/alerts-history";
import { EscalationRules } from "@/components/government/alerts-escalation";

type Tab = "create" | "history" | "rules";

export default function EarlyWarningsPage() {
  const scope = useGovInput();
  const ctx = trpc.government.getContext.useQuery(scope);
  const hist = trpc.government.getAlertHistory.useQuery({ ...scope, limit: 1 }, { refetchInterval: 30_000 });
  const [tab, setTab] = useState<Tab>("create");
  const s = hist.data?.summary;
  const canCreate = ctx.data?.permissions.createAlert ?? false;
  const canEdit = ctx.data?.permissions.approveResources ?? false;

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Early warning management"
        title="Early Warnings"
        description={`Issue, preview and track multi-channel climate alerts for ${ctx.data?.orgName ?? "your jurisdiction"} — delivered in each farmer's language over app, SMS, WhatsApp and officer email.`}
        actions={
          <Segmented<Tab>
            layoutId="alerts-tab"
            value={tab}
            onChange={setTab}
            options={[
              { value: "create", label: "Create alert", icon: Megaphone },
              { value: "history", label: "Broadcast history", icon: History },
              { value: "rules", label: "Escalation rules", icon: ShieldAlert },
            ]}
          />
        }
      />

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="hud-label">Last 30 days{s ? ` · ${s.active} active now` : ""}</span>
          <SourceTag>Agri-SHIELD registry</SourceTag>
        </div>
        <ErrorNote error={hist.error} className="mb-3" />
        {!s ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[92px]" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Alerts issued" value={s.alerts30d} icon={Bell} accent="emerald" hint="Alerts created in the last 30 days" />
            <StatTile label="Messages sent" value={s.sent30d} icon={Send} accent="cyan" delta={`${(s.deliveryRate * 100).toFixed(1)}% delivered`} deltaGood={s.deliveryRate > 0.9} />
            <StatTile label="Read rate" value={s.readRate * 100} decimals={1} suffix="%" icon={BookOpenCheck} accent="violet" hint="Read / delivered" />
            <StatTile label="Action rate" value={s.actionRate * 100} decimals={1} suffix="%" icon={CheckCheck} accent="amber" hint="Farmers who reported taking action / delivered" />
          </div>
        )}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }}>
          {tab === "create" && <AlertWizard canCreate={canCreate} />}
          {tab === "history" && <AlertHistory canCreate={canCreate} />}
          {tab === "rules" && <EscalationRules canEdit={canEdit} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
