"""RAG advisor with the local grounded composer (no LLM, offline)."""
import asyncio

import pytest

from rag import advisor as advisor_mod
from rag.retriever import get_retriever

FLOOD_CTX = {
    "name": "Rahim Uddin", "crops": ["rice", "jute"], "area_ha": 1.5, "district": "Barisal", "country": "Bangladesh",
    "flood_probability": 0.84, "salinity_ec": 1.2, "forecast_summary": "140 mm rain over 72 h, heavy on day 2",
}
SALT_CTX = {
    "name": "Nguyen Van An", "crops": ["rice"], "area_ha": 0.8, "district": "Bến Tre", "country": "Vietnam",
    "flood_probability": 0.08, "salinity_ec": 7.2, "forecast_summary": "dry, 0 mm next 3 days", "soil_type": "clay loam",
}


def _ask(question, ctx, language="en", history=None):
    return asyncio.run(advisor_mod.advisor.answer(question, ctx, language, history or []))


def test_knowledge_base_loaded():
    r = get_retriever()
    assert len(r.docs) >= 25 and len(r.chunks) > 100


def test_flood_question_contains_expected_actions():
    res = _ask("Heavy rain is coming, what should I do with my rice field?", FLOOD_CTX)
    text = res["answer"].lower()
    assert res["provider"] == "local-grounded"
    for kw in ("drain", "harvest"):
        assert kw in text
    assert "84%" in res["answer"] and "Barisal" in res["answer"]  # uses the farmer's numbers
    ids = {a["id"] for a in res["actions"]}
    assert {"early_harvest", "drain"} <= ids
    assert all(a["urgency"] in ("urgent", "high", "medium", "low") for a in res["actions"])
    assert res["sources"] and all(s["title"] and s["snippet"] for s in res["sources"])


def test_salinity_question_contains_expected_actions():
    res = _ask("My paddy water tastes salty and leaves are burning. How do I fix the salt problem?", SALT_CTX)
    text = res["answer"].lower()
    for kw in ("gypsum", "flush", "sluice"):
        assert kw in text
    assert "7.2 dS/m" in res["answer"]
    assert any(a["id"] == "gypsum" for a in res["actions"])
    assert any("salin" in s["title"].lower() or "salt" in s["title"].lower() or "gypsum" in s["title"].lower() for s in res["sources"])


def test_follow_up_uses_history():
    hist = [{"role": "user", "content": "How do I protect my rice from salinity intrusion?"}, {"role": "assistant", "content": "Flush and apply gypsum."}]
    res = _ask("and for next season?", SALT_CTX, history=hist)
    assert "gypsum" in res["answer"].lower() or "variety" in res["answer"].lower()


def test_low_risk_answer_is_calm():
    ctx = {**FLOOD_CTX, "flood_probability": 0.05, "salinity_ec": 0.6}
    res = _ask("Is there anything I need to do this week?", ctx)
    assert "unlikely" in res["answer"].lower()
    assert not any(a["urgency"] == "urgent" for a in res["actions"])


def test_translation_path(monkeypatch):
    async def fake_translate(texts, lang):
        return [f"[{lang}] {t}" for t in texts], "mymemory"

    monkeypatch.setattr(advisor_mod, "translate_texts", fake_translate)
    res = _ask("Heavy rain is coming, what should I do?", FLOOD_CTX, language="bn")
    assert res["language"] == "bn" and res["answer"].startswith("[bn]")
    assert res["actions"][0]["label"].startswith("[bn]")


def test_translation_failure_falls_back_to_english(monkeypatch):
    async def failing(texts, lang):
        return texts, "failed"

    monkeypatch.setattr(advisor_mod, "translate_texts", failing)
    res = _ask("Heavy rain is coming, what should I do?", FLOOD_CTX, language="vi")
    assert res["language"] == "en" and res["translation"] == "failed"


def test_llm_provider_used_when_available(monkeypatch):
    async def fake_generate(system, messages):
        assert "Current flood risk is 84%" in system and "[1]" in system
        return "1. Drain the field now [1].\n2. Harvest mature rice.", "groq:llama-3.3-70b-versatile"

    monkeypatch.setattr(advisor_mod, "generate", fake_generate)
    res = _ask("What now?", FLOOD_CTX)
    assert res["provider"].startswith("groq") and res["language"] == "en"
    assert {"drain", "early_harvest"} <= {a["id"] for a in res["actions"]}


def test_markdown_chunking_for_translation():
    from rag.translate import _chunks

    text = "Sentence one is here. " * 60
    parts = _chunks(text, 480)
    assert all(len(p) <= 480 for p in parts) and len(parts) > 1
