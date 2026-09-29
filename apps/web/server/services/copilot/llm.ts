/**
 * Optional LLM planner — OpenAI-compatible function calling.
 *
 *   OPENAI_API_KEY   → api.openai.com/v1/chat/completions   (OPENAI_MODEL, default gpt-4o-mini)
 *   GROQ_API_KEY     → api.groq.com/openai/v1/chat/completions (GROQ_MODEL, default llama-3.3-70b-versatile)
 *   OLLAMA_BASE_URL  → <base>/api/chat with tools              (OLLAMA_MODEL, default llama3.1)
 *
 * The model only chooses tools and writes prose; every number comes from the
 * tool outputs, and artifacts are always built deterministically from them.
 */
import { TOOLS, TOOL_SCHEMAS } from "./tools";
import type { CopilotContext, ToolName, ToolOutput } from "./types";

export type Provider = "openai" | "groq" | "ollama";

export function llmConfig(): { provider: Provider; model: string; url: string; key: string | null } | null {
  if (process.env.COPILOT_PLANNER === "rules") return null;
  if (process.env.OPENAI_API_KEY) return { provider: "openai", model: process.env.OPENAI_MODEL ?? "gpt-4o-mini", url: `${process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/chat/completions`, key: process.env.OPENAI_API_KEY };
  if (process.env.GROQ_API_KEY) return { provider: "groq", model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile", url: "https://api.groq.com/openai/v1/chat/completions", key: process.env.GROQ_API_KEY };
  if (process.env.OLLAMA_BASE_URL) return { provider: "ollama", model: process.env.OLLAMA_MODEL ?? "llama3.1", url: `${process.env.OLLAMA_BASE_URL.replace(/\/$/, "")}/api/chat`, key: null };
  return null;
}

interface Msg {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string | Record<string, unknown> } }[];
  tool_call_id?: string;
  name?: string;
}

export interface LlmRun {
  text: string;
  outputs: { tool: ToolName; args: Record<string, unknown>; out: ToolOutput; ms: number; ok: boolean }[];
  provider: Provider;
}

const SYSTEM = (ctx: CopilotContext) =>
  [
    `You are Agri-SHIELD Copilot, a climate-risk analyst for ${ctx.orgName} (${ctx.industry}). Today is ${new Date().toISOString().slice(0, 10)}.`,
    "Use the tools to fetch facts. Answer ONLY from tool results — never invent assets, places, numbers, dates or sources. If the tools don't contain the answer, say exactly what is missing.",
    "Write concise markdown (short paragraphs or bullets, bold the key numbers, keep units: %, mm, dS/m, USD, /100). Do not paste tables — the UI renders tables, maps and charts from the tool results automatically.",
    "When the user names a place, call assess_location / forecast / compare_places. When they ask about their portfolio, assets, policies, loans or communities, use the portfolio tools.",
  ].join("\n");

async function post(url: string, key: string | null, body: unknown, timeoutMs = 25_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(t);
  }
}

export async function runLlm(ctx: CopilotContext, question: string, history: { q: string; a: string }[]): Promise<LlmRun> {
  const cfg = llmConfig();
  if (!cfg) throw new Error("no LLM configured");
  const tools = TOOL_SCHEMAS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const messages: Msg[] = [{ role: "system", content: SYSTEM(ctx) }];
  for (const h of history.slice(-3)) messages.push({ role: "user", content: h.q }, { role: "assistant", content: h.a.slice(0, 1200) });
  messages.push({ role: "user", content: question });
  const outputs: LlmRun["outputs"] = [];

  for (let round = 0; round < 4; round++) {
    const body =
      cfg.provider === "ollama"
        ? { model: cfg.model, messages, tools, stream: false, options: { temperature: 0.1 } }
        : { model: cfg.model, messages, tools, tool_choice: "auto", temperature: 0.1, max_tokens: 900 };
    const json = await post(cfg.url, cfg.key, body);
    const msg = (cfg.provider === "ollama" ? json.message : (json.choices as { message: Msg }[] | undefined)?.[0]?.message) as Msg | undefined;
    if (!msg) throw new Error("LLM returned no message");
    const calls = msg.tool_calls ?? [];
    if (!calls.length) return { text: (msg.content ?? "").trim(), outputs, provider: cfg.provider };
    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: calls.map((c, i) => ({ ...c, id: c.id ?? `call_${round}_${i}`, type: "function" })) });
    for (const [i, c] of calls.entries()) {
      const name = c.function.name as ToolName;
      let args: Record<string, unknown> = {};
      try {
        args = typeof c.function.arguments === "string" ? (JSON.parse(c.function.arguments || "{}") as Record<string, unknown>) : (c.function.arguments ?? {});
      } catch {
        args = {};
      }
      const fn = TOOLS[name];
      const t0 = Date.now();
      let out: ToolOutput;
      let ok = true;
      if (!fn) {
        ok = false;
        out = { data: { error: `unknown tool ${name}` }, markdown: "", artifacts: [], actions: [], sources: [] };
      } else {
        try {
          out = await fn(ctx, args);
        } catch (err) {
          ok = false;
          out = { data: { error: (err as Error).message }, markdown: "", artifacts: [], actions: [], sources: [] };
        }
      }
      outputs.push({ tool: name, args, out, ms: Date.now() - t0, ok });
      messages.push({ role: "tool", tool_call_id: c.id ?? `call_${round}_${i}`, name, content: JSON.stringify(out.data).slice(0, 7000) });
    }
  }
  throw new Error("LLM did not finish within 4 tool rounds");
}
