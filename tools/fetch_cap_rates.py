"""
Cap-rate fetcher — walks the public source registry and produces an
append-only proposal file + raw response archive for K to review.

Strict no-paid-feed design (option E from the math audit):
  - Reads `tools/cap_rate_sources.json` for the list of sources. Each source
    can specify primary `url` (carrier site) plus optional `edgar_filing_url`
    (SEC 497 supplement). Fetcher tries each URL until one returns a body
    containing plausible cap-rate text.
  - Fetches via HTTPS. Times out at 20s; logs failures.
  - Archives the raw response body verbatim to
        backend/data/rate_pulls/{YYYYMMDD-HHMMSS}/{slug}_{seg}_{kind}.{ext}
    so every pull leaves an immutable audit trail — useful when carriers
    rotate URLs or the regex parser misses something.
  - Writes a TIMESTAMPED proposal to
        backend/data/rate_proposals/{YYYYMMDD-HHMMSS}.json
    so running fetch twice on the same day does NOT overwrite the earlier
    pull. A `rate_proposals/latest.json` pointer is also written.
  - Captures every plausible "X.XX%" candidate; K (signing actuary) picks
    the right one based on parser_hint AND the archived raw body.

Does NOT:
  - Auto-overwrite any product spec
  - Run on a schedule by itself (manual / cron / GitHub Actions trigger)
  - Re-rate or re-sign anything

Usage:
    python tools/fetch_cap_rates.py            # walk all sources
    python tools/fetch_cap_rates.py --slug equitable_scs_income
    python tools/fetch_cap_rates.py --dry-run  # no proposal or archive write
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

REPO = Path(__file__).resolve().parent.parent
SOURCES_FILE   = REPO / "tools" / "cap_rate_sources.json"
PRODUCTS_DIR   = REPO / "backend" / "data" / "products"
PROPOSALS_DIR  = REPO / "backend" / "data" / "rate_proposals"
PULLS_DIR      = REPO / "backend" / "data" / "rate_pulls"

# Plausible cap-rate range in current US RILA market: 4%–25%. Anything outside
# is almost certainly a parser misfire (e.g. fee % or AM Best score).
PCT_RANGE = (0.04, 0.25)
PCT_RE = re.compile(r"\b(\d{1,2}\.\d{1,2})\s*%")

# SEC EDGAR asks scrapers to identify themselves.
EDGAR_UA   = "AnnuityVoice-cap-rate-fetcher (research; yukh27@gmail.com)"
GENERIC_UA = "AnnuityVoice-cap-rate-fetcher/1.1"


def _ts() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def _load_sources() -> list[dict]:
    data = json.loads(SOURCES_FILE.read_text(encoding="utf-8"))
    return data["sources"]


def _load_product(slug: str) -> dict:
    return json.loads((PRODUCTS_DIR / f"{slug}.json").read_text(encoding="utf-8"))


def _fetch(url: str, timeout: float = 20.0) -> tuple[int, bytes, str]:
    if not url.lower().startswith("https://"):
        raise ValueError(f"refusing to fetch non-HTTPS URL: {url}")
    is_edgar = "sec.gov" in url.lower()
    req = Request(url, headers={
        "User-Agent": EDGAR_UA if is_edgar else GENERIC_UA,
        "Accept": "*/*",
    })
    with urlopen(req, timeout=timeout) as resp:  # noqa: S310 — registry-controlled URL
        return resp.status, resp.read(), resp.headers.get("Content-Type", "")


def _extract_pct_candidates(text: str) -> list[float]:
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
    if "pdf" in ctype.lower():
        return body[:64_000].decode("latin-1", errors="ignore")
    try:
        return body[:64_000].decode("utf-8", errors="ignore")
    except Exception:
        return body[:64_000].decode("latin-1", errors="ignore")


def _ext_from_ctype(ctype: str) -> str:
    c = ctype.lower()
    if "pdf"  in c: return "pdf"
    if "html" in c: return "html"
    if "xml"  in c: return "xml"
    if "json" in c: return "json"
    return "bin"


def _archive_body(pull_dir: Path, slug: str, seg_idx: int, source_kind: str,
                  url: str, body: bytes, ctype: str) -> Path:
    """Write raw response + sidecar metadata. Append-only by construction
    (pull_dir is a fresh per-run directory)."""
    pull_dir.mkdir(parents=True, exist_ok=True)
    ext = _ext_from_ctype(ctype)
    body_path = pull_dir / f"{slug}_{seg_idx}_{source_kind}.{ext}"
    body_path.write_bytes(body)
    sidecar = pull_dir / f"{slug}_{seg_idx}_{source_kind}.meta.json"
    sidecar.write_text(json.dumps({
        "slug": slug,
        "segment_index": seg_idx,
        "source_kind": source_kind,
        "url": url,
        "content_type": ctype,
        "bytes": len(body),
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }, indent=2), encoding="utf-8")
    return body_path


def fetch_one(source: dict, pull_dir: Path, dry_run: bool = False) -> dict:
    slug = source["slug"]
    seg_idx = source["segment_index"]

    try:
        spec = _load_product(slug)
        seg = spec["segments_available"][seg_idx]
        current_cap = seg.get("cap_rate")
    except (FileNotFoundError, KeyError, IndexError) as exc:
        return {
            "slug": slug, "segment_index": seg_idx,
            "error": f"spec lookup failed: {type(exc).__name__}: {exc}",
        }

    attempts = []
    # Carrier URL first; SEC EDGAR fallback if provided.
    for kind, url in (("carrier", source.get("url")),
                      ("edgar",   source.get("edgar_filing_url"))):
        if not url:
            continue
        try:
            status, body, ctype = _fetch(url)
        except (URLError, ValueError, TimeoutError) as exc:
            attempts.append({
                "source_kind": kind, "url": url,
                "error": f"{type(exc).__name__}: {exc}",
            })
            continue

        if not dry_run:
            _archive_body(pull_dir, slug, seg_idx, kind, url, body, ctype)

        text = _decode_body(body, ctype)
        candidates = _extract_pct_candidates(text)
        attempts.append({
            "source_kind": kind, "url": url,
            "http_status": status, "content_type": ctype,
            "candidate_caps": candidates,
            "best_guess": candidates[0] if candidates else None,
        })
        if candidates:
            break

    return {
        "slug": slug,
        "segment_index": seg_idx,
        "segment_label": source.get("segment_label", ""),
        "parser_hint": source.get("parser_hint", ""),
        "current_cap": current_cap,
        "attempts": attempts,
    }


def main():
    ap = argparse.ArgumentParser(description="Fetch current cap rates from public sources.")
    ap.add_argument("--slug", help="Limit to one product slug")
    ap.add_argument("--dry-run", action="store_true", help="Don't write proposal file or archive bodies")
    args = ap.parse_args()

    sources = _load_sources()
    if args.slug:
        sources = [s for s in sources if s["slug"] == args.slug]
        if not sources:
            ap.error(f"no sources for slug {args.slug!r}")

    ts = _ts()
    pull_dir = PULLS_DIR / ts
    results = []
    for src in sources:
        r = fetch_one(src, pull_dir, dry_run=args.dry_run)
        results.append(r)
        cur = r.get("current_cap")
        cur_s = f"{cur:.2%}" if cur is not None else "n/a"
        for a in r.get("attempts", []) or []:
            if "error" in a:
                print(f"  [FAIL] {r['slug']}[{r['segment_index']}] {a['source_kind']:<7} {a['error']}")
            else:
                cands = a.get("candidate_caps") or []
                marker = "[ok]  " if cands else "[empty]"
                print(
                    f"  {marker} {r['slug']}[{r['segment_index']}] {a['source_kind']:<7} "
                    f"current={cur_s}  candidates={[f'{c:.2%}' for c in cands[:5]]}"
                )
        if not r.get("attempts"):
            print(f"  [SKIP] {r['slug']}[{r['segment_index']}]  no sources")

    if args.dry_run:
        print("\n--dry-run: not writing proposal file or archiving bodies.")
        return

    PROPOSALS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = PROPOSALS_DIR / f"{ts}.json"
    proposal = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fetch_timestamp": ts,
        "raw_archive_dir": str(pull_dir.relative_to(REPO)),
        "schema_version": 2,
        "note": (
            "Cap-rate proposals from a single fetcher run. Raw response "
            "bodies archived under rate_pulls/{timestamp}/. The signing "
            "actuary must verify the right value against parser_hint AND "
            "the archived raw body before applying via apply_rate_proposals.py."
        ),
        "results": results,
    }
    out_path.write_text(json.dumps(proposal, indent=2), encoding="utf-8")
    (PROPOSALS_DIR / "latest.json").write_text(json.dumps({
        "latest_timestamp": ts,
        "latest_path":      out_path.name,
    }, indent=2), encoding="utf-8")

    print(f"\nWrote proposal: {out_path}  ({len(results)} sources)")
    if pull_dir.exists():
        n_bodies = sum(1 for _ in pull_dir.glob("*"))
        print(f"Archived {n_bodies} raw response file(s) under {pull_dir.relative_to(REPO)}")


if __name__ == "__main__":
    main()
