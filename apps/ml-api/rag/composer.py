"""
Local grounded composer — Agri-SHIELD advisor
=============================================
Used when no LLM provider is configured (or all fail). It is *not* a language
model: it deterministically composes a markdown answer from

  1. the farmer's live context (72 h flood probability, soil EC, crops, area,
     district, forecast) compared against agronomic thresholds, and
  2. actionable steps extracted from the top retrieved knowledge-base passages,
     ranked by similarity to the question and cited as [n].

It also hosts the action-card extraction used for every provider's answer.
"""
from __future__ import annotations

import re
from typing import Optional

import numpy as np
from sklearn.metrics.pairwise import linear_kernel

from models.salinity_predictor import CROP_EC_THRESHOLDS, crop_damage_curve
from rag.retriever import Chunk, Retriever

ACTION_VERBS = (
    "drain", "harvest", "apply", "flush", "transplant", "store", "move", "close", "open", "check", "clear",
    "measure", "test", "insure", "report", "delay", "spray", "plant", "sow", "repair", "keep", "use", "avoid",
    "photograph", "contact", "raise", "cover", "irrigate", "pond", "mulch", "switch", "vaccinate",
)

COUNTRY_SUPPORT = {
    "BD": {"officer": "your Upazila Agriculture Officer (DAE)", "insurance": "weather-index crop insurance (Sadharan Bima Corporation) and DAE relief registration", "variety": "BRRI dhan 67 or BINA dhan 10 (salt-tolerant boro), BRRI dhan 51/52 (submergence-tolerant aman)"},
    "IN": {"officer": "your Block / Assistant Agriculture Officer", "insurance": "PMFBY — report localised inundation within 72 hours", "variety": "Swarna-Sub1 for flood-prone fields; CSR / Luna series (ICAR-NRRI) for saline fields"},
    "PH": {"officer": "your Municipal Agriculturist (MAO)", "insurance": "PCIC crop insurance — file a notice of loss promptly (about 10 days)", "variety": "NSIC Rc 194 'Submarino 1' for flood-prone fields; NSIC 'Salinas' lines for saline fields"},
    "VN": {"officer": "your commune agricultural extension officer", "insurance": "agricultural insurance under Decree 58/2018 where available", "variety": "salt-tolerant OM-series varieties recommended by your provincial DARD"},
    "ID": {"officer": "your field extension worker (PPL)", "insurance": "AUTP rice insurance (premium largely subsidised)", "variety": "Inpari 30 Ciherang Sub1 for flood-prone fields; Inpara varieties for tidal/saline fields"},
}
COUNTRY_CODES = {"bangladesh": "BD", "india": "IN", "philippines": "PH", "vietnam": "VN", "viet nam": "VN", "indonesia": "ID"}

INTENTS = {
    "flood": ["flood", "rain", "submerg", "drain", "storm", "typhoon", "cyclone", "river", "pump", "waterlog", "inundat"],
    "salinity": ["salt", "salin", " ec ", "brackish", "gypsum", "sluice", "saline", "tide", "tidal"],
    "harvest": ["harvest", "mature", "reap", "cut"],
    "insurance": ["insur", "claim", "compensation", "pmfby", "pcic", "autp"],
    "fertilizer": ["fertili", "urea", "npk", "potash", "nitrogen", "manure"],
    "pest": ["pest", "disease", "blight", "insect", "hopper", "rat", "fung"],
    "livestock": ["cow", "cattle", "goat", "livestock", "duck", "chicken", "poultry", "buffalo", "fish", "pond"],
    "storage": ["store", "storage", "seed", "grain", "godown"],
    "variety": ["variety", "varieties", "seed type", "tolerant", "what to plant", "which crop", "grow instead"],
}


def country_code(country: str) -> str:
    c = (country or "").strip()
    return c.upper() if len(c) == 2 else COUNTRY_CODES.get(c.lower(), "BD")


def detect_intents(text: str) -> list[str]:
    t = f" {text.lower()} "
    hits = [(name, sum(t.count(k) for k in kws)) for name, kws in INTENTS.items()]
    return [n for n, c in sorted(hits, key=lambda x: -x[1]) if c > 0]


def flood_band(p: float) -> str:
    if p >= 0.8:
        return "critical"
    if p >= 0.6:
        return "high"
    if p >= 0.35:
        return "medium"
    return "low"


def _clean(s: str) -> str:
    s = re.sub(r"\*\*(.+?)\*\*", r"\1", s)
    s = re.sub(r"^\s*(?:[-*]|\d+[.)])\s+", "", s)
    return re.sub(r"\s+", " ", s).strip()


def extract_steps(chunks: list[tuple[Chunk, float]], retriever: Retriever, query: str, k: int = 4) -> list[tuple[str, int]]:
    """Pick the most question-relevant actionable sentences/list items; returns (text, source_index)."""
    cands: list[tuple[str, int]] = []
    for idx, (c, _) in enumerate(chunks):
        for line in c.text.splitlines():
            raw = line.strip()
            if not raw or raw.startswith("#") or raw.startswith("|"):
                continue
            items = [raw] if re.match(r"^(?:[-*]|\d+[.)])\s+", raw) else re.split(r"(?<=[.!?])\s+", raw)
            for it in items:
                t = _clean(it)
                if 35 <= len(t) <= 280 and any(re.search(rf"\b{v}", t.lower()) for v in ACTION_VERBS):
                    cands.append((t, idx))
    if not cands:
        return []
    qv = retriever.vectorizer.transform([query])
    sims = linear_kernel(qv, retriever.vectorizer.transform([c for c, _ in cands])).ravel()
    bonus = np.array([0.04 * bool(re.search(r"\d", c)) + 0.03 * bool(re.match(rf"({'|'.join(ACTION_VERBS)})\b", c.lower())) for c, _ in cands])
    order = np.argsort(-(sims + bonus))
    out, seen, per_src = [], set(), {}
    for i in order:
        text, src = cands[i]
        key = text.lower()[:60]
        if key in seen or per_src.get(src, 0) >= 2:
            continue
        seen.add(key)
        per_src[src] = per_src.get(src, 0) + 1
        out.append((text, src))
        if len(out) >= k:
            break
    return out


def _crop_lines(crops: list[str], ec: float) -> tuple[list[str], list[str]]:
    """Per-crop salinity status lines and the crops above their threshold."""
    lines, stressed = [], []
    for crop in crops:
        t = CROP_EC_THRESHOLDS.get(crop.lower())
        if not t:
            continue
        dmg = float(crop_damage_curve(crop.lower(), ec))
        if ec >= t["sensitive"]:
            stressed.append(crop)
            lines.append(f"**{crop.title()}**: EC {ec:.1f} dS/m is above its {t['sensitive']:.1f} dS/m threshold — damage probability about **{dmg:.0%}**.")
        else:
            lines.append(f"**{crop.title()}**: within tolerance (threshold {t['sensitive']:.1f} dS/m, {t['sensitive'] - ec:.1f} dS/m headroom).")
    return lines, stressed


def compose_answer(question: str, ctx: dict, retrieved: list[tuple[Chunk, float]], retriever: Retriever, history: Optional[list[dict]] = None) -> str:
    fp = float(ctx.get("flood_probability") or 0.0)
    fp = fp / 100.0 if fp > 1.0 else fp
    ec = float(ctx.get("salinity_ec") or 0.0)
    crops = [c for c in (ctx.get("crops") or ["rice"]) if c] or ["rice"]
    district = ctx.get("district") or "your district"
    area = ctx.get("area_ha")
    cc = country_code(ctx.get("country", ""))
    sup = COUNTRY_SUPPORT.get(cc, COUNTRY_SUPPORT["BD"])
    band = flood_band(fp)
    prev_q = next((h.get("content", "") for h in reversed(history or []) if h.get("role") == "user"), "")
    intents = detect_intents(question) or detect_intents(prev_q)
    crop_lines, stressed = _crop_lines(crops, ec)
    min_thr = min((CROP_EC_THRESHOLDS.get(c.lower(), CROP_EC_THRESHOLDS["rice"])["sensitive"] for c in crops), default=3.0)
    sal_issue = ec >= min(2.0, min_thr) or "salinity" in intents
    flood_issue = fp >= 0.35 or "flood" in intents

    name = (ctx.get("name") or "").split(" ")[0]
    crop_txt = ", ".join(crops)
    area_txt = f" on {area:g} ha" if isinstance(area, (int, float)) and area else ""
    out = [
        f"{name + ', b' if name else 'B'}ased on your soil EC of **{ec:.1f} dS/m** and 72-hour flood probability of **{fp:.0%}** in **{district}** "
        f"(forecast: {ctx.get('forecast_summary') or 'n/a'}), here is what matters for your {crop_txt}{area_txt}:",
        "",
        "### Your situation",
        f"- **Flood risk — {band}.** " + {
            "critical": "Flooding is very likely within 72 hours; act today.",
            "high": "Flooding is more likely than not within 72 hours; protect the crop now.",
            "medium": "Flooding is possible; prepare so you can act quickly.",
            "low": "Flooding is unlikely in the next 72 hours.",
        }[band],
    ]
    out += [f"- {line}" for line in crop_lines]
    if ctx.get("soil_type"):
        out.append(f"- Soil: {ctx['soil_type']} — " + ("heavy soils drain and leach slowly; allow extra flushes." if "clay" in str(ctx["soil_type"]).lower() else "lighter soils leach salt faster but hold less water."))

    steps: list[str] = []
    flood_steps: list[str] = []
    if band in ("critical", "high"):
        flood_steps += [
            f"**Harvest** any {crops[0]} that is 80–85% mature now, before the rain peaks — a slightly early harvest loses far less than a submerged crop.",
            "**Drain** the fields: open outlets, clear channels toward the canal and lower standing water to 5 cm or less.",
            "**Move** seed, fertiliser, harvested grain, pumps and livestock to raised ground; keep seed in sealed bags off the floor.",
            f"Photograph your fields today and contact {sup['officer']}; register the loss for {sup['insurance']}.",
        ]
    elif band == "medium":
        flood_steps += [
            "**Drain** proactively: clear and deepen field channels and check bunds for weak spots.",
            f"Plan to **harvest** early if the {crops[0]} is close to maturity and the next forecast update worsens.",
            "If heavy rain is forecast, delay urea top-dressing until it has passed to avoid nitrogen runoff.",
        ]
    elif flood_issue:
        flood_steps += ["Keep drains clear so you can **drain** quickly if rainfall intensifies, and check the forecast again this evening."]
    sal_steps: list[str] = []
    if sal_issue and band in ("critical", "high") and "salinity" not in intents[:2]:
        # Flood first: heavy rain will itself leach salts; defer amendments until the water recedes.
        sal_steps.append(
            f"Salinity ({ec:.1f} dS/m) is secondary right now — the coming rain will help leach salts. "
            "After the water recedes, re-test soil EC before transplanting and **flush** or **apply gypsum** only if EC is still above the crop threshold."
        )
    elif sal_issue:
        if stressed or ec >= 4:
            sal_steps += [
                "**Flush** the field with fresh water (EC below about 1–2 dS/m): pond 5–10 cm for 1–2 days, then drain; repeat 2–3 times.",
                "**Apply gypsum** at about 2–5 t/ha (rate from a soil test) and mix into the top 10–15 cm before flushing, especially if the soil crusts or drains slowly.",
            ]
        sal_steps += [
            "Measure canal water EC before every irrigation and irrigate only when it is below about 2 dS/m; **close sluice gates at high tide** during the dry season.",
        ]
        if stressed:
            sal_steps.append(f"For the next season consider {sup['variety']}.")
        if ec >= 2 and not stressed:
            sal_steps.append("Mulch with straw (about 3–5 t/ha) to reduce salt rising to the surface, and re-test EC weekly.")

    order = ["salinity", "flood"] if (intents[:1] == ["salinity"] or (not flood_issue and sal_issue)) else ["flood", "salinity"]
    for o in order:
        steps += flood_steps if o == "flood" else sal_steps
    if "insurance" in intents and not any("insurance" in s.lower() for s in steps):
        steps.append(f"For compensation, use {sup['insurance']}; keep photos, dated notes and your land record ready.")
    if "livestock" in intents:
        steps.append("Move animals to a raised mound or shelter with 3–5 days of dry fodder and clean water; vaccinate after the flood as advised by the livestock officer.")
    if not steps:
        steps.append("No urgent action is needed; keep field drains clear and re-check the risk panel after the next forecast update.")

    query = " ".join([question, prev_q if len(question.split()) < 6 else "", " ".join(intents[:2]), crop_txt])
    kb_steps = extract_steps(retrieved, retriever, query, k=4)

    out += ["", "### What to do now"]
    out += [f"{i}. {s}" for i, s in enumerate(steps[:6], 1)]
    if kb_steps:
        out += ["", "### From the field guides"]
        out += [f"- {t} [{src + 1}]" for t, src in kb_steps]
    watch = []
    if band in ("critical", "high", "medium"):
        watch.append("after the water recedes, drain gradually and top-dress about 20–30 kg N/ha once new leaves appear; scout for bacterial leaf blight")
    if sal_issue:
        watch.append("leaf-tip burning and white crusts are signs salinity is rising — re-test EC")
    if watch:
        out += ["", "**Watch for:** " + "; ".join(watch) + "."]
    if retrieved:
        by_doc: dict[str, list[int]] = {}
        for i, (c, _) in enumerate(retrieved, 1):
            by_doc.setdefault(c.doc_id, []).append(i)
        first = {c.doc_id: c for c, _ in reversed(retrieved)}
        out += ["", "**Sources:** " + "; ".join("".join(f"[{i}]" for i in idx) + f" {first[d].title} — {first[d].source.split(';')[0]}" for d, idx in by_doc.items())]
    return "\n".join(out)


# ─── Action cards ──────────────────────────────────────────────────────────

ACTION_CATALOG = [
    ("early_harvest", ["harvest"], "Harvest mature crop early", "Harvest fields that are 80–85% mature before rainfall peaks", "flood"),
    ("drain", ["drain", "outlet", "channel"], "Clear drainage channels", "Open field outlets and lower standing water before the rain", "flood"),
    ("protect_inputs", ["raised ground", "seed", "sealed bag", "move seed"], "Protect seed, grain & equipment", "Move seed, fertiliser, grain and pumps to raised ground", "flood"),
    ("freshwater_flush", ["flush", "leach"], "Flush salts with fresh water", "Pond 5–10 cm of fresh water, then drain; repeat 2–3 times", "salinity"),
    ("gypsum", ["gypsum"], "Apply gypsum", "About 2–5 t/ha after a soil test, mixed into the topsoil", "salinity"),
    ("sluice_gates", ["sluice"], "Close sluice gates at high tide", "Keep saline water out; drain at low tide", "salinity"),
    ("test_ec", ["measure canal", "ec before", "re-test ec", "soil test"], "Test water & soil EC", "Irrigate only when canal water is below ~2 dS/m", "salinity"),
    ("tolerant_variety", ["tolerant", "sub1", "variety"], "Plan a tolerant variety", "Choose submergence- or salt-tolerant seed for next season", "salinity"),
    ("insurance", ["insur", "pmfby", "pcic", "autp", "claim"], "Register loss / insurance", "Photograph damage and file with the insurer or extension office", "general"),
    ("officer", ["officer", "agriculturist", "extension", "ppl"], "Contact extension officer", "Request pump, seed or relief support", "general"),
    ("livestock", ["livestock", "animals", "cattle", "fodder"], "Move livestock to safety", "Raised shelter with fodder and clean water", "flood"),
    ("delay_fertilizer", ["urea", "top-dress", "fertili"], "Delay fertiliser", "Wait until heavy rain passes to avoid nutrient loss", "flood"),
]
URGENCY_RANK = {"urgent": 0, "high": 1, "medium": 2, "low": 3}


def extract_actions(answer: str, ctx: dict, limit: int = 4) -> list[dict]:
    text = re.split(r"\*\*sources:?\*\*", answer.lower())[0]
    if "### what to do now" in text:  # composer answers: rank by the action list, not the situation summary
        text = text.split("### what to do now", 1)[1]
    fp = float(ctx.get("flood_probability") or 0.0)
    fp = fp / 100.0 if fp > 1.0 else fp
    ec = float(ctx.get("salinity_ec") or 0.0)
    crops = ctx.get("crops") or ["rice"]
    min_thr = min((CROP_EC_THRESHOLDS.get(str(c).lower(), CROP_EC_THRESHOLDS["rice"])["sensitive"] for c in crops), default=3.0)

    def urgency(kind: str) -> str:
        if kind == "flood":
            return "urgent" if fp >= 0.6 else "high" if fp >= 0.35 else "medium" if fp >= 0.2 else "low"
        if kind == "salinity":
            return "urgent" if ec >= 8 else "high" if ec >= min_thr else "medium" if ec >= 2 else "low"
        return "high" if fp >= 0.6 or ec >= 8 else "medium"

    found = []
    for aid, kws, label, desc, kind in ACTION_CATALOG:
        pos = [text.find(k) for k in kws if k in text]
        if pos:
            found.append((min(pos), {"id": aid, "label": label, "description": desc, "urgency": urgency(kind)}))
    # most urgent first; within the same urgency, in the order the answer prioritises them
    found.sort(key=lambda t: (URGENCY_RANK[t[1]["urgency"]], t[0]))
    return [a for _, a in found[:limit]]
