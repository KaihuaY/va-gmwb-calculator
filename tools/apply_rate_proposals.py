"""
Apply reviewed cap-rate proposals to product specs and append to rate-history log.

Workflow (the signing actuary owns the gate):
  1. `python tools/fetch_cap_rates.py` writes a dated proposal file under
     `backend/data/rate_proposals/{YYYY-MM-DD}.json`.
  2. K reviews the proposal: looks at `candidate_caps`, `parser_hint`,
     opens the source URL, picks the correct cap.
  3. K runs this tool with explicit accept lines:
       python tools/apply_rate_proposals.py 2026-05-13 \
           --accept equitable_scs_income:0:0.10 \
           --accept jackson_market_link_pro:0:0.095
     Format: <slug>:<segment_index>:<decimal_cap_rate>
  4. This tool:
       a. Loads the product spec, updates `segments_available[idx].cap_rate`
       b. Updates `segments_available[idx].cap_rate_last_verified` to today
       c. Appends to `backend/data/rate_history/{slug}.json` (audit trail)
       d. DOES NOT re-rate or re-sign — that's a separate manual step.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

REPO          = Path(__file__).resolve().parent.parent
PRODUCTS_DIR  = REPO / "backend" / "data" / "products"
PROPOSALS_DIR = REPO / "backend" / "data" / "rate_proposals"
HISTORY_DIR   = REPO / "backend" / "data" / "rate_history"

ACCEPT_RE = re.compile(r"^(?P<slug>[a-z0-9_]+):(?P<idx>\d+):(?P<rate>0\.\d{1,6})$")


def _parse_accept(s: str) -> tuple[str, int, float]:
    m = ACCEPT_RE.match(s.strip())
    if not m:
        raise argparse.ArgumentTypeError(
            f"--accept must be <slug>:<segment_index>:<decimal_rate>, got {s!r}"
        )
    return m["slug"], int(m["idx"]), float(m["rate"])


def _apply_one(slug: str, seg_idx: int, new_cap: float, today: str, source_url: str) -> dict:
    spec_path = PRODUCTS_DIR / f"{slug}.json"
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    seg = spec["segments_available"][seg_idx]
    old_cap = seg.get("cap_rate")
    seg["cap_rate"] = new_cap
    seg["cap_rate_last_verified"] = today
    if source_url:
        seg["cap_rate_source_url"] = source_url
    spec_path.write_text(json.dumps(spec, indent=2), encoding="utf-8")

    # Append to history (one file per slug; one event per accept)
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    hpath = HISTORY_DIR / f"{slug}.json"
    history = json.loads(hpath.read_text(encoding="utf-8")) if hpath.exists() else {
        "slug": slug, "events": [],
    }
    history["events"].append({
        "date": today,
        "segment_index": seg_idx,
        "field": "cap_rate",
        "previous": old_cap,
        "new": new_cap,
        "source_url": source_url,
    })
    hpath.write_text(json.dumps(history, indent=2), encoding="utf-8")
    return {"slug": slug, "segment_index": seg_idx, "old": old_cap, "new": new_cap}


def _resolve_proposal_path(ref: str) -> Path:
    """Accept several forms: 'latest', 'YYYYMMDD-HHMMSS', or a full filename
    like 'rate_proposals/20260513-160000.json'."""
    if ref == "latest":
        latest = PROPOSALS_DIR / "latest.json"
        if not latest.exists():
            raise FileNotFoundError("no rate_proposals/latest.json — run fetch_cap_rates first")
        meta = json.loads(latest.read_text(encoding="utf-8"))
        return PROPOSALS_DIR / meta["latest_path"]
    # Direct path
    p = Path(ref)
    if p.exists():
        return p
    # Stem in PROPOSALS_DIR
    p2 = PROPOSALS_DIR / f"{ref}.json"
    if p2.exists():
        return p2
    raise FileNotFoundError(f"no proposal at {ref!r}")


def _extract_best_source_url(proposal_entry: dict) -> str:
    """Pull the URL of the attempt that produced candidate_caps (the one K likely
    consulted). Falls back to whichever URL was tried first."""
    attempts = proposal_entry.get("attempts") or []
    for a in attempts:
        if a.get("candidate_caps"):
            return a.get("url", "")
    return attempts[0].get("url", "") if attempts else ""


def main():
    ap = argparse.ArgumentParser(description="Apply reviewed cap-rate proposals.")
    ap.add_argument(
        "proposal",
        help="Proposal reference: 'latest', a timestamp (YYYYMMDD-HHMMSS), or a full path",
    )
    ap.add_argument(
        "--accept", action="append", type=_parse_accept, required=True,
        help="<slug>:<segment_index>:<decimal_cap>, repeatable",
    )
    args = ap.parse_args()

    try:
        proposal_path = _resolve_proposal_path(args.proposal)
    except FileNotFoundError as exc:
        ap.error(str(exc))
    proposal = json.loads(proposal_path.read_text(encoding="utf-8"))
    by_key = {(r["slug"], r["segment_index"]): r for r in proposal.get("results", [])}

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for slug, seg_idx, new_cap in args.accept:
        key = (slug, seg_idx)
        if key not in by_key:
            print(f"  ✗ {slug}[{seg_idx}]  not in proposal {proposal_path.name}; skipping")
            continue
        # Handle both legacy schema (proposal.results[i].url) and v2 schema
        # (proposal.results[i].attempts[*].url with carrier/edgar kinds).
        entry = by_key[key]
        src_url = _extract_best_source_url(entry) or entry.get("url", "")
        result = _apply_one(slug, seg_idx, new_cap, today, src_url)
        old = result["old"]
        delta = (new_cap - old) if old is not None else None
        delta_str = f"  delta={delta*100:+.2f}pp" if delta is not None else ""
        print(f"  [ok] {slug}[{seg_idx}]  {old} -> {new_cap}{delta_str}")

    print(
        f"\nApplied {len(args.accept)} update(s) from {proposal_path.name}. "
        f"Re-rate with `python tools/rate_product.py --all` and re-sign with "
        f"`tools/publish_rating.py --all --sign ...` to publish."
    )


if __name__ == "__main__":
    main()
