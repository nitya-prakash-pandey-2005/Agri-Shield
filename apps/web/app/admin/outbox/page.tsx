"use client";

import { useState } from "react";
import { Inbox, Mail, MessageCircle, MessageSquare, Radio, Send, Smartphone } from "lucide-react";
import { EmptyState, LiveDot, Panel, SectionHeader, Skeleton, StatTile } from "@/components/hud";
import { DataTable, ErrorNote, Select, StatusBadge, Td, TimeAgo, fmtNum } from "@/components/admin/ui";
import { maskMiddle } from "@/components/admin/Overlay";
import { trpc } from "@/lib/trpc";

type Channel = "sms" | "whatsapp" | "email" | "app";
type Status = "sent" | "simulated" | "failed";

const CH_ICON = { sms: MessageSquare, whatsapp: MessageCircle, email: Mail, app: Smartphone } as const;

function Body({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 90;
  return (
    <button type="button" onClick={() => long && setOpen(!open)} className="text-left text-slate-300 max-w-[420px]" title={long ? (open ? "Collapse" : "Expand") : undefined}>
      {open || !long ? <span className="whitespace-pre-wrap break-words">{text}</span> : `${text.slice(0, 90)}…`}
    </button>
  );
}

export default function AdminOutboxPage() {
  const [channel, setChannel] = useState<Channel | "">("");
  const [status, setStatus] = useState<Status | "">("");
  const q = trpc.admin.outbox.useQuery({ channel: channel || undefined, status: status || undefined, limit: 200 }, { refetchInterval: 10_000, placeholderData: (p) => p });
  const d = q.data;
  const n = (arr: { key: string; n: number }[] | undefined, key: string) => arr?.find((x) => x.key === key)?.n ?? 0;

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="Messaging"
        title="Notification outbox"
        description="Every SMS, WhatsApp, e-mail and in-app notification the platform has sent. Without provider keys messages are recorded here as simulated so the pipeline stays demonstrable."
        actions={<LiveDot label="10s REFRESH" color="#8b5cf6" />}
      />
      <ErrorNote error={q.error} />

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        {!d ? (
          Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[104px]" />)
        ) : (
          <>
            <StatTile label="SMS" value={n(d.byChannel, "sms")} icon={MessageSquare} accent="violet" />
            <StatTile label="WhatsApp" value={n(d.byChannel, "whatsapp")} icon={MessageCircle} accent="emerald" />
            <StatTile label="E-mail" value={n(d.byChannel, "email")} icon={Mail} accent="cyan" />
            <StatTile label="In-app" value={n(d.byChannel, "app")} icon={Smartphone} accent="green" />
            <StatTile label="Failed" value={n(d.byStatus, "failed")} icon={Send} accent="red" delta={`${d.queue.dead} dead-lettered`} deltaGood={n(d.byStatus, "failed") === 0} />
            <StatTile label="Queue pending" value={d.queue.pending} icon={Inbox} accent="amber" delta={`${d.queue.sent} retried OK`} deltaGood />
          </>
        )}
      </div>

      {d && (
        <Panel title="Delivery providers" icon={Radio} accent="violet">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {[
              { name: "Twilio SMS", on: d.providers.twilio, env: "TWILIO_ACCOUNT_SID / AUTH_TOKEN / PHONE_NUMBER" },
              { name: "Twilio WhatsApp", on: d.providers.twilio && d.providers.whatsapp, env: "TWILIO_WHATSAPP_NUMBER" },
              { name: "Resend e-mail", on: d.providers.resend, env: "RESEND_API_KEY" },
            ].map((p) => (
              <div key={p.name} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-slate-950/40 px-3 py-2">
                <div>
                  <div className="text-[12.5px] text-slate-100">{p.name}</div>
                  <div className="telemetry text-[10px] text-slate-500">{p.env}</div>
                </div>
                <StatusBadge status={p.on ? "up" : "simulated"} label={p.on ? "live" : "outbox simulation"} />
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel
        title="Messages"
        subtitle={d ? `${fmtNum(d.total)} matching` : undefined}
        icon={Send}
        accent="violet"
        actions={
          <div className="flex gap-2">
            <Select<Channel>
              label="Channel"
              value={channel}
              onChange={setChannel}
              className="h-8 text-xs"
              options={[
                { value: "", label: "All channels" },
                { value: "sms", label: "SMS" },
                { value: "whatsapp", label: "WhatsApp" },
                { value: "email", label: "E-mail" },
                { value: "app", label: "In-app" },
              ]}
            />
            <Select<Status>
              label="Status"
              value={status}
              onChange={setStatus}
              className="h-8 text-xs"
              options={[
                { value: "", label: "Any status" },
                { value: "sent", label: "Sent" },
                { value: "simulated", label: "Simulated" },
                { value: "failed", label: "Failed" },
              ]}
            />
          </div>
        }
      >
        {!d ? (
          <Skeleton className="h-64" />
        ) : d.rows.length === 0 ? (
          <EmptyState icon={Send} title="No messages yet">
            Broadcast an alert from the government portal or run a climate scan to see deliveries here.
          </EmptyState>
        ) : (
          <div className="max-h-[560px] overflow-y-auto">
            <DataTable head={["Time", "Channel", "To", "Message", "Status", "Provider", "Error"]}>
              {d.rows.map((m) => {
                const Icon = CH_ICON[m.channel];
                return (
                  <tr key={m.id} className="hover:bg-white/[0.02]">
                    <Td>
                      <TimeAgo date={m.at} className="text-slate-400 whitespace-nowrap" />
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-1.5 text-slate-200">
                        <Icon size={13} className="text-violet-300" />
                        {m.channel}
                      </span>
                    </Td>
                    <Td mono className="text-slate-400 whitespace-nowrap">
                      {maskMiddle(m.to)}
                    </Td>
                    <Td>
                      <Body text={m.body} />
                    </Td>
                    <Td>
                      <StatusBadge status={m.status} />
                    </Td>
                    <Td mono className="text-slate-400">
                      {m.provider}
                    </Td>
                    <Td className="text-rose-300 text-[11px]">{m.error ?? ""}</Td>
                  </tr>
                );
              })}
            </DataTable>
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel title="Pending delivery queue" subtitle="Retries with exponential backoff (1 → 2 → 4 min, max 3 attempts)" icon={Inbox} accent="amber">
          {!d ? (
            <Skeleton className="h-40" />
          ) : d.queue.items.length === 0 ? (
            <EmptyState icon={Inbox} title="Queue is empty" />
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <DataTable head={["Queued", "Channel", "To", "Origin", "Attempts", "Status"]}>
                {d.queue.items.map((it) => (
                  <tr key={it.id}>
                    <Td>
                      <TimeAgo date={it.createdAt} className="text-slate-400" />
                    </Td>
                    <Td mono>{it.channel}</Td>
                    <Td mono className="text-slate-400">
                      {maskMiddle(it.to)}
                    </Td>
                    <Td mono className="text-slate-400">
                      {it.origin}
                    </Td>
                    <Td mono>{it.attempts}/3</Td>
                    <Td>
                      <StatusBadge status={it.status} />
                      {it.lastError && <div className="text-[10.5px] text-rose-300 mt-0.5">{it.lastError}</div>}
                    </Td>
                  </tr>
                ))}
              </DataTable>
            </div>
          )}
        </Panel>

        <Panel title="Inbound SMS" subtitle="Twilio webhook conversations (feature-phone farmers)" icon={MessageSquare} accent="cyan">
          {!d ? (
            <Skeleton className="h-40" />
          ) : d.sms.length === 0 ? (
            <EmptyState icon={MessageSquare} title="No inbound SMS yet">
              Try the SMS simulator to send STATUS as a demo farmer.
            </EmptyState>
          ) : (
            <ul className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
              {d.sms.map((s) => (
                <li key={s.id} className="rounded-lg border border-white/5 bg-slate-950/40 p-2.5 text-[12px]">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span className="telemetry text-slate-300">{s.fromMasked}</span>
                    {s.farmerName && <span>{s.farmerName}</span>}
                    <span className="telemetry rounded bg-violet-500/10 px-1.5 text-violet-300">{s.command}</span>
                    <span className="telemetry">{s.language}</span>
                    <span className="telemetry">
                      {s.segments} seg · {s.encoding}
                    </span>
                    <TimeAgo date={s.at} className="ml-auto" />
                  </div>
                  <div className="mt-1 text-slate-400">
                    ▸ <span className="text-slate-200">{s.body}</span>
                  </div>
                  <div className="mt-1 text-slate-300">◂ {s.reply}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
