"use client";

/**
 * One dashboard widget: HUD frame (title, "What this shows", provenance,
 * refresh state, edit controls, drag + resize handles) around the body,
 * with its data fetched through the single server-side resolver.
 */
import { useMemo } from "react";
import { AlertTriangle, Copy, GripVertical, Settings2, Trash2 } from "lucide-react";
import { SourceTag } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import type { WidgetData } from "@/server/services/widget-data";
import { describeWidget, type Widget } from "./catalog";
import type { RenderState } from "./GridCanvas";
import { WidgetBody } from "./views";
import { ago } from "./format";

export type DataSource = { mode: "app" } | { mode: "shared"; token: string };

/** Only the config matters to the resolver — geometry/title changes never refetch. */
export function useWidgetData(w: Widget, source: DataSource, refreshSec: number) {
  const configKey = JSON.stringify(w.config);
  const input = useMemo(() => ({ widget: { id: w.id, kind: w.kind, title: "", x: 0, y: 0, w: 1, h: 1, config: w.config } }), [w.id, w.kind, configKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const needsData = w.kind !== "note";
  const base = refreshSec > 0 ? refreshSec * 1000 : false;
  // a live feed still loading server-side → poll again soon
  const refetchInterval = (q: { state: { data?: unknown } }) => ((q.state.data as { pending?: boolean } | undefined)?.pending ? 4000 : base);
  const app = trpc.dashboards.widget.useQuery(input, { enabled: needsData && source.mode === "app", refetchInterval, staleTime: 10_000, placeholderData: (p) => p, retry: 1 });
  const shared = trpc.dashboards.sharedWidget.useQuery({ token: source.mode === "shared" ? source.token : "", widgetId: w.id }, { enabled: needsData && source.mode === "shared", refetchInterval, staleTime: 10_000, placeholderData: (p) => p, retry: 1 });
  const q = source.mode === "app" ? app : shared;
  return { data: q.data as WidgetData | undefined, error: q.error, fetching: q.isFetching, updatedAt: q.dataUpdatedAt, refetch: q.refetch };
}

export function WidgetCard({
  widget,
  state,
  source,
  refreshSec,
  onConfigure,
  onDuplicate,
  onRemove,
}: {
  widget: Widget;
  state: RenderState;
  source: DataSource;
  refreshSec: number;
  onConfigure?: () => void;
  onDuplicate?: () => void;
  onRemove?: () => void;
}) {
  const { data, error, fetching, updatedAt, refetch } = useWidgetData(widget, source, refreshSec);
  const explain = data?.explain ?? describeWidget(widget);
  const shared = source.mode === "shared";
  return (
    <section
      className={cn("hud-panel flex h-full flex-col overflow-hidden", state.dragging && "shadow-[0_20px_60px_-20px_rgba(56,189,248,0.6)]")}
      style={{ ["--hud-accent" as string]: "56 189 248" }}
      data-widget-kind={widget.kind}
    >
      <header className="flex items-center gap-1.5 px-3 pb-1.5 pt-2.5">
        {state.editing && (
          <button
            type="button"
            aria-label={`Drag ${widget.title}`}
            className="-ml-1 cursor-grab touch-none rounded p-0.5 text-slate-500 hover:bg-white/5 hover:text-sky-300 active:cursor-grabbing"
            {...state.moveHandle}
          >
            <GripVertical size={14} />
          </button>
        )}
        <h3 className="min-w-0 flex-1 truncate font-display text-[12.5px] font-semibold tracking-wide text-slate-100" title={widget.title}>
          {widget.title}
        </h3>
        <span data-export-hide>
          <Explain title="What this shows" text={explain} iconSize={12} />
        </span>
        {fetching && data && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" title="Refreshing" />}
        {state.editing && (
          <div className="flex items-center" data-export-hide>
            {onConfigure && (
              <button type="button" onClick={onConfigure} className="rounded p-1 text-slate-400 hover:bg-white/5 hover:text-white" aria-label={`Configure ${widget.title}`} title="Configure">
                <Settings2 size={13} />
              </button>
            )}
            {onDuplicate && (
              <button type="button" onClick={onDuplicate} className="rounded p-1 text-slate-400 hover:bg-white/5 hover:text-white" aria-label={`Duplicate ${widget.title}`} title="Duplicate">
                <Copy size={13} />
              </button>
            )}
            {onRemove && (
              <button type="button" onClick={onRemove} className="rounded p-1 text-slate-400 hover:bg-rose-500/10 hover:text-rose-300" aria-label={`Remove ${widget.title}`} title="Remove">
                <Trash2 size={13} />
              </button>
            )}
          </div>
        )}
      </header>
      <div className={cn("relative min-h-0 flex-1 px-3", state.compact ? "pb-2" : "pb-1.5")}>
        {error && !data ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-[11.5px] text-rose-300">
            <AlertTriangle size={16} />
            <span className="max-w-xs">{error.message}</span>
            <button type="button" onClick={() => refetch()} className="text-sky-300 underline underline-offset-2">
              Retry
            </button>
          </div>
        ) : (
          <WidgetBody widget={widget} data={data} ctx={{ shared, compact: state.compact }} />
        )}
      </div>
      {!state.compact && (data?.sources.length || updatedAt) ? (
        <footer className="flex items-center gap-1 overflow-hidden px-3 pb-2 pt-0.5">
          <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-hidden whitespace-nowrap [&>*]:shrink-0">
            {data?.sources.slice(0, 2).map((s) => (
              <SourceTag key={s.label} href={s.href && !s.href.startsWith("/") ? s.href : undefined}>
                {s.label}
              </SourceTag>
            ))}
          </div>
          {updatedAt > 0 && <span className="shrink-0 telemetry text-[9.5px] text-slate-600">{ago(new Date(updatedAt))}</span>}
        </footer>
      ) : null}
      {state.editing && (
        <div aria-hidden className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize touch-none" {...state.resizeHandle} data-export-hide>
          <svg viewBox="0 0 10 10" className="absolute bottom-1 right-1 h-2.5 w-2.5 text-sky-300/70">
            <path d="M9 1 L1 9 M9 5 L5 9" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </div>
      )}
    </section>
  );
}
