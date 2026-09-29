"""
Knowledge-base retriever — Agri-SHIELD advisor
==============================================
Loads the markdown knowledge base in ``rag/knowledge/`` (front matter with
``id, title, source, countries, crops, hazards``), splits each document into
section-level chunks, and retrieves the top-k chunks for a question with
TF-IDF (word 1–2-grams, sublinear tf) cosine similarity plus small metadata
boosts for the farmer's country, crops and the question's hazard.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Optional

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import linear_kernel

logger = logging.getLogger(__name__)

KNOWLEDGE_DIR = Path(__file__).resolve().parent / "knowledge"

HAZARD_KEYWORDS = {
    "flood": ["flood", "rain", "submerg", "water level", "drain", "inundat", "waterlog", "river", "typhoon", "monsoon", "pump"],
    "salinity": ["salin", "salt", "ec ", "dS/m", "brackish", "gypsum", "sluice", "saline", "tide", "tidal", "leach"],
    "cyclone": ["cyclone", "storm", "typhoon", "surge", "wind"],
    "drought": ["drought", "dry", "water saving", "irrigat", "awd"],
}


@dataclass
class Chunk:
    doc_id: str
    title: str
    section: str
    source: str
    text: str
    countries: list[str] = field(default_factory=list)
    crops: list[str] = field(default_factory=list)
    hazards: list[str] = field(default_factory=list)


def _parse_list(v: str) -> list[str]:
    v = v.strip()
    if v.startswith("[") and v.endswith("]"):
        v = v[1:-1]
    return [x.strip().strip("'\"").lower() for x in v.split(",") if x.strip()]


def parse_document(path: Path) -> tuple[dict, str]:
    raw = path.read_text(encoding="utf-8")
    meta: dict = {}
    body = raw
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n", raw, re.S)
    if m:
        for line in m.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip()
        body = raw[m.end():]
    meta.setdefault("id", path.stem)
    t = re.search(r"^#\s+(.+)$", body, re.M)
    meta.setdefault("title", t.group(1).strip() if t else path.stem.replace("-", " ").title())
    return meta, body


def chunk_document(meta: dict, body: str, max_words: int = 220) -> list[Chunk]:
    """Split on '## ' headings; long sections are split on paragraph boundaries."""
    sections = re.split(r"^##\s+", body, flags=re.M)
    chunks: list[Chunk] = []
    intro = re.sub(r"^#\s+.+$", "", sections[0], flags=re.M).strip()
    parts = ([("Overview", intro)] if intro else []) + [
        (s.split("\n", 1)[0].strip(), s.split("\n", 1)[1].strip() if "\n" in s else "") for s in sections[1:]
    ]
    for heading, text in parts:
        paras, buf = re.split(r"\n\s*\n", text), []
        for p in paras:
            buf.append(p.strip())
            if sum(len(b.split()) for b in buf) >= max_words:
                chunks.append(_mk(meta, heading, "\n\n".join(buf)))
                buf = []
        if buf and any(buf):
            chunks.append(_mk(meta, heading, "\n\n".join(buf)))
    return chunks


def _mk(meta: dict, heading: str, text: str) -> Chunk:
    return Chunk(
        doc_id=meta["id"],
        title=meta["title"],
        section=heading,
        source=meta.get("source", "Agri-SHIELD knowledge base"),
        text=text,
        countries=[c.upper() for c in _parse_list(meta.get("countries", ""))],
        crops=_parse_list(meta.get("crops", "")),
        hazards=_parse_list(meta.get("hazards", "")),
    )


def detect_hazards(text: str) -> set[str]:
    t = text.lower()
    return {h for h, kws in HAZARD_KEYWORDS.items() if any(k.lower() in t for k in kws)}


class Retriever:
    def __init__(self, knowledge_dir: Path = KNOWLEDGE_DIR):
        self.chunks: list[Chunk] = []
        for path in sorted(knowledge_dir.glob("*.md")):
            try:
                meta, body = parse_document(path)
                self.chunks.extend(chunk_document(meta, body))
            except Exception as e:
                logger.warning("skipping knowledge doc %s: %s", path.name, e)
        self.docs = sorted({c.doc_id for c in self.chunks})
        corpus = [f"{c.title}. {c.section}. {c.text}" for c in self.chunks] or ["empty"]
        self.vectorizer = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True, stop_words="english", min_df=1, max_df=0.6)
        self.matrix = self.vectorizer.fit_transform(corpus)
        logger.info("Knowledge base: %d documents, %d chunks", len(self.docs), len(self.chunks))

    def search(
        self,
        query: str,
        k: int = 5,
        country: Optional[str] = None,
        crops: Optional[list[str]] = None,
        hazards: Optional[set[str]] = None,
    ) -> list[tuple[Chunk, float]]:
        if not self.chunks:
            return []
        q = self.vectorizer.transform([query])
        sims = linear_kernel(q, self.matrix).ravel()
        boost = np.zeros_like(sims)
        crops_l = {c.lower() for c in (crops or [])}
        for i, c in enumerate(self.chunks):
            if country and country.upper() in c.countries:
                boost[i] += 0.03
            if crops_l and crops_l.intersection(c.crops):
                boost[i] += 0.03
            if hazards and hazards.intersection(c.hazards):
                boost[i] += 0.05
        scores = sims + boost * (sims > 0)
        order = np.argsort(-scores)
        out: list[tuple[Chunk, float]] = []
        per_doc: dict[str, int] = {}
        for i in order:
            if scores[i] <= 0:
                break
            c = self.chunks[i]
            if per_doc.get(c.doc_id, 0) >= 2:  # diversity: max 2 chunks per document
                continue
            per_doc[c.doc_id] = per_doc.get(c.doc_id, 0) + 1
            out.append((c, float(scores[i])))
            if len(out) >= k:
                break
        return out


@lru_cache(maxsize=1)
def get_retriever() -> Retriever:
    return Retriever()
