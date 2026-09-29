"""
RAG-Powered AI Farm Advisor — Agri-SHIELD
=========================================
Pipeline (spec §5.3):

1. Receive the question, farmer context (live flood/salinity risk, crops, area,
   district, forecast) and chat history.
2. Retrieve the top-5 knowledge-base chunks (TF-IDF cosine + metadata boosts)
   from ``rag/knowledge/`` — FAO / IRRI / CGIAR / national-agency grounded guides.
3. Build the spec system prompt with the farmer's numbers and the passages.
4. Generate with the provider chain (Anthropic → OpenAI → Groq → Ollama); when
   no provider is available, the *local grounded composer* builds the answer
   deterministically from the same context and passages (provider
   ``local-grounded``).
5. Post-process: action cards, cited sources, confidence.
6. Translate to the farmer's language (LLMs answer natively; composer output is
   machine-translated via DeepL / MyMemory).
"""
from __future__ import annotations

import logging
import time
from typing import Any

from rag.composer import compose_answer, country_code, detect_intents, extract_actions
from rag.providers import generate
from rag.retriever import detect_hazards, get_retriever
from rag.translate import LANG_NAMES, translate_texts

logger = logging.getLogger(__name__)

SYSTEM_TEMPLATE = (
    "You are Agri-SHIELD's farm advisor. The farmer's name is {name}, they grow {crops} on {area}ha in {district}, {country}. "
    "Current flood risk is {risk}%. Current salinity EC is {ec} dS/m. Today's forecast: {forecast}.{soil}\n\n"
    "Guidelines:\n"
    "- Give practical, prioritised steps the farmer can do in the next 24–72 hours, using their numbers.\n"
    "- Ground your advice in the knowledge passages below and cite them as [1], [2] …; do not invent variety names, "
    "rates or programmes that are not in the passages or widely established.\n"
    "- Use simple language, metric units, at most ~250 words, markdown with a short situation line, a numbered action list "
    "and a one-line 'Watch for' note.\n"
    "- If the risk is high, say clearly what to do first. Mention when to contact the local extension officer.\n"
    "- Answer in {language}.\n\n"
    "Knowledge passages:\n{passages}"
)


class FarmAdvisor:
    async def answer(self, question: str, ctx: dict[str, Any], language: str = "en", history: list[dict] | None = None) -> dict:
        t0 = time.time()
        history = [h for h in (history or []) if h.get("role") in ("user", "assistant") and h.get("content")][-8:]
        retriever = get_retriever()
        cc = country_code(ctx.get("country", ""))
        prev_user = next((h["content"] for h in reversed(history) if h["role"] == "user"), "")
        query = question if len(question.split()) >= 6 else f"{question} {prev_user}"
        intents = detect_intents(query)
        hazards = detect_hazards(query) | ({"flood"} if (ctx.get("flood_probability") or 0) >= 0.5 else set())
        retrieved = retriever.search(f"{query} {' '.join(intents[:2])} {' '.join(ctx.get('crops') or [])}", k=5, country=cc, crops=ctx.get("crops"), hazards=hazards)

        fp = float(ctx.get("flood_probability") or 0.0)
        fp = fp / 100.0 if fp > 1 else fp
        passages = "\n\n".join(f"[{i}] {c.title} — {c.section} (source: {c.source})\n{c.text[:1400]}" for i, (c, _) in enumerate(retrieved, 1))
        system = SYSTEM_TEMPLATE.format(
            name=ctx.get("name") or "the farmer",
            crops=", ".join(ctx.get("crops") or ["rice"]),
            area=ctx.get("area_ha") or "?",
            district=ctx.get("district") or "their district",
            country=ctx.get("country") or "",
            risk=round(fp * 100),
            ec=ctx.get("salinity_ec"),
            forecast=ctx.get("forecast_summary") or "not available",
            soil=f" Soil type: {ctx['soil_type']}." if ctx.get("soil_type") else "",
            language=LANG_NAMES.get(language, "English"),
            passages=passages or "(no passages retrieved)",
        )
        messages = history + [{"role": "user", "content": question}]
        if messages[0]["role"] != "user":
            messages = messages[1:]

        text, provider = await generate(system, messages)
        top_sim = float(sum(s for _, s in retrieved[:3]) / max(len(retrieved[:3]), 1)) if retrieved else 0.0
        translation = "none"
        if text:
            confidence = 0.72 + min(0.2, top_sim * 0.5)
            answer_lang = language
        else:
            provider = "local-grounded"
            text = compose_answer(question, ctx, retrieved, retriever, history)
            confidence = 0.55 + min(0.3, top_sim * 0.8)
            answer_lang = "en"

        actions = extract_actions(text, ctx)
        if language != "en" and answer_lang == "en":
            texts = [text] + [a["label"] for a in actions] + [a["description"] for a in actions]
            translated, translation = await translate_texts(texts, language)
            if translation not in ("failed", "none"):
                text = translated[0]
                n = len(actions)
                for i, a in enumerate(actions):
                    a["label"], a["description"] = translated[1 + i], translated[1 + n + i]
                answer_lang = language

        sources = []
        for c, s in retrieved:
            snippet = " ".join(c.text.replace("**", "").split())[:220]
            sources.append({"title": f"{c.title} — {c.section}", "snippet": snippet, "source": c.source, "doc_id": c.doc_id, "score": round(s, 3)})
        return {
            "answer": text,
            "actions": actions,
            "sources": sources,
            "confidence": round(min(0.95, confidence), 2),
            "language": answer_lang,
            "provider": provider,
            "translation": translation,
            "latency_ms": int((time.time() - t0) * 1000),
        }


advisor = FarmAdvisor()
