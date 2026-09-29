"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Code2, MessageSquareText, Phone, Search, Send, ShieldCheck, ShieldOff } from "lucide-react";
import { EmptyState, Panel, SectionHeader, Skeleton, SourceTag } from "@/components/hud";
import { PhoneFrame, type Bubble } from "@/components/admin/PhoneFrame";
import { DataTable, ErrorNote, SearchInput, StatusBadge, Td, TimeAgo, fmtMs } from "@/components/admin/ui";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const CHIPS = ["STATUS", "ALERT", "ADVICE", "HELP", "1", "LANG bn", "LANG en", "অবস্থা", "स्थिति", "TRẠNG THÁI", "KALAGAYAN", "PERINGATAN", "STOP", "START"];

interface Wire {
  request: string;
  url: string;
  status: number;
  latencyMs: number;
  response: string;
  command: string | null;
  language: string | null;
  segments: string | null;
  encoding: string | null;
  signed: boolean;
}

function parseTwiml(xml: string): string {
  try {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const msg = doc.getElementsByTagName("Message")[0];
    if (msg?.textContent) return msg.textContent;
  } catch {
    /* fall through */
  }
  return xml;
}

export default function SmsSimulatorPage() {
  const utils = trpc.useUtils();
  const contacts = trpc.admin.smsContacts.useQuery();
  const log = trpc.admin.smsLog.useQuery(undefined, { refetchInterval: 5_000 });
  const sign = trpc.admin.smsSign.useMutation();

  const [filter, setFilter] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [custom, setCustom] = useState("+8801999000123");
  const [text, setText] = useState("");
  const [threads, setThreads] = useState<Record<string, Bubble[]>>({});
  const [busy, setBusy] = useState(false);
  const [wire, setWire] = useState<Wire | null>(null);

  const list = useMemo(() => {
    const f = filter.toLowerCase();
    return (contacts.data ?? []).filter((c) => !f || c.name.toLowerCase().includes(f) || c.district.toLowerCase().includes(f) || c.phone.includes(f) || c.country.toLowerCase().includes(f));
  }, [contacts.data, filter]);

  const active = phone ?? contacts.data?.[0]?.phone ?? null;
  const contact = contacts.data?.find((c) => c.phone === active) ?? null;
  const bubbles = active ? threads[active] ?? [] : [];

  const push = (p: string, b: Bubble) => setThreads((t) => ({ ...t, [p]: [...(t[p] ?? []), b] }));

  async function send(body: string) {
    const from = active;
    if (!from || !body.trim() || busy) return;
    setText("");
    setBusy(true);
    push(from, { id: `o${Date.now()}`, dir: "out", text: body, at: new Date() });
    const url = `${window.location.origin}/api/v1/sms/inbound`;
    const params: Record<string, string> = {
      From: from,
      Body: body,
      To: "+15005550006",
      MessageSid: `SM${crypto.getRandomValues(new Uint32Array(4)).reduce((s, n) => s + n.toString(16).padStart(8, "0"), "")}`,
      AccountSid: "ACsimulator",
    };
    try {
      const { signature, signing } = await sign.mutateAsync({ url, params });
      const form = new URLSearchParams(params).toString();
      const t0 = performance.now();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...(signature ? { "X-Twilio-Signature": signature } : {}) },
        body: form,
      });
      const xml = await res.text();
      const latencyMs = Math.round(performance.now() - t0);
      const w: Wire = {
        request: `POST /api/v1/sms/inbound HTTP/1.1\nContent-Type: application/x-www-form-urlencoded${signature ? `\nX-Twilio-Signature: ${signature}` : ""}\n\n${form.replace(/&/g, "\n&")}`,
        url,
        status: res.status,
        latencyMs,
        response: xml,
        command: res.headers.get("X-Agri-Command"),
        language: res.headers.get("X-Agri-Language"),
        segments: res.headers.get("X-Agri-Segments"),
        encoding: res.headers.get("X-Agri-Encoding"),
        signed: signing,
      };
      setWire(w);
      push(from, {
        id: `i${Date.now()}`,
        dir: "in",
        text: res.ok ? parseTwiml(xml) : `HTTP ${res.status}: ${parseTwiml(xml)}`,
        at: new Date(),
        meta: res.ok ? `${w.command ?? "?"} · ${w.language ?? "?"} · ${w.segments ?? "?"} seg` : undefined,
        error: !res.ok,
      });
      utils.admin.smsLog.invalidate();
    } catch (e) {
      push(from, { id: `e${Date.now()}`, dir: "in", text: `Delivery error: ${(e as Error).message}`, at: new Date(), error: true });
      toast.error("Simulator request failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="FEATURE-PHONE FALLBACK"
        title="SMS Simulator"
        description="Text the Agri-SHIELD bot as any registered farmer. Every message is a real Twilio-format webhook to POST /api/v1/sms/inbound — signed with X-Twilio-Signature when TWILIO_AUTH_TOKEN is configured — and the TwiML reply is rendered exactly as the handset would receive it."
      />
      <ErrorNote error={contacts.error} />

      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,360px)_1fr]">
        {/* Contacts */}
        <Panel title="Sender" subtitle={`${contacts.data?.length ?? 0} registered farmers`} icon={Phone} accent="violet" bodyClassName="space-y-3">
          <SearchInput value={filter} onChange={setFilter} placeholder="Name, district, phone…" className="sm:w-full" />
          <div className="max-h-[380px] space-y-1 overflow-y-auto pr-1">
            {!contacts.data ? (
              Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-11" />)
            ) : list.length === 0 ? (
              <EmptyState icon={Search} title="No match" />
            ) : (
              list.map((c) => (
                <button
                  key={c.phone}
                  type="button"
                  onClick={() => setPhone(c.phone)}
                  className={cn("w-full rounded-lg border px-2.5 py-2 text-left transition-colors", active === c.phone ? "border-violet-500/60 bg-violet-500/10" : "border-transparent hover:bg-white/[0.03]")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12.5px] text-slate-100">{c.name}</span>
                    <span className="rounded bg-slate-800 px-1 telemetry text-[9.5px] uppercase text-slate-300">{c.language}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10.5px] text-slate-500">
                    <span className="telemetry">{c.phone}</span>
                    <span className="truncate">
                      {c.district}, {c.country}
                    </span>
                  </div>
                  {c.status !== "active" && <StatusBadge status={c.status} className="mt-1" />}
                </button>
              ))
            )}
          </div>
          <div className="border-t border-white/5 pt-3">
            <div className="hud-label mb-1">Unregistered number</div>
            <div className="flex gap-2">
              <input value={custom} onChange={(e) => setCustom(e.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-slate-700/70 bg-slate-950/60 px-2.5 telemetry text-xs text-slate-100 outline-none focus:border-violet-500/60" aria-label="Custom phone number" />
              <button type="button" onClick={() => setPhone(custom.trim())} className="rounded-lg border border-slate-700 px-2.5 text-xs text-slate-200 hover:border-violet-500/50">
                Use
              </button>
            </div>
          </div>
        </Panel>

        {/* Phone */}
        <div>
          <PhoneFrame
            title="AGRI-SHIELD"
            subtitle={contact ? `${contact.name} · ${contact.phone}` : active ?? "Select a sender"}
            bubbles={bubbles}
            typing={busy}
            footer={
              <div className="space-y-2">
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {CHIPS.map((c) => (
                    <button key={c} type="button" disabled={busy || !active} onClick={() => send(c)} className="shrink-0 rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-[10.5px] text-slate-200 hover:border-violet-500/60 disabled:opacity-40">
                      {c}
                    </button>
                  ))}
                </div>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send(text);
                  }}
                >
                  <input value={text} onChange={(e) => setText(e.target.value)} maxLength={320} placeholder="Text message" className="h-9 min-w-0 flex-1 rounded-full border border-slate-700 bg-slate-950/70 px-3 text-[13px] text-slate-100 outline-none focus:border-violet-500/60" aria-label="Message" />
                  <button type="submit" disabled={busy || !text.trim() || !active} className="grid h-9 w-9 place-items-center rounded-full bg-violet-600 text-white disabled:opacity-40" aria-label="Send">
                    <Send size={15} />
                  </button>
                </form>
              </div>
            }
          />
        </div>

        {/* Wire inspector */}
        <Panel title="Wire inspector" subtitle="Raw webhook exchange" icon={Code2} accent="cyan">
          {!wire ? (
            <EmptyState icon={Code2} title="No request yet">
              Send a message to see the exact form-encoded request Twilio would post and the TwiML the platform returns.
            </EmptyState>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge status={wire.status < 300 ? "ok" : "failed"} label={`HTTP ${wire.status}`} />
                <SourceTag>{fmtMs(wire.latencyMs)}</SourceTag>
                {wire.command && <SourceTag>cmd {wire.command}</SourceTag>}
                {wire.language && <SourceTag>lang {wire.language}</SourceTag>}
                {wire.segments && <SourceTag>{wire.segments} segment(s)</SourceTag>}
                {wire.encoding && <SourceTag>{wire.encoding}</SourceTag>}
                <span className={cn("inline-flex items-center gap-1 text-[10.5px]", wire.signed ? "text-emerald-400" : "text-slate-500")}>
                  {wire.signed ? <ShieldCheck size={12} /> : <ShieldOff size={12} />}
                  {wire.signed ? "Twilio signature verified" : "signing off (no TWILIO_AUTH_TOKEN)"}
                </span>
              </div>
              <div>
                <div className="hud-label mb-1">Request</div>
                <pre className="max-h-56 overflow-auto rounded-lg border border-white/5 bg-[#040811] p-3 telemetry text-[11px] leading-relaxed text-cyan-200/90 whitespace-pre-wrap break-all">{wire.request}</pre>
              </div>
              <div>
                <div className="hud-label mb-1">Response · text/xml</div>
                <pre className="max-h-56 overflow-auto rounded-lg border border-white/5 bg-[#040811] p-3 telemetry text-[11px] leading-relaxed text-emerald-200/90 whitespace-pre-wrap break-all">{wire.response}</pre>
              </div>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Inbound SMS log" subtitle="All numbers · real Twilio traffic and simulator (refreshes every 5 s)" icon={MessageSquareText} accent="violet">
        {!log.data ? (
          <Skeleton className="h-32" />
        ) : log.data.length === 0 ? (
          <EmptyState icon={MessageSquareText} title="No inbound SMS yet" />
        ) : (
          <DataTable head={["When", "From", "Farmer", "Body", "Command", "Lang", "Reply", "Seg", "MT", "Latency"]}>
            {log.data.map((x) => (
              <tr key={x.id}>
                <Td>
                  <TimeAgo date={x.at} />
                </Td>
                <Td mono>{x.fromMasked}</Td>
                <Td>{x.farmerName ?? <span className="text-slate-500">unregistered</span>}</Td>
                <Td className="max-w-[140px] truncate" title={x.body}>
                  {x.body}
                </Td>
                <Td>
                  <StatusBadge status={x.command === "UNKNOWN" ? "degraded" : "ok"} label={x.command} />
                </Td>
                <Td mono>{x.language}</Td>
                <Td className="max-w-[320px] truncate text-slate-400" title={x.reply}>
                  {x.reply}
                </Td>
                <Td mono>
                  {x.segments}
                  <span className="text-slate-600"> {x.encoding === "UCS-2" ? "U" : "G"}</span>
                </Td>
                <Td mono>{x.translatedBy}</Td>
                <Td mono>{fmtMs(x.latencyMs)}</Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </div>
  );
}
