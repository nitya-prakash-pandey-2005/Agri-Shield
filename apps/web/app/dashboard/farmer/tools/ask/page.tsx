"use client";

/**
 * Ask an expert — the farmer posts a question (text + optional photo) to their
 * district's extension officers; answers appear here. Officers reply from the
 * government portal (components/farmer/OfficerInbox.tsx → farmer.answerQuestion).
 */
import { useRef, useState } from "react";
import { Camera, Loader2, MessageCircleQuestion, Send, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { EmptyState, HudButton, Panel, Skeleton } from "@/components/hud";
import { CropIcon } from "@/components/farmer/crops";
import { useTranslated } from "@/components/farmer/hooks";
import { Chip, ToolHeader, compressImage } from "@/components/farmer/tools/common";

export default function AskPage() {
  const { t, tx, fmt } = useI18n();
  const utils = trpc.useUtils();
  const profile = trpc.farmer.getProfile.useQuery(undefined, { retry: false });
  const fields = trpc.farmer.getFields.useQuery();
  const q = trpc.farmer.listQuestions.useQuery({ status: "all" }, { refetchInterval: 60_000 });
  const [text, setText] = useState("");
  const [crop, setCrop] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const ask = trpc.farmer.askQuestion.useMutation({
    onSuccess: () => {
      toast.success(t("tools.ask.sent"));
      setText("");
      setPhoto(null);
      void utils.farmer.listQuestions.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const crops = [...new Set((fields.data ?? []).map((f) => f.cropType as string))];
  const tr = useTranslated((q.data ?? []).flatMap((x) => x.answers.map((a) => a.text)));

  return (
    <div className="mx-auto max-w-3xl">
      <ToolHeader icon={MessageCircleQuestion} color="#a78bfa" title={t("tools.ask.title")} subtitle={profile.data ? t("tools.ask.subtitle", { district: profile.data.district.name }) : undefined} />
      <Panel title={t("tools.ask.newQuestion")} icon={Send} accent="violet">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim().length >= 8) ask.mutate({ text: text.trim(), crop, photo });
          }}
        >
          <div className="flex flex-wrap gap-2">
            {crops.map((c) => (
              <Chip key={c} active={crop === c} onClick={() => setCrop(crop === c ? null : c)}>
                <CropIcon crop={c} size={15} /> {tx(`crops.${c}`, undefined, c)}
              </Chip>
            ))}
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={1000} placeholder={t("tools.ask.placeholder")} className="rounded-xl border border-white/10 bg-slate-900 p-3 text-base text-white placeholder:text-slate-600" aria-label={t("tools.ask.newQuestion")} />
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setBusy(true);
              try {
                setPhoto(await compressImage(f));
              } catch {
                toast.error(t("tools.doc.photoError"));
              } finally {
                setBusy(false);
              }
            }} />
            <HudButton type="button" variant="outline" className="min-h-[48px]" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />} {t("tools.doc.addPhoto")}
            </HudButton>
            {photo && (
              <span className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo} alt={t("tools.doc.photoAlt")} className="h-12 w-12 rounded-lg object-cover" />
                <button type="button" onClick={() => setPhoto(null)} className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-slate-800 text-slate-300" aria-label={t("common.remove")}>
                  <X size={12} />
                </button>
              </span>
            )}
            <HudButton type="submit" className="ml-auto min-h-[48px]" disabled={ask.isPending || text.trim().length < 8 || profile.data?.isDemoFallback}>
              {ask.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} {t("tools.ask.send")}
            </HudButton>
          </div>
          <p className="text-[11px] text-slate-500">{t("tools.ask.privacy")}</p>
        </form>
      </Panel>

      <h2 className="mb-2 mt-6 hud-label">{t("tools.ask.myQuestions")}</h2>
      {q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : q.data?.length ? (
        <ul className="space-y-3">
          {q.data.map((x) => (
            <li key={x.id} className="hud-panel p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500">
                  {fmt.relative(x.createdAt)} · {x.districtName}
                </span>
                <span className={cn("rounded px-2 py-0.5 text-[10px] font-semibold", x.status === "answered" ? "bg-emerald-500/20 text-emerald-200" : "bg-amber-500/20 text-amber-200")}>{tx(`tools.ask.st.${x.status}`)}</span>
              </div>
              <p className="mt-1 text-sm text-white">{x.text}</p>
              {x.photo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={x.photo} alt={t("tools.doc.photoAlt")} className="mt-2 max-h-40 rounded-lg" />
              )}
              {x.answers.map((a) => (
                <div key={a.id} className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <div className="mb-1 flex items-center gap-2 text-[11px] text-emerald-300">
                    <UserRound size={13} /> {a.byName} · {fmt.relative(a.at)}
                  </div>
                  <p className="text-sm leading-relaxed text-slate-200">{tr.get(a.text) ?? a.text}</p>
                </div>
              ))}
              {!x.answers.length && <p className="mt-2 text-xs text-slate-500">{t("tools.ask.waiting")}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={MessageCircleQuestion} title={t("tools.ask.none")}>{t("tools.ask.noneHint")}</EmptyState>
      )}
    </div>
  );
}
