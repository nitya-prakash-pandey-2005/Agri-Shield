"use client";

import { SnippetTabs } from "./CodeBlock";
import { WEBHOOK_VERIFY, snippet } from "./snippets";

/** Client wrappers so server pages can render language tabs (functions can't cross the RSC boundary). */
export function PortalSnippet({ url, method = "GET" }: { url: string; method?: string }) {
  return <SnippetTabs make={(l) => snippet(l, { method, url })} initial="python" />;
}

export function WebhookVerifySnippet() {
  return <SnippetTabs make={(l) => WEBHOOK_VERIFY[l]} initial="javascript" />;
}
