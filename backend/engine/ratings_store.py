"""
Read-only loader for product specs, ratings, and methodology JSON files.

Single source of truth for the FastAPI routes — keeps disk access in one place.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Optional

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
PRODUCTS_DIR = DATA_DIR / "products"
RATINGS_DIR  = DATA_DIR / "ratings"
METHOD_DIR   = DATA_DIR / "methodology"


@lru_cache(maxsize=4)
def load_methodology(version: str = "v1") -> dict:
    candidates = [
        METHOD_DIR / f"methodology_{version}.json",
        METHOD_DIR / "methodology_v1.json",
    ]
    for p in candidates:
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
    raise FileNotFoundError(f"methodology {version} not found")


def list_published_ratings() -> list[dict]:
    """Return summaries for every PUBLISHED rating (sorted by composite desc).

    Includes the carrier-feature snapshot so the redesigned index can render
    contract terms (M&E, rider fee, surrender years, AM Best, …) directly in
    the table without a per-row spec fetch.
    """
    out = []
    for path in RATINGS_DIR.glob("*_v*.json"):
        r = json.loads(path.read_text(encoding="utf-8"))
        if r.get("status") != "published":
            continue
        # feature_snapshot is emitted by compute_rating; older drafts may lack it.
        snapshot = r.get("feature_snapshot") or {}
        out.append({
            "slug":                r["product_slug"],
            "name":                r["product_name"],
            "carrier":             r["carrier"],
            "letter_grade":        r["letter_grade"],
            "composite":           r["composite"],
            "sub_scores":          {k: v["score"] for k, v in r["sub_scores"].items()},
            "feature_snapshot":    snapshot,
            "verdict":             r.get("verdict"),
            "methodology_version": r["methodology_version"],
            "signed_by":           r.get("signed_by"),
            "signed_at":           r.get("signed_at"),
            "has_glwb":            snapshot.get("has_glwb", _spec_has_glwb(r["product_slug"])),
        })
    out.sort(key=lambda x: x["composite"], reverse=True)
    return out


def _spec_has_glwb(slug: str) -> bool:
    """Peek at product spec to surface income-rider availability in the list."""
    p = PRODUCTS_DIR / f"{slug}.json"
    if not p.exists():
        return False
    spec = json.loads(p.read_text(encoding="utf-8"))
    return (spec.get("rider") or {}).get("type") == "glwb"


def compute_freshness(slug: str, as_of: Optional[str] = None) -> Optional[dict]:
    """Return per-segment cap-rate freshness for the product, or None if missing.

    `as_of` is YYYY-MM-DD; defaults to today. Status colors map by age (days):
      green  ≤ 30
      yellow ≤ 90
      red    > 90 or unverified
    """
    from datetime import date
    p = PRODUCTS_DIR / f"{slug}.json"
    if not p.exists():
        return None
    spec = json.loads(p.read_text(encoding="utf-8"))
    today = date.fromisoformat(as_of) if as_of else date.today()
    segments = []
    for i, seg in enumerate(spec.get("segments_available", []) or []):
        cap = seg.get("cap_rate")
        verified = seg.get("cap_rate_last_verified")
        source_url = seg.get("cap_rate_source_url")
        age_days = None
        status = "red"
        if verified:
            try:
                d = date.fromisoformat(verified)
                age_days = (today - d).days
                if age_days <= 30:
                    status = "green"
                elif age_days <= 90:
                    status = "yellow"
                else:
                    status = "red"
            except ValueError:
                pass
        segments.append({
            "segment_index": i,
            "term_years":    seg.get("term_years"),
            "crediting_method": seg.get("crediting_method"),
            "cap_rate":      cap,
            "cap_rate_last_verified": verified,
            "cap_rate_source_url":    source_url,
            "age_days":      age_days,
            "status":        status,
        })
    overall = "red"
    if segments:
        if all(s["status"] == "green" for s in segments):
            overall = "green"
        elif any(s["status"] == "green" for s in segments) or all(s["status"] in ("green", "yellow") for s in segments):
            overall = "yellow"
    return {
        "slug": slug,
        "as_of": (as_of or date.today().isoformat()),
        "data_provenance": spec.get("data_provenance", "synthetic_v0"),
        "overall_status": overall,
        "segments": segments,
    }


def load_rating(slug: str) -> Optional[dict]:
    """Return the published rating for `slug`, or None if not found."""
    path = RATINGS_DIR / f"{slug}_v1.json"
    if not path.exists():
        return None
    r = json.loads(path.read_text(encoding="utf-8"))
    if r.get("status") != "published":
        return None
    return r


def load_product_spec(slug: str) -> Optional[dict]:
    path = PRODUCTS_DIR / f"{slug}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))
