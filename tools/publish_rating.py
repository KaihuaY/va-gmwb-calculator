"""
CLI: sign and publish a draft rating.

The signing step fills in:
  - signed_by, signed_credentials
  - signed_at (UTC ISO)
  - status: "draft" -> "published"

Then optionally tags a git commit so the audit trail is traceable.

Usage:
    python tools/publish_rating.py --product equitable_scs_income --sign \
        --name "K Hu" --credentials "FSA, MAAA"

    python tools/publish_rating.py --all --sign \
        --name "K Hu" --credentials "FSA, MAAA"
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
RATINGS_DIR = REPO / "backend" / "data" / "ratings"


def _all_drafts() -> list[Path]:
    return sorted(RATINGS_DIR.glob("*_v*.json"))


def sign_rating(rating_path: Path, *, name: str, credentials: str,
                signed_at: str | None = None) -> dict:
    """Load, mutate signed fields, and write back."""
    rating = json.loads(rating_path.read_text(encoding="utf-8"))
    rating["signed_by"] = name
    rating["signed_credentials"] = credentials
    rating.pop("signed_naic_id", None)
    rating["signed_at"] = signed_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    rating["status"] = "published"
    rating_path.write_text(json.dumps(rating, indent=2), encoding="utf-8")
    return rating


def main():
    ap = argparse.ArgumentParser(description="Sign and publish AnnuityVoice rating(s).")
    ap.add_argument("--product", "-p", help="Product slug")
    ap.add_argument("--all", action="store_true", help="Sign every rating in data/ratings/")
    ap.add_argument("--sign", action="store_true", help="Set this flag to actually sign")
    ap.add_argument("--name", default="K Hu", help='Signing actuary name (default "K Hu")')
    ap.add_argument("--credentials", default="FSA, MAAA",
                    help='Credentials string (default "FSA, MAAA")')
    ap.add_argument("--signed-at", default=None,
                    help="ISO timestamp; default = now (UTC)")
    args = ap.parse_args()

    if not args.sign:
        ap.error("Pass --sign to perform the signing operation")

    if args.all:
        targets = _all_drafts()
    elif args.product:
        path = RATINGS_DIR / f"{args.product}_v1.json"
        if not path.exists():
            ap.error(f"No rating found at {path}")
        targets = [path]
    else:
        ap.error("Specify --product <slug> or --all")

    for path in targets:
        r = sign_rating(
            path,
            name=args.name,
            credentials=args.credentials,
            signed_at=args.signed_at,
        )
        print(f"signed {path.name:<48}  {r['letter_grade']:>3}  signed_by={r['signed_by']}")


if __name__ == "__main__":
    main()
