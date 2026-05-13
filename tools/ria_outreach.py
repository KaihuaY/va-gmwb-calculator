#!/usr/bin/env python3
"""
AnnuityVoice RIA Outreach Agent
--------------------------------
Two-table architecture:
  firms     -- persistent cache of every IAPD firm ever fetched (never re-fetched once stored)
  outreach  -- firms we are actively contacting (subset of firms)

Workflow:
  1. python tools/ria_outreach.py --fetch                   # populate firms table (all US)
     python tools/ria_outreach.py --fetch --state TX        # or one state
  2. python tools/ria_outreach.py --enrich-firms --limit 500  # brochure PDF -> website/email
  3. python tools/ria_outreach.py --analyze --top 100       # score + save outreach candidates
  4. python tools/ria_outreach.py --draft --batch 10 [--yes] [--one-batch]
  5. python tools/ria_outreach.py --review [--send]
  6. python tools/ria_outreach.py --stats

Setup (backend/.env):
    ANTHROPIC_API_KEY=sk-ant-...
    IMAP_HOST=imap.gmail.com  IMAP_PORT=993
    IMAP_USER=kai@annuityvoice.com  IMAP_PASS=<app-password>
    FROM_EMAIL=kai@annuityvoice.com
    SMTP_HOST=smtp.gmail.com  SMTP_PORT=587
    SMTP_USER=kai@annuityvoice.com  SMTP_PASS=<app-password>
"""

import argparse
import email as _email_module
import imaplib
import io
import json
import os
import random
import re
import smtplib
import sqlite3
import ssl
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

import requests
from anthropic import Anthropic
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SCRIPT_DIR  = Path(__file__).parent
DB_PATH     = SCRIPT_DIR / "outreach_log.db"
ENV_PATH    = SCRIPT_DIR.parent / "backend" / ".env"

LINKEDIN_SCORE_THRESHOLD = 7
SKIP_SCORE_THRESHOLD     = 3   # low because IAPD gives no AUM; name/state signals enough

TOP_VA_STATES = {"CA", "TX", "FL", "NY", "IL", "OH", "PA", "GA", "NJ", "NC"}

US_STATES = [
    "AL","AK","AZ","AR","CA","CO","CT","DC","DE","FL","GA",
    "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
    "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
    "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
    "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
]

IAPD_SEARCH_URL = "https://api.adviserinfo.sec.gov/search/firm"
IAPD_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept":  "application/json, text/plain, */*",
    "Origin":  "https://adviserinfo.sec.gov",
    "Referer": "https://adviserinfo.sec.gov/",
}

_BROCHURE_URL = (
    "https://files.adviserinfo.sec.gov/IAPD/Content/Common/"
    "crd_iapd_Brochure.aspx?BRCHR_VRSN_ID={bid}"
)
_BROCHURE_SKIP = re.compile(
    r"(adviserinfo|sec\.gov|finra|brokercheck|bing|google|duckduckgo|"
    r"linkedin|facebook|twitter|yelp|custhelp|rightnow|iapd)",
    re.IGNORECASE,
)
_EMAIL_SKIP = re.compile(r"(noreply|no-reply|example\.com|sentry\.io|\.png|\.jpg)", re.I)

_WEB_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.9",
}
_EMAIL_RE  = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")
_MAILTO_RE = re.compile(r"mailto:([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})", re.I)
_VA_KEYWORDS = re.compile(
    r"\b(variable annuit|annuit(y|ies)|gmwb|gmdb|glwb|gmib|income rider|"
    r"deferred annuit|fixed annuit|indexed annuit|insurance product|"
    r"surrender charge|benefit base|withdrawal benefit)\b",
    re.IGNORECASE,
)

_GENERIC_LOCAL = re.compile(
    r"^(info|noreply|no-reply|support|hello|admin|contact|mail|office|team|"
    r"help|media|pr|marketing|privacy|legal|billing|compliance|webmaster|service)$",
    re.I,
)


# ---------------------------------------------------------------------------
# Database  (two tables)
# ---------------------------------------------------------------------------
def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS firms (
            crd           TEXT PRIMARY KEY,
            firm_name     TEXT NOT NULL,
            firm_state    TEXT,
            firm_aum      REAL    DEFAULT 0.0,
            client_count  INTEGER DEFAULT 0,
            fee_only      INTEGER DEFAULT 1,
            website       TEXT,
            contact_email TEXT,
            brochure_vid  INTEGER,
            score         INTEGER DEFAULT 0,
            fetched_at    TEXT,
            enriched_at   TEXT,
            va_relevant   INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS fetch_log (
            state       TEXT PRIMARY KEY,
            fetched_at  TEXT NOT NULL,
            firm_count  INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS outreach (
            id            INTEGER PRIMARY KEY,
            ts            TEXT NOT NULL,
            firm_name     TEXT,
            firm_crd      TEXT,
            firm_aum      REAL,
            firm_state    TEXT,
            score         INTEGER,
            contact_email TEXT,
            website       TEXT,
            subject       TEXT,
            body          TEXT,
            linkedin_dm   TEXT,
            status        TEXT DEFAULT 'candidate',
            sent_at       TEXT,
            notes         TEXT
        );
    """)
    # Non-destructive migrations for older DB files
    for tbl, col, defn in [
        ("outreach", "website",      "TEXT"),
        ("outreach", "contact_email","TEXT"),
        ("firms",    "va_relevant",  "INTEGER DEFAULT 0"),
    ]:
        try:
            conn.execute(f"ALTER TABLE {tbl} ADD COLUMN {col} {defn}")
        except sqlite3.OperationalError:
            pass
    conn.commit()
    return conn


# firms helpers ---------------------------------------------------------------

def upsert_firm(conn, *, crd: str, firm_name: str, firm_state: str, fee_only: bool = True):
    """Insert a firm into the cache if not already present. Never overwrites existing rows."""
    ts = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "INSERT OR IGNORE INTO firms (crd, firm_name, firm_state, fee_only, fetched_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (crd, firm_name, firm_state, 1 if fee_only else 0, ts),
    )
    conn.commit()


def update_firm_enrichment(
    conn, crd: str, *,
    website: str | None = None,
    contact_email: str | None = None,
    brochure_vid: int | None = None,
    va_relevant: bool = False,
):
    """Store brochure-derived data. Uses COALESCE so we never blank out existing good data."""
    ts = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "UPDATE firms SET "
        "  website       = COALESCE(?, website), "
        "  contact_email = COALESCE(?, contact_email), "
        "  brochure_vid  = COALESCE(?, brochure_vid), "
        "  va_relevant   = MAX(va_relevant, ?), "
        "  enriched_at   = ? "
        "WHERE crd = ?",
        (website or None, contact_email or None, brochure_vid,
         1 if va_relevant else 0, ts, crd),
    )
    conn.commit()


def _first_name_from_email(email: str) -> str:
    """
    Extract a personal first name from the email local part.
    e.g. brad@hartmanfinancialplanning.com  -> 'Brad'
         info@firm.com                      -> ''
         jdavis@firm.com                    -> '' (looks like initial+surname)
    """
    if not email or "@" not in email:
        return ""
    local = email.split("@")[0].lower()
    if not local.isalpha() or not 3 <= len(local) <= 9:
        return ""
    if _GENERIC_LOCAL.match(local):
        return ""
    # Reject initials+surname patterns: single consonant start + 4+ more chars
    _VOWELS = set("aeiou")
    if local[0] not in _VOWELS and len(local) >= 5 and local[1] not in _VOWELS:
        return ""
    return local.capitalize()


def firms_as_lead(f) -> dict:
    """Convert a firms row to the lead dict used throughout the script."""
    email = f["contact_email"] or ""
    return {
        "firm_name":     f["firm_name"],
        "firm_crd":      f["crd"],
        "firm_state":    f["firm_state"] or "",
        "firm_aum":      f["firm_aum"] or 0.0,
        "client_count":  f["client_count"] or 0,
        "fee_only":      bool(f["fee_only"]),
        "website":       f["website"] or "",
        "contact_email": email,
        "advisor_name":  _first_name_from_email(email),
        "va_relevant":   bool(f["va_relevant"]) if "va_relevant" in f.keys() else False,
    }


# outreach helpers ------------------------------------------------------------

def already_in_outreach(conn: sqlite3.Connection, crd: str) -> bool:
    """True if this firm already has any outreach row (candidate / draft / sent)."""
    if not crd:
        return False
    return conn.execute(
        "SELECT 1 FROM outreach WHERE firm_crd = ?", (crd,)
    ).fetchone() is not None


def save_candidate(conn, *, firm_name, firm_crd, firm_aum, firm_state,
                   score, contact_email, website) -> int:
    ts = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "INSERT OR IGNORE INTO outreach "
        "(ts, firm_name, firm_crd, firm_aum, firm_state, score, contact_email, website, status) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'candidate')",
        (ts, firm_name, firm_crd, firm_aum, firm_state, score, contact_email, website),
    )
    conn.commit()
    return conn.execute("SELECT last_insert_rowid()").fetchone()[0]


def update_draft(conn, row_id: int, subject: str, body: str, linkedin_dm: str | None):
    conn.execute(
        "UPDATE outreach SET subject=?, body=?, linkedin_dm=?, status='draft' WHERE id=?",
        (subject, body, linkedin_dm, row_id),
    )
    conn.commit()


def mark_sent(conn: sqlite3.Connection, row_id: int):
    conn.execute(
        "UPDATE outreach SET status='sent', sent_at=? WHERE id=?",
        (datetime.now(timezone.utc).isoformat(), row_id),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# IAPD fetch  (state-by-state pagination)
# ---------------------------------------------------------------------------
def _fetch_iapd_state_into(state: str, conn: sqlite3.Connection) -> int:
    """
    Fetch ALL active IA firms for `state` from IAPD and upsert into firms table.
    Returns number of NEW rows inserted.
    """
    start     = 0
    page_size = 100
    total_api = 0
    new_count = 0

    while True:
        params = {
            "query": "", "wt": "json", "hl": "false",
            "nrows": str(page_size), "start": str(start),
            "state": state.upper(), "sort": "score+desc",
        }
        try:
            resp = requests.get(IAPD_SEARCH_URL, params=params,
                                headers=IAPD_HEADERS, timeout=20)
            resp.raise_for_status()
            data  = resp.json()
            hits  = data.get("hits", {}).get("hits", [])
            total_api = data.get("hits", {}).get("total", 0)
        except Exception as exc:
            print(f"  [IAPD] {state} start={start}: {exc}", file=sys.stderr)
            break

        if not hits:
            break

        for h in hits:
            src = h.get("_source", {})
            if src.get("firm_ia_scope") != "ACTIVE":
                continue
            crd = str(src.get("firm_source_id", "")).strip()
            if not crd:
                continue
            name = src.get("firm_name", "").strip()
            if not name:
                continue
            addr_raw = src.get("firm_ia_address_details", "")
            firm_state = state.upper()
            if addr_raw:
                try:
                    firm_state = (
                        json.loads(addr_raw)
                        .get("officeAddress", {})
                        .get("state", state)
                        .upper()
                    )
                except Exception:
                    pass

            before = conn.execute(
                "SELECT 1 FROM firms WHERE crd=?", (crd,)
            ).fetchone()
            upsert_firm(conn, crd=crd, firm_name=name, firm_state=firm_state)
            if not before:
                new_count += 1

        start += page_size
        if start >= total_api:
            break
        time.sleep(0.08)

    return new_count


# ---------------------------------------------------------------------------
# Brochure PDF enrichment
# ---------------------------------------------------------------------------
def _get_brochure_version_id(crd: str) -> int | None:
    try:
        resp = requests.get(
            f"{IAPD_SEARCH_URL}/{crd}",
            params={"hl": "false", "nrows": "1", "query": "", "wt": "json"},
            headers=IAPD_HEADERS, timeout=12,
        )
        resp.raise_for_status()
        data    = resp.json()
        hits    = data.get("hits", {}).get("hits", [])
        if not hits:
            return None
        src     = hits[0].get("_source", hits[0])
        iac_raw = src.get("iacontent", "{}")
        iac     = json.loads(iac_raw) if isinstance(iac_raw, str) else (iac_raw or {})
        details = iac.get("brochures", {}).get("brochuredetails", [])
        return details[0]["brochureVersionID"] if details else None
    except Exception:
        return None


def _parse_brochure_pdf(brochure_vid: int) -> tuple[str, str, bool]:
    """Download ADV Part 2A PDF and extract (website, contact_email, va_relevant)."""
    try:
        import pdfplumber

        url  = _BROCHURE_URL.format(bid=brochure_vid)
        resp = requests.get(url, headers=_WEB_HEADERS, timeout=20)
        if resp.status_code != 200:
            return "", "", False

        text = ""
        with pdfplumber.open(io.BytesIO(resp.content)) as pdf:
            for page in pdf.pages[:6]:   # extra pages for VA keyword coverage
                text += (page.extract_text() or "") + "\n"

        raw_urls   = re.findall(
            r"(?:www\.|https?://)[A-Za-z0-9.\-]+\.[A-Za-z]{2,}(?:/[^\s)]*)?", text
        )
        raw_emails = _EMAIL_RE.findall(text)

        website = next(
            (u if u.startswith("http") else f"https://{u}"
             for u in raw_urls if not _BROCHURE_SKIP.search(u)),
            "",
        )
        email      = next((e for e in raw_emails if not _EMAIL_SKIP.search(e)), "")
        va_relevant = bool(_VA_KEYWORDS.search(text))
        return website, email, va_relevant
    except ImportError:
        return "", "", False
    except Exception:
        return "", "", False


def _scrape_website_email(website_url: str) -> str:
    """Scrape homepage → /contact → /about for a mailto: address."""
    if not website_url or not website_url.startswith("http"):
        return ""
    base   = website_url.rstrip("/")
    pages  = [base, f"{base}/contact", f"{base}/contact-us", f"{base}/about"]
    found: list[str] = []
    for url in pages:
        try:
            r = requests.get(url, headers=_WEB_HEADERS, timeout=8,
                             allow_redirects=True)
            if r.status_code != 200:
                continue
            html = r.text[:150_000]
            for m in _MAILTO_RE.finditer(html):
                e = m.group(1).lower()
                if e not in found:
                    found.append(e)
            for m in _EMAIL_RE.finditer(html):
                e = m.group(0).lower()
                if e not in found:
                    found.append(e)
        except Exception:
            continue
        if found:
            break

    personal = [e for e in found if not _GENERIC_LOCAL.match(e.split("@")[0])]
    return personal[0] if personal else (found[0] if found else "")


# ---------------------------------------------------------------------------
# Lead scoring
# ---------------------------------------------------------------------------
_RETAIL_NAME = re.compile(
    r"\b(wealth\s+(advisor|management|planner|partner)|financial\s+(planning|advisor|services)|"
    r"retirement\s+(planning|advisor|income)|fee.only|investment\s+advisor|"
    r"estate\s+planning|fiduciary|cfp|independent\s+advisor)\b",
    re.IGNORECASE,
)
_INSTITUTIONAL_NAME = re.compile(
    r"\b(fund\s+[igp]+|venture|private\s+equity|hedge|quantitative|algo|energy\s+partner|"
    r"maritime|crypto|arbitrage|bitcoin)\b",
    re.IGNORECASE,
)


def score_lead(lead: dict) -> int:
    score = 0

    aum = lead.get("firm_aum", 0) or 0
    if 100_000_000 <= aum <= 500_000_000:
        score += 3
    elif 50_000_000 <= aum < 100_000_000:
        score += 2

    clients = lead.get("client_count", 0) or 0
    if 100 <= clients <= 500:
        score += 2

    if lead.get("fee_only"):
        score += 2

    if (lead.get("firm_state") or "").upper() in TOP_VA_STATES:
        score += 1

    ws = (lead.get("website") or "").lower()
    if any(kw in ws for kw in ("retirement", "annuity", "income", "planning")):
        score += 1

    name = lead.get("firm_name", "")
    if _RETAIL_NAME.search(name):
        score += 1
    if _INSTITUTIONAL_NAME.search(name):
        score = max(0, score - 1)

    return min(score, 10)


# ---------------------------------------------------------------------------
# Gmail IMAP
# ---------------------------------------------------------------------------
def _imap_connect():
    host     = os.getenv("IMAP_HOST", "imap.gmail.com")
    port     = int(os.getenv("IMAP_PORT", "993"))
    user     = os.getenv("IMAP_USER", os.getenv("FROM_EMAIL", ""))
    password = os.getenv("IMAP_PASS", "")
    if not user or not password:
        return None, "IMAP_USER or IMAP_PASS not set in backend/.env"
    try:
        imap = imaplib.IMAP4_SSL(host, port)
        imap.login(user, password)
        return imap, None
    except Exception as exc:
        return None, str(exc)


def read_sent_style(n: int = 4) -> str:
    imap, err = _imap_connect()
    if imap is None:
        print(f"  [Gmail] Skipping sent-mail style read: {err}")
        return ""
    try:
        for folder in ('"[Gmail]/Sent Mail"', '"[Google Mail]/Sent Mail"', "Sent"):
            status, _ = imap.select(folder, readonly=True)
            if status == "OK":
                break
        else:
            return ""
        _, data = imap.search(None, "ALL")
        ids = data[0].split()
        if not ids:
            return ""
        samples: list[str] = []
        for mid in ids[-n:]:
            _, msg_data = imap.fetch(mid, "(RFC822)")
            raw = msg_data[0][1]
            msg = _email_module.message_from_bytes(raw)
            subject = msg.get("Subject", "(no subject)")
            body    = ""
            if msg.is_multipart():
                for part in msg.walk():
                    if part.get_content_type() == "text/plain":
                        body = part.get_payload(decode=True).decode("utf-8", errors="replace")
                        break
            else:
                p = msg.get_payload(decode=True)
                if p:
                    body = p.decode("utf-8", errors="replace")
            samples.append(f"Subject: {subject}\n\n{body.strip()}")
        print(f"  [Gmail] Loaded {len(samples)} sent emails as style reference.")
        return "\n\n---\n\n".join(samples)
    except Exception as exc:
        print(f"  [Gmail] Read sent error: {exc}")
        return ""
    finally:
        try:
            imap.logout()
        except Exception:
            pass


def save_gmail_draft(to_email: str, subject: str, body: str) -> bool:
    from_email = os.getenv("FROM_EMAIL", os.getenv("IMAP_USER", "kai@annuityvoice.com"))
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = f"AnnuityVoice <{from_email}>"
    if to_email:
        msg["To"] = to_email
    msg.attach(MIMEText(body, "plain", "utf-8"))

    imap, err = _imap_connect()
    if imap is None:
        print(f"  [Gmail] Cannot save draft: {err}")
        return False
    try:
        for folder in ('"[Gmail]/Drafts"', '"[Google Mail]/Drafts"', "Drafts"):
            try:
                imap.append(folder, "\\Draft",
                            imaplib.Time2Internaldate(time.time()), msg.as_bytes())
                return True
            except Exception:
                continue
        return False
    except Exception as exc:
        print(f"  [Gmail] Save draft error: {exc}")
        return False
    finally:
        try:
            imap.logout()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Claude drafting
# ---------------------------------------------------------------------------
def draft_outreach(
    client: Anthropic, lead: dict, score: int, style_ref: str = ""
) -> tuple[str, str, str | None]:
    include_linkedin = score >= LINKEDIN_SCORE_THRESHOLD

    style_section = ""
    if style_ref:
        style_section = (
            "\n\nSTYLE REFERENCE — your own sent emails. Match this tone and length exactly:\n"
            "---\n" + style_ref[:1600] + "\n---"
        )

    linkedin_block = (
        "\n3. LINKEDIN DM: Exactly 2 sentences. "
        "One specific hook, then CTA. No pleasantries.\n"
        "Format: LINKEDIN:\n<dm text>"
        if include_linkedin else ""
    )

    greeting   = (f"Hi {lead['advisor_name']},"
                  if lead.get("advisor_name")
                  else f"Hi {lead['firm_name'].title()} Team,")
    va_context = (
        "Their ADV brochure explicitly mentions annuity products — "
        "they already work with clients who hold these contracts."
        if lead.get("va_relevant") else
        "Fee-only RIAs often inherit clients who hold legacy annuities "
        "from before they switched advisors."
    )

    prompt = f"""You are drafting a cold outreach email for Kai at AnnuityVoice.

When a carrier designs a variable annuity income rider, they use a team of actuaries \
working in the carrier's favour. The clients who buy those contracts rarely have anyone \
running the same math on their side. AnnuityVoice does exactly that — actuarial \
analysis on the policyholder's side, delivered as white-label PDF reports that RIAs \
can use in client meetings. The calculator at annuityvoice.com is the starting point; \
a full PDF analysis follows for specific client contracts.

Goal: one reply expressing interest.
{style_section}

FIRM:
  Name:      {lead["firm_name"]}
  State:     {lead["firm_state"]}
  Website:   {lead.get("website") or "not found"}
  Context:   {va_context}

STRUCTURE (strictly follow this order):
1. Greeting: {greeting}
2. ONE sentence — the advocacy hook: the carrier had actuaries; the client didn't. \
   Frame it as a peer observation. Vary the wording — never repeat the same phrasing.
3. ONE sentence — what AnnuityVoice does in plain English. \
   No acronyms, no "Monte Carlo", no "GMWB", no "mortality tables". \
   Weave in annuityvoice.com naturally.
4. ONE sentence — two-step CTA: try the calculator on any contract they already know; \
   if they have a client situation in mind, we can take it further with a full PDF report.
5. Sign-off: Kai, FSA / Founder, AnnuityVoice

RULES:
- Body strictly under 70 words — count them
- Never mention cost, "free", or "no commitment"
- No "Quick question", "I noticed", "excited", "thrilled", "fiduciary", "holistic"
- Peer-to-peer tone throughout — Kai is an FSA writing to a fellow professional
- Subject: specific to this firm's state or practice, under 55 chars. \
  Do NOT use the phrase "legacy annuities" — vary the angle every call.
{linkedin_block}

Format exactly:
SUBJECT: <subject>
BODY:
<email body>
{("LINKEDIN:" + chr(10) + "<dm>") if include_linkedin else ""}"""

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=500,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = response.content[0].text.strip()
    return _parse_claude_response(raw, include_linkedin)


def _parse_claude_response(text: str, include_linkedin: bool) -> tuple[str, str, str | None]:
    subject = body = ""
    linkedin = None

    m = re.search(r"SUBJECT:\s*(.+?)(?:\n|$)", text, re.I)
    if m:
        subject = m.group(1).strip()

    if include_linkedin:
        m = re.search(r"BODY:\s*\n(.*?)\nLINKEDIN:", text, re.I | re.DOTALL)
    else:
        m = re.search(r"BODY:\s*\n(.*)", text, re.I | re.DOTALL)
    if m:
        body = m.group(1).strip()

    if include_linkedin:
        m = re.search(r"LINKEDIN:\s*\n(.*)", text, re.I | re.DOTALL)
        if m:
            linkedin = m.group(1).strip()

    return subject, body, linkedin


# ---------------------------------------------------------------------------
# SMTP sending
# ---------------------------------------------------------------------------
def send_email(to_email: str, subject: str, body: str):
    host       = os.getenv("SMTP_HOST", "")
    port       = int(os.getenv("SMTP_PORT", "587"))
    user       = os.getenv("SMTP_USER", "")
    password   = os.getenv("SMTP_PASS", "")
    from_email = os.getenv("FROM_EMAIL") or user or "kai@annuityvoice.com"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = f"AnnuityVoice <{from_email}>"
    msg["To"]      = to_email
    msg.attach(MIMEText(body, "plain"))

    ctx = ssl.create_default_context()
    with smtplib.SMTP(host, port) as smtp:
        smtp.ehlo()
        smtp.starttls(context=ctx)
        if user and password:
            smtp.login(user, password)
        smtp.sendmail(from_email, to_email, msg.as_string())


# ---------------------------------------------------------------------------
# Display helpers
# ---------------------------------------------------------------------------
SEP = "-" * 62

def _fmt_aum(aum: float) -> str:
    if not aum:
        return "unknown AUM"
    if aum >= 1e9:
        return f"${aum/1e9:.1f}B"
    if aum >= 1e6:
        return f"${aum/1e6:.0f}M"
    return f"${aum:,.0f}"


def _indent(text: str, prefix: str = "  ") -> str:
    return "\n".join(prefix + line for line in text.splitlines())


def print_draft(lead: dict, score: int, subject: str, body: str, linkedin: str | None):
    star = "  * High-potential" if score >= LINKEDIN_SCORE_THRESHOLD else ""
    print(f"\n{SEP}")
    print(
        f"FIRM:  {lead['firm_name']}  --  {lead['firm_state']}  "
        f"({_fmt_aum(lead['firm_aum'])}, {lead.get('client_count') or '?'} clients)"
    )
    print(f"CRD:   {lead['firm_crd'] or 'n/a'}  |  Score: {score}/10{star}")
    email = lead.get("contact_email", "")
    print(f"TO:    {email or '(no email found)'}")
    if lead.get("website"):
        print(f"WEB:   {lead['website']}")
    print(f"\nSUBJECT:\n  {subject}")
    print(f"\nEMAIL BODY:\n{_indent(body)}")
    if linkedin:
        print(f"\nLINKEDIN DM:\n{_indent(linkedin)}")
    print(SEP)


# ---------------------------------------------------------------------------
# run_fetch  -- populate firms table from IAPD
# ---------------------------------------------------------------------------
def run_fetch(states: list[str] | None = None):
    """
    Fetch all active IA firms for the given states (default: all 50 US states + DC)
    and store in the firms cache table. Skips states already fully fetched.
    Safe to re-run — existing rows are never overwritten.
    """
    conn         = get_db()
    target       = [s.upper() for s in states] if states else US_STATES
    grand_total  = 0

    for state in target:
        already = conn.execute(
            "SELECT firm_count FROM fetch_log WHERE state=?", (state,)
        ).fetchone()
        if already:
            print(f"  {state}: fully fetched ({already[0]} firms) — skipping")
            continue

        new = _fetch_iapd_state_into(state, conn)
        grand_total += new
        ts = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT OR REPLACE INTO fetch_log (state, fetched_at, firm_count) VALUES (?,?,?)",
            (state, ts, new),
        )
        conn.commit()
        print(f"  {state}: +{new} new firms")
        time.sleep(0.15)

    total_db = conn.execute("SELECT COUNT(*) FROM firms").fetchone()[0]
    conn.close()
    print(f"\nDone. {grand_total} new firms added. Firms table total: {total_db}")


# ---------------------------------------------------------------------------
# run_enrich_firms  -- brochure PDF -> website + email
# ---------------------------------------------------------------------------
def run_enrich_firms(limit: int = 300, state: str | None = None):
    """
    Enrich up to `limit` unenriched firms with brochure data.
    Sampling is stratified by state (proportional) then randomised within each state,
    so the enriched set is geographically distributed rather than CA-heavy.
    Safe to re-run — COALESCE prevents overwriting already-found data.
    """
    conn = get_db()

    query = "SELECT * FROM firms WHERE enriched_at IS NULL"
    if state:
        query += f" AND firm_state='{state.upper()}'"
    rows = conn.execute(query).fetchall()

    # Stratified sampling: group by state, shuffle within each, then interleave
    buckets: dict[str, list] = defaultdict(list)
    for r in rows:
        buckets[r["firm_state"] or "XX"].append(r)
    for st in buckets:
        random.shuffle(buckets[st])

    # Round-robin across states so every state contributes proportionally
    target: list = []
    iters = {st: iter(firms) for st, firms in buckets.items()}
    active = list(iters.keys())
    while len(target) < limit and active:
        for st in list(active):
            try:
                target.append(next(iters[st]))
            except StopIteration:
                active.remove(st)
            if len(target) >= limit:
                break

    # Show state distribution of selected firms
    dist: dict[str, int] = defaultdict(int)
    for r in target:
        dist[r["firm_state"] or "XX"] += 1
    top_states = sorted(dist.items(), key=lambda x: x[1], reverse=True)[:10]
    print(f"\nEnriching {len(target)} firms (of {len(rows)} unenriched).")
    print(f"Top states in sample: " +
          ", ".join(f"{s}:{n}" for s, n in top_states))

    for i, firm in enumerate(target):
        crd = firm["crd"]
        bid = _get_brochure_version_id(crd)
        time.sleep(0.15)

        if bid:
            ws, em, va = _parse_brochure_pdf(bid)
        else:
            ws, em, va = "", "", False

        # If brochure gave a website but no email, try scraping the site
        if ws and not em:
            em = _scrape_website_email(ws)

        update_firm_enrichment(conn, crd,
                               website=ws or None,
                               contact_email=em or None,
                               brochure_vid=bid,
                               va_relevant=va)

        if (i + 1) % 50 == 0 or (i + 1) == len(target):
            with_email = conn.execute(
                "SELECT COUNT(*) FROM firms WHERE contact_email IS NOT NULL"
            ).fetchone()[0]
            va_count = conn.execute(
                "SELECT COUNT(*) FROM firms WHERE va_relevant=1"
            ).fetchone()[0]
            print(f"  {i+1}/{len(target)} enriched  "
                  f"| emails: {with_email}  | VA-relevant: {va_count}")

    total    = conn.execute("SELECT COUNT(*) FROM firms").fetchone()[0]
    enriched = conn.execute("SELECT COUNT(*) FROM firms WHERE enriched_at IS NOT NULL").fetchone()[0]
    with_email = conn.execute("SELECT COUNT(*) FROM firms WHERE contact_email IS NOT NULL").fetchone()[0]
    va_count = conn.execute("SELECT COUNT(*) FROM firms WHERE va_relevant=1").fetchone()[0]
    conn.close()
    print(f"\nFirms: {total} total | {enriched} enriched | {with_email} with email | {va_count} VA-relevant")


# ---------------------------------------------------------------------------
# run_analyze  -- score firms table, save top-N to outreach
# ---------------------------------------------------------------------------
def run_analyze(state: str | None, top_n: int, va_only: bool = False):
    """
    Score all firms in the cache, exclude already-contacted ones, save top-N
    to outreach as candidates. Auto-fetches IAPD if the cache is empty.
    """
    conn = get_db()

    # Auto-fetch if cache is empty
    count_q = "SELECT COUNT(*) FROM firms"
    if state:
        count_q += f" WHERE firm_state='{state.upper()}'"
    if conn.execute(count_q).fetchone()[0] == 0:
        print(f"  firms cache empty for {state or 'all states'} — fetching from IAPD...")
        conn.close()
        run_fetch(states=[state] if state else None)
        conn = get_db()

    conditions = []
    if state:
        conditions.append(f"firm_state='{state.upper()}'")
    if va_only:
        conditions.append("va_relevant=1")
    fq = "SELECT * FROM firms"
    if conditions:
        fq += " WHERE " + " AND ".join(conditions)
    firms = conn.execute(fq).fetchall()
    if va_only:
        print(f"  --va-only: filtering to VA-relevant firms ({len(firms)} in cache)")

    scored: list[tuple[int, dict]] = []
    for f in firms:
        if already_in_outreach(conn, f["crd"]):
            continue
        lead = firms_as_lead(f)
        scored.append((score_lead(lead), lead))

    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:top_n]

    if not top:
        print("No new qualifying leads found.")
        conn.close()
        return

    # Print ranked table
    print(f"\n{'Rank':<5} {'Score':<7} {'Firm':<36} {'St':<4} {'AUM':<10} {'Email'}")
    print("-" * 82)
    for rank, (score, lead) in enumerate(top, 1):
        star  = "*" if score >= LINKEDIN_SCORE_THRESHOLD else " "
        email = (lead.get("contact_email") or "")[:28]
        print(
            f"{rank:<5} {score}{star:<6} {lead['firm_name'][:35]:<36} "
            f"{lead['firm_state']:<4} {_fmt_aum(lead['firm_aum']):<10} {email}"
        )
    print(f"\n* = score >= {LINKEDIN_SCORE_THRESHOLD} (will get LinkedIn DM draft)")
    print(f"\nSaving {len(top)} candidates to outreach table...")

    for _, lead in top:
        save_candidate(
            conn,
            firm_name=lead["firm_name"],
            firm_crd=lead["firm_crd"],
            firm_aum=lead["firm_aum"],
            firm_state=lead["firm_state"],
            score=score_lead(lead),
            contact_email=lead.get("contact_email", ""),
            website=lead.get("website", ""),
        )

    conn.close()
    print("Done. Run `--draft --batch 10` to start drafting.")


# ---------------------------------------------------------------------------
# run_batch_draft  -- Claude drafting + Gmail Drafts
# ---------------------------------------------------------------------------
def run_batch_draft(batch_size: int, auto_approve: bool = False, one_batch: bool = False):
    """
    Draft candidates in batches. Reads sent-mail style from Gmail.
    Approved batches saved to both local DB and Gmail Drafts.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        sys.exit("Error: ANTHROPIC_API_KEY not set in backend/.env")

    claude = Anthropic(api_key=api_key)
    conn   = get_db()

    total = conn.execute(
        "SELECT COUNT(*) FROM outreach WHERE status='candidate'"
    ).fetchone()[0]
    if total == 0:
        print("No candidates queued. Run --analyze first.")
        conn.close()
        return

    print("\n  Reading style reference from Gmail sent mail...")
    style_ref = read_sent_style(n=4)
    print(f"\n{total} candidates queued. Drafting in batches of {batch_size}.")

    batch_num = 0
    while True:
        rows = conn.execute(
            "SELECT * FROM outreach WHERE status='candidate' ORDER BY score DESC, id LIMIT ?",
            (batch_size,),
        ).fetchall()
        if not rows:
            print("\nAll candidates processed.")
            break

        batch_num += 1
        print(f"\n{'='*62}")
        print(f"  BATCH {batch_num}  --  {len(rows)} drafts")
        print(f"{'='*62}")

        batch_drafts = []
        for row in rows:
            # Pull latest data from firms cache (enriched since analyze may have added email/name)
            firm_row = conn.execute(
                "SELECT * FROM firms WHERE crd=?", (row["firm_crd"],)
            ).fetchone()
            if firm_row:
                lead = firms_as_lead(firm_row)
                # outreach row may have email if firms cache was empty at analyze time
                if not lead["contact_email"] and row["contact_email"]:
                    lead["contact_email"] = row["contact_email"]
                    lead["advisor_name"]  = _first_name_from_email(row["contact_email"])
            else:
                email = row["contact_email"] or ""
                lead = {
                    "firm_name":    row["firm_name"],
                    "firm_crd":     row["firm_crd"] or "",
                    "firm_aum":     row["firm_aum"] or 0.0,
                    "firm_state":   row["firm_state"] or "",
                    "client_count": 0,
                    "contact_email": email,
                    "website":      row["website"] or "",
                    "fee_only":     True,
                    "advisor_name": _first_name_from_email(email),
                    "va_relevant":  False,
                }
            score = row["score"]
            print(f"  Drafting: {lead['firm_name']} (score {score}/10)...")
            try:
                subject, body, linkedin = draft_outreach(claude, lead, score, style_ref)
                batch_drafts.append((row["id"], lead, score, subject, body, linkedin))
            except Exception as exc:
                print(f"  Claude error for {lead['firm_name']}: {exc}")

        if not batch_drafts:
            for row in rows:
                conn.execute(
                    "UPDATE outreach SET status='skipped' WHERE id=?", (row["id"],)
                )
            conn.commit()
            continue

        print(f"\n{'-'*62}  REVIEW BATCH {batch_num}  {'-'*62}")
        for _, lead, score, subject, body, linkedin in batch_drafts:
            print_draft(lead, score, subject, body, linkedin)

        print(f"\n{'='*62}")
        print(f"  Batch {batch_num}: {len(batch_drafts)} drafts above.")

        if auto_approve:
            choice = "a"
            print("  [auto-approve] Saving to Gmail Drafts...")
        else:
            while True:
                choice = input(
                    "  [A]pprove all & save to Gmail Drafts  [s]Skip  [q]Quit  > "
                ).strip().lower()
                if choice in ("a", "", "s", "q"):
                    break

        if choice == "q":
            print("  Stopping. Drafts NOT saved.")
            break

        if choice in ("a", ""):
            saved_db = saved_gmail = 0
            for row_id, lead, score, subject, body, linkedin in batch_drafts:
                update_draft(conn, row_id, subject, body, linkedin)
                saved_db += 1
                if save_gmail_draft(lead.get("contact_email", ""), subject, body):
                    saved_gmail += 1
            print(
                f"  v {saved_db} saved to outreach DB, "
                f"{saved_gmail} saved to Gmail Drafts."
            )
            if one_batch:
                break
        else:
            for row_id, *_ in batch_drafts:
                conn.execute(
                    "UPDATE outreach SET status='skipped' WHERE id=?", (row_id,)
                )
            conn.commit()
            print("  Batch skipped.")
            if one_batch:
                break

    conn.close()


# ---------------------------------------------------------------------------
# review_pending
# ---------------------------------------------------------------------------
def review_pending(conn: sqlite3.Connection, auto_send: bool = False):
    rows = conn.execute(
        "SELECT * FROM outreach WHERE status='draft' ORDER BY score DESC, id"
    ).fetchall()
    if not rows:
        print("No pending drafts.")
        return

    print(f"\n{len(rows)} pending drafts (highest score first):")
    for row in rows:
        lead = {
            "firm_name":     row["firm_name"],
            "firm_crd":      row["firm_crd"],
            "firm_aum":      row["firm_aum"] or 0.0,
            "firm_state":    row["firm_state"] or "",
            "client_count":  0,
            "contact_email": row["contact_email"] or "",
            "website":       row["website"] or "",
        }
        print_draft(lead, row["score"], row["subject"], row["body"], row["linkedin_dm"])

        action = "s" if auto_send else _prompt_action()
        if action == "q":
            break
        if action == "s":
            if row["contact_email"]:
                try:
                    send_email(row["contact_email"], row["subject"], row["body"])
                    mark_sent(conn, row["id"])
                    print(f"  v Sent to {row['contact_email']}")
                except Exception as exc:
                    print(f"  x Send failed: {exc}")
            else:
                print("  (no email address — skipping send)")


def _prompt_action() -> str:
    while True:
        raw = input("\n  [S]end  [k]Skip  [q]Quit  > ").strip().lower()
        if raw in ("s", "", "k", "q"):
            return raw or "s"
        print("  Enter S, K, or Q.")


# ---------------------------------------------------------------------------
# stats
# ---------------------------------------------------------------------------
def show_stats(conn: sqlite3.Connection):
    # firms cache summary
    total_firms = conn.execute("SELECT COUNT(*) FROM firms").fetchone()[0]
    enriched    = conn.execute(
        "SELECT COUNT(*) FROM firms WHERE enriched_at IS NOT NULL"
    ).fetchone()[0]
    with_email  = conn.execute(
        "SELECT COUNT(*) FROM firms WHERE contact_email IS NOT NULL"
    ).fetchone()[0]
    va_relevant = conn.execute(
        "SELECT COUNT(*) FROM firms WHERE va_relevant=1"
    ).fetchone()[0]

    # outreach funnel
    rows  = conn.execute(
        "SELECT status, COUNT(*) n FROM outreach GROUP BY status ORDER BY n DESC"
    ).fetchall()
    total = conn.execute("SELECT COUNT(*) FROM outreach").fetchone()[0]
    sent  = conn.execute(
        "SELECT COUNT(*) FROM outreach WHERE status='sent'"
    ).fetchone()[0]

    print(f"\n{'-'*46}")
    print("  Firms cache")
    print(f"{'-'*46}")
    print(f"  total fetched    {total_firms}")
    print(f"  enriched         {enriched}")
    print(f"  with email       {with_email}")
    print(f"  VA-relevant      {va_relevant}")
    print(f"\n{'-'*46}")
    print("  Outreach funnel")
    print(f"{'-'*46}")
    for r in rows:
        print(f"  {r['status']:<16} {r['n']}")
    print(f"{'-'*46}")
    print(f"  total            {total}")
    if total:
        print(f"  send rate        {sent/total*100:.0f}%")
    print()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main():
    p = argparse.ArgumentParser(
        description="AnnuityVoice RIA Outreach Agent",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Workflow:
  1.  --fetch                          Populate firms cache (all 50 states)
      --fetch --state TX               One state only
  2.  --enrich-firms [--limit N]       Brochure PDF -> website + email (default 300)
  3.  --analyze [--top N]              Score cache, save top-N as outreach candidates
  4.  --draft --batch 10 [--yes]       Draft + Gmail Drafts (--yes to auto-approve)
  5.  --review [--send]                Review drafts, send approved
  6.  --stats                          Funnel summary
        """,
    )

    p.add_argument("--state",   metavar="XX",
                   help="Limit to one US state (2-letter code)")

    p.add_argument("--fetch",        action="store_true",
                   help="Populate firms cache from IAPD (skips states already cached)")

    p.add_argument("--enrich-firms", action="store_true",
                   help="Enrich unenriched firms with brochure data (website + email)")
    p.add_argument("--limit",        type=int, default=300, metavar="N",
                   help="Max firms to enrich per run (default 300)")

    p.add_argument("--analyze",  action="store_true",
                   help="Score firms cache, save top-N to outreach candidates")
    p.add_argument("--top",      type=int, default=100, metavar="N",
                   help="Candidates to save per --analyze run (default 100)")
    p.add_argument("--va-only",  action="store_true",
                   help="Restrict --analyze to VA-relevant firms only")

    p.add_argument("--draft",    action="store_true",
                   help="Draft emails for queued candidates via Claude")
    p.add_argument("--batch",    type=int, default=10, metavar="N",
                   help="Drafts per batch (default 10)")
    p.add_argument("--yes",      action="store_true",
                   help="Auto-approve all batches without prompt")
    p.add_argument("--one-batch", action="store_true",
                   help="Stop after first batch (use with --yes for exactly N drafts)")

    p.add_argument("--review",   action="store_true",
                   help="Review saved drafts interactively")
    p.add_argument("--send",     action="store_true",
                   help="Send approved emails via SMTP during --review")

    p.add_argument("--stats",    action="store_true",
                   help="Show firms cache + outreach funnel summary")

    args = p.parse_args()
    load_dotenv(ENV_PATH)

    if args.stats:
        conn = get_db()
        show_stats(conn)
        conn.close()
        return

    if args.fetch:
        run_fetch(states=[args.state] if args.state else None)
        return

    if args.enrich_firms:
        run_enrich_firms(limit=args.limit, state=args.state)
        return

    if args.analyze:
        run_analyze(state=args.state, top_n=args.top, va_only=args.va_only)
        return

    if args.draft:
        run_batch_draft(
            batch_size=args.batch,
            auto_approve=args.yes,
            one_batch=args.one_batch,
        )
        return

    if args.review:
        conn = get_db()
        review_pending(conn, auto_send=args.send)
        conn.close()
        return

    p.print_help()


if __name__ == "__main__":
    main()
