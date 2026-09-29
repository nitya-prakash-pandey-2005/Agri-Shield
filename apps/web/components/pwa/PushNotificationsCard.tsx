"use client";

/**
 * Device push notifications (Web Push / VAPID): status, enable/disable on
 * this device, send a test, and the list of the user's subscribed devices.
 * Used in workspace Settings and the farmer Profile & settings page.
 */
import { BellOff, BellRing, Loader2, Monitor, Send, Share, Smartphone, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { HudButton, Panel } from "@/components/hud";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { usePushNotifications, type PushStatus } from "./usePushNotifications";

const PILL: Record<PushStatus, { cls: string; key: "push.statusOn" | "push.statusOff" | "push.statusBlocked" | "push.statusUnsupported" | null }> = {
  loading: { cls: "bg-slate-500/15 text-slate-400", key: null },
  on: { cls: "bg-emerald-500/15 text-emerald-300", key: "push.statusOn" },
  off: { cls: "bg-slate-500/15 text-slate-400", key: "push.statusOff" },
  denied: { cls: "bg-rose-500/15 text-rose-300", key: "push.statusBlocked" },
  "ios-install": { cls: "bg-amber-500/15 text-amber-300", key: "push.statusOff" },
  unsupported: { cls: "bg-slate-500/15 text-slate-400", key: "push.statusUnsupported" },
  insecure: { cls: "bg-amber-500/15 text-amber-300", key: "push.statusUnsupported" },
  "sw-disabled": { cls: "bg-amber-500/15 text-amber-300", key: "push.statusUnsupported" },
};

const isPhone = (label: string) => /Android|iPhone|iPad/.test(label);

export function PushNotificationsCard({ className, layout = "stack" }: { className?: string; layout?: "stack" | "split" }) {
  const { t, fmt } = useI18n();
  const p = usePushNotifications();
  const pill = PILL[p.status];

  const hint =
    p.status === "ios-install" ? (
      <>
        <Share size={12} className="-mt-0.5 mr-1 inline" aria-hidden />
        {t("push.iosHint")}
      </>
    ) : p.status === "denied" ? (
      t("push.deniedHint")
    ) : p.status === "insecure" ? (
      t("push.insecureHint")
    ) : p.status === "unsupported" ? (
      t("push.unsupportedHint")
    ) : p.status === "sw-disabled" ? (
      "The service worker is off in development. Set NEXT_PUBLIC_SW_DEV=true or use a production build to test push."
    ) : null;

  const enable = async () => {
    if (await p.subscribe()) toast.success(t("push.enabled"));
    else toast.error(t("push.failed"));
  };
  const disable = async () => {
    if (await p.unsubscribe()) toast.success(t("push.disabled"));
  };
  const test = async () => {
    try {
      const r = await p.sendTest();
      if (r.skipped === "disabled") toast.info("Push sending is disabled on this server (WEB_PUSH_DISABLED).");
      else if (r.sent) toast.success(t("push.testSent", { count: r.sent }), r.failed ? { description: `${r.failed} failed${r.removed ? `, ${r.removed} expired device(s) removed` : ""}` } : undefined);
      else toast.error(t("push.failed"), { description: r.removed ? `${r.removed} expired device(s) removed` : undefined });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const controls = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {p.status === "on" ? (
          <HudButton variant="outline" onClick={disable} disabled={!!p.busy} className="min-h-[40px]">
            {p.busy === "unsubscribe" ? <Loader2 size={15} className="animate-spin" /> : <BellOff size={15} />} {t("push.disable")}
          </HudButton>
        ) : (
          <HudButton onClick={enable} disabled={!!p.busy || p.status !== "off"} className="min-h-[40px]">
            {p.busy === "subscribe" ? <Loader2 size={15} className="animate-spin" /> : <BellRing size={15} />} {t("push.enable")}
          </HudButton>
        )}
        <HudButton variant="outline" onClick={test} disabled={!!p.busy || !p.devices.length} className="min-h-[40px]">
          {p.busy === "test" ? <Loader2 size={15} className="animate-spin" /> : <Send size={14} />} {t("push.test")}
        </HudButton>
      </div>
      {hint && <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[12px] leading-relaxed text-amber-200">{hint}</p>}
      {p.error && p.status !== "denied" && <p className="text-[12px] text-rose-300">{p.error}</p>}
    </div>
  );

  const list = (
    <div>
      <div className="hud-label mb-1.5">
        {t("push.devices")} {p.devices.length > 0 && <span className="telemetry text-slate-500">· {p.devices.length}</span>}
      </div>
      {p.devices.length ? (
        <ul className="divide-y divide-white/5 rounded-lg border border-white/5 bg-white/[0.02]">
          {p.devices.map((d) => {
            const mine = d.endpoint === p.endpoint;
            const Icon = isPhone(d.label) ? Smartphone : Monitor;
            return (
              <li key={d.id} className="flex items-center gap-3 px-3 py-2">
                <Icon size={15} className={cn("shrink-0", mine ? "text-emerald-400" : "text-slate-500")} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 text-[13px] text-slate-100">
                    <span className="truncate">{d.label}</span>
                    {mine && <span className="rounded-full bg-emerald-500/15 px-1.5 text-[10px] font-medium text-emerald-300">{t("push.thisDevice")}</span>}
                  </div>
                  <div className="truncate text-[11px] text-slate-500">
                    {d.service} · {d.lastSuccessAt ? t("push.lastDelivered", { when: fmt.relative(d.lastSuccessAt) }) : t("push.added", { when: fmt.relative(d.createdAt) })}
                    {d.failures > 0 && d.lastError ? <span className="text-amber-300"> · {d.lastError}</span> : null}
                  </div>
                </div>
                <button
                  onClick={() => p.removeDevice(d.id).catch((e: Error) => toast.error(e.message))}
                  disabled={!!p.busy}
                  aria-label={`${t("push.remove")}: ${d.label}`}
                  title={t("push.remove")}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-40"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-white/10 px-3 py-2.5 text-[12px] text-slate-500">{p.devicesLoading ? "…" : t("push.noDevices")}</p>
      )}
    </div>
  );

  return (
    <Panel
      title={t("push.title")}
      subtitle={t("push.subtitle")}
      icon={BellRing}
      accent="emerald"
      className={className}
      actions={pill.key ? <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-medium", pill.cls)}>{t(pill.key)}</span> : null}
    >
      <div className={cn(layout === "split" ? "grid gap-4 lg:grid-cols-2" : "space-y-4")}>
        {controls}
        {list}
      </div>
    </Panel>
  );
}
