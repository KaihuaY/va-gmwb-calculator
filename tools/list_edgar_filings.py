"""
List recent SEC EDGAR filings for an insurer CIK — helps K populate
cap_rate_sources.json with the right `edgar_filing_url` for each product.

EDGAR is the authoritative public-record source for current cap rates:
  - **497** supplements: rate-sheet updates, filed monthly or whenever caps change.
  - **497J**: prospectus supplements (less specific).
  - **485APOS / 485BPOS**: post-effective amendments — periodic full restatements.
  - **N-4**: registration statements for variable contracts — base contract terms.

Usage:
    python tools/list_edgar_filings.py 0002039145          # Equitable's CIK; default form=497
    python tools/list_edgar_filings.py 0000812348 --form N-4
    python tools/list_edgar_filings.py 0000812348 --since 2025-01-01

Output: tab-separated rows of `accession_no  date  form  document_url`. Pipe
to grep / less / awk; copy the URL of the most relevant filing into
tools/cap_rate_sources.json as the `edgar_filing_url`.

EDGAR full-text search rate-limits scrapers via User-Agent. Always identify
yourself politely (this script does).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from urllib.request import Request, urlopen
from urllib.error import URLError

EDGAR_UA = "AnnuityVoice-edgar-helper (research; yukh27@gmail.com)"

# Submission feed endpoint — free, no API key, structured JSON.
# https://www.sec.gov/edgar/sec-api-documentation
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik10}.json"


def _zero_pad(cik: str) -> str:
    """EDGAR submission feed expects 10-digit zero-padded CIKs."""
    digits = re.sub(r"\D", "", cik)
    return digits.zfill(10)


def fetch_submissions(cik: str) -> dict:
    url = SUBMISSIONS_URL.format(cik10=_zero_pad(cik))
    req = Request(url, headers={"User-Agent": EDGAR_UA, "Accept": "application/json"})
    try:
        with urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except URLError as exc:
        print(f"ERROR: could not fetch submissions for CIK {cik}: {exc}", file=sys.stderr)
        sys.exit(1)


def main():
    ap = argparse.ArgumentParser(description="List SEC EDGAR filings for an insurer CIK")
    ap.add_argument("cik", help="10-digit CIK (e.g., 0002039145). Leading zeros optional.")
    ap.add_argument("--form", default="497",
                    help="Form type filter (default 497 = rate-sheet supplements)")
    ap.add_argument("--since", default=None,
                    help="ISO date YYYY-MM-DD; show only filings on/after this date")
    ap.add_argument("--limit", type=int, default=20, help="Max rows to print")
    args = ap.parse_args()

    feed = fetch_submissions(args.cik)
    company = feed.get("name", "?")
    recent = feed.get("filings", {}).get("recent", {})
    forms = recent.get("form", [])
    dates = recent.get("filingDate", [])
    accs  = recent.get("accessionNumber", [])
    docs  = recent.get("primaryDocument", [])
    descs = recent.get("primaryDocDescription", [])

    print(f"# {company}  (CIK {_zero_pad(args.cik)})")
    print(f"# form={args.form}  since={args.since or 'beginning'}  showing up to {args.limit}")
    print()

    since = date.fromisoformat(args.since) if args.since else None
    rows = []
    for f, d, a, doc, desc in zip(forms, dates, accs, docs, descs):
        if args.form != "ALL" and f != args.form:
            continue
        try:
            ddate = date.fromisoformat(d)
        except ValueError:
            continue
        if since and ddate < since:
            continue
        # EDGAR document URLs follow a stable pattern.
        acc_nodash = a.replace("-", "")
        doc_url = f"https://www.sec.gov/Archives/edgar/data/{int(re.sub(r'^0+', '', _zero_pad(args.cik)) or '0')}/{acc_nodash}/{doc}"
        rows.append((d, f, a, doc_url, desc or ""))

    rows.sort(key=lambda r: r[0], reverse=True)
    for d, f, a, url, desc in rows[: args.limit]:
        print(f"{d}\t{f}\t{a}\t{url}\t{desc[:80]}")

    if not rows:
        print("(no matching filings)")


if __name__ == "__main__":
    main()
