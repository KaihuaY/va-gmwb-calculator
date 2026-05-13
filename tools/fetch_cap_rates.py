"""
Cap-rate fetcher — walks the public source registry and produces a proposal
file for K to review.

Strict no-paid-feed design (option E from the math audit):
  - Reads `tools/cap_rate_sources.json` for the list of (slug, segment_index,
    public URL, parser_hint) tuples.
  - Fetches each URL via HTTP (HTTPS only). Times out at 20s; logs failures.
  - For each source, captures the response body (truncated to 32KB) AND
    extracts every plausible "X.XX%" cap rate via a permissive regex —
    the human reviewer (K, the signing actuary) picks the right one based
    on the parser_hint instead of trusting an automated parse.
  - Writes a dated proposal to `backend/data/rate_proposals/{YYYY-MM-DD}.json`
    with current vs. proposed cap rates for the segment. K applies via
    `tools/apply_rate_proposals.py --accept <slug>:<segment_idx>`.

Does NOT:
  - Auto-overwrite any product spec
  - Run on a schedule by itself (call from cron / GitHub Actions / Task Scheduler)
  - Re-rate or re-sign anything

Usage:
    python tools/fetch_cap_rates.py            # walk all sources
    python tools/fetch_cap_rates.py --slug equitable_scs_income
    python tools/fetch_cap_rates.py --dry-run  # don't write the proposal file
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

REPO = Path(__file__).resolve().parent.parent
SOURCES_FILE   = REPO / "tools" / "cap_rate_sources.json"
PRODUCTS_DIR   = REPO / "backend" / "data" / "products"
PROPOSALS_DIR  = REPO / "backend" / "data" / "rate_proposals"

# Plausible cap-rate range in current US RILA market: 4%–25%. Anything outside
# is almost certainly a parser misfire (e.g. fee % or AM Best score).
PCT_RANGE = (0.04, 0.25)
PCT_RE = re.compile(r"\b(\d{1,2}\.\d{1,2})\s*%")


def _load_sources() -> list[dict]:
    data = json.loads(SOURCES_FILE.read_text(encoding="utf-8"))
    return data["sources"]


def _load_product(slug: str) -> dict:
    return json.loads((PRODUCTS_DIR / f"{slug}.json").read_text(encoding="utf-8"))


def _fetch(url: str, timeout: float = 20.0) -> tuple[int, bytes, str]:
    """Return (status_code, body, content_type). Raises on transport failure."""
    if not url.lower().startswith("https://"):
        raise ValueError(f"refusing to fetch non-HTTPS URL: {url}")
    req = Request(url, headers={"User-Agent": "AnnuityVoice-cap-rate-fetcher/1.0"})
    with urlopen(req, timeout=timeout) as resp:  # noqa: S310 — URL is registry-controlled
        return resp.status, resp.read(), resp.headers.get("Content-Type", "")


def _extract_pct_candidates(text: str) -> list[float]:
    """Pull every '4.50%' / '12.25%' substring inside the plausible cap-rate range."""
    out: list[float] = []
    for m in PCT_RE.finditer(text):
        try:
            v = float(m.group(1)) / 100.0
        except ValueError:
            continue
        if PCT_RANGE[0] <= v <= PCT_RANGE[1]:
            out.append(round(v, 4))
    return sorted(set(out))


def _decode_body(body: bytes, ctype: str) -> str:
    """Best-effort text extraction. PDFs are returned as the raw bytes' ASCII
    fallback; the regex will still find cap-rate text in many PDF text streams
    (uncompressed objects) but the human is the source of truth either way."""
    if "pdf" in ctype.lower():
        # Strip non-printable bytes; PDF text streams will still surface enough
        # context for the human reviewer.
        return body[:32_000].decode("latin-1", errors="ignore")
    try:
        return body[:32_000].decode("utf-8", errors="ignore")
    except Exception:
        return body[:32_000].decode("latin-1", errors="ignore")


def fetch_one(source: dict) -> dict:
    """Fetch a single source. Returns a dict suitable for inclusion in the proposal."""
    slug = source["slug"]
    seg_idx = source["segment_index"]
    url = source["url"]

    current_cap: float | None = None
    try:
        spec = _load_product(slug)
        seg = spec["segments_available"][seg_idx]
        current_cap = seg.get("cap_rate")
    except (FileNotFoundError, KeyError, IndexError) as exc:
        return {
            "slug": slug, "segment_index": seg_idx, "url": url,
            "error": f"spec lookup failed: {type(exc).__name__}: {exc}",
        }

    try:
        status, body, ctype = _fetch(url)
    except (URLError, ValueError, TimeoutError) as exc:
        return {
            "slug": slug, "segment_index": seg_idx, "url": url,
            "current_cap": current_cap,
            "error": f"fetch failed: {type(exc).__name__}: {exc}",
        }

    text = _decode_body(body, ctype)
    candidates = _extract_pct_candidates(text)

    return {
        "slug": slug,
        "segment_index": seg_idx,
        "segment_label": source.get("segment_label", ""),
        "url": url,
        "carrier_page": source.get("carrier_page"),
        "parser_hint": source.get("parser_hint", ""),
        "http_status": status,
        "content_type": ctype,
        "current_cap": current_cap,
        "candidate_caps": candidates,
        "best_guess": candidates[0] if candidates else None,
        "delta_vs_current": (
            None if (candidates and current_cap is not None
                     and abs(candidates[0] - current_cap) < 1e-9)
            else (candidates[0] - current_cap if candidates and current_cap is not None else None)
        ),
    }


def main():
    ap = argparse.ArgumentParser(description="Fetch current cap rates from public sources.")
    ap.add_argument("--slug", help="Limit to one product slug")
    ap.add_argument("--dry-run", action="store_true", help="Don't write a proposal file")
    args = ap.parse_args()

    sources = _load_sources()
    if args.slug:
        sources = [s for s in sources if s["slug"] == args.slug]
        if not sources:
            ap.error(f"no sources for slug {args.slug!r}")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    results = []
    for src in sources:
        r = fetch_one(src)
        results.append(r)
        cur = r.get("current_cap")
        cand = r.get("candidate_caps") or []
        err = r.get("error")
        if err:
            print(f"  [FAIL] {r['slug']}[{r['segment_index']}]  {err}")
        else:
            cur_s = f"{cur:.2%}" if cur is not None else "n/a"
            print(
                f"  [ok]   {r['slug']}[{r['segment_index']}]  "
                f"current={cur_s}  candidates={[f'{c:.2%}' for c in cand[:5]]}"
            )

    if args.dry_run:
        print("\n--dry-run: not writing proposal file.")
        return

    PROPOSALS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = PROPOSALS_DIR / f"{today}.json"
    proposal = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "schema_version": 1,
        "note": "Cap-rate proposals. Each candidate_caps entry is a regex hit from the public source body within plausible cap-rate range (4-25%). The signing actuary must verify the right value matches parser_hint before applying.",
        "results": results,
    }
    out_path.write_text(json.dumps(proposal, indent=2), encoding="utf-8")
    print(f"\nWrote proposal: {out_path}  ({len(results)} sources)")


if __name__ == "__main__":
    main()
