"""
CLI: rate one product (or all 25) against a methodology version.

Usage:
    python tools/rate_product.py --product equitable_scs_income
    python tools/rate_product.py --product equitable_scs_income --methodology v1.0.0
    python tools/rate_product.py --all
    python tools/rate_product.py --all --scored-at 2026-05-12T00:00:00Z

Output:
    backend/data/ratings/<slug>_v<n>.json (status: "draft")

The optional `--scored-at` arg pins the timestamp for byte-reproducibility.
If omitted, falls back to the product spec file's mtime in ISO format —
also reproducible across machines for the same file.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# Make the backend package importable when this script is run from the repo root.
REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "backend"))

from engine.rating import compute_rating, _tco_drag
from engine.product_schema import ProductSpec


DATA_DIR = REPO / "backend" / "data"
PRODUCTS_DIR = DATA_DIR / "products"
RATINGS_DIR  = DATA_DIR / "ratings"
METHOD_DIR   = DATA_DIR / "methodology"


def _load_methodology(version: str) -> dict:
    if not version.startswith("v"):
        version = "v" + version
    # Try methodology_<version>.json (e.g. methodology_v1.0.0.json), then v1.json
    candidates = [
        METHOD_DIR / f"methodology_{version}.json",
        METHOD_DIR / f"methodology_{version.split('.')[0]}.json",
        METHOD_DIR / "methodology_v1.json",
    ]
    for path in candidates:
        if path.exists():
            with open(path, encoding="utf-8") as f:
                return json.load(f)
    raise FileNotFoundError(f"No methodology file found for version {version}")


def _load_product(slug: str) -> dict:
    path = PRODUCTS_DIR / f"{slug}.json"
    if not path.exists():
        raise FileNotFoundError(f"Product spec not found: {path}")
    with open(path, encoding="utf-8") as f:
        spec = json.load(f)
    # Validate via Pydantic — raises on schema error
    ProductSpec.model_validate(spec)
    return spec, path


def _scored_at_from_spec(spec_path: Path) -> str:
    """Use spec mtime (truncated to seconds) for reproducible timestamps."""
    ts = spec_path.stat().st_mtime
    return (
        datetime.fromtimestamp(int(ts), tz=timezone.utc)
        .strftime("%Y-%m-%dT%H:%M:%SZ")
    )


def _all_slugs() -> list[str]:
    return sorted(p.stem for p in PRODUCTS_DIR.glob("*.json"))


def _compute_cohort_tco(methodology: dict) -> list[float]:
    """Pre-compute TCO drag for every product, for relative scoring."""
    drags = []
    for slug in _all_slugs():
        spec, _ = _load_product(slug)
        # _tco_drag doesn't need monte carlo result (only spec)
        drags.append(_tco_drag(spec, {}, methodology["scoring_scenario"]["premium"]))
    return drags


def rate_one(slug: str, methodology: dict, cohort_drags: list[float], scored_at: str | None) -> Path:
    spec, spec_path = _load_product(slug)
    ts = scored_at or _scored_at_from_spec(spec_path)
    rating = compute_rating(spec, methodology, cohort_drags, scored_at=ts)

    RATINGS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = RATINGS_DIR / f"{slug}_v1.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(rating, f, indent=2)
    return out_path


def main():
    ap = argparse.ArgumentParser(description="Compute AnnuityVoice rating for a product.")
    ap.add_argument("--product", "-p", help="Product slug (omit if using --all)")
    ap.add_argument("--all", action="store_true", help="Rate every product in data/products/")
    ap.add_argument("--methodology", "-m", default="v1.0.0", help="Methodology version (default v1.0.0)")
    ap.add_argument("--scored-at", default=None,
                    help="ISO timestamp to embed in rating JSON. "
                         "Default: spec file mtime. Use a fixed string for byte-reproducibility.")
    args = ap.parse_args()

    methodology = _load_methodology(args.methodology)
    cohort_drags = _compute_cohort_tco(methodology)

    if args.all:
        slugs = _all_slugs()
    elif args.product:
        slugs = [args.product]
    else:
        ap.error("Specify --product <slug> or --all")

    for slug in slugs:
        out = rate_one(slug, methodology, cohort_drags, args.scored_at)
        rating = json.loads(out.read_text())
        print(
            f"{slug:<40} composite={rating['composite']:5.1f}  "
            f"grade={rating['letter_grade']:>3}  -> {out.name}"
        )


if __name__ == "__main__":
    main()
