#!/usr/bin/env python3
"""
AnnuityVoice RIA Outreach Agent
--------------------------------
Finds fee-only RIA firms via SEC IAPD API, scores each lead,
uses Claude to draft personalized cold emails and (for high-potential
leads, score >= 7) LinkedIn DM copy, then lets you review and optionally
send via Gmail SMTP.

Usage:
    python tools/ria_outreach.py --state TX --max-leads 20 --dry-run
    python tools/ria_outreach.py --state TX --max-leads 10 --send
    python tools/ria_outreach.py --review
    python tools/ria_outreach.py --stats

Setup (add to backend/.env):
    ANTHROPIC_API_KEY=sk-ant-...
    SMTP_HOST=smtp.gmail.com
    SMTP_PORT=587
    SMTP_USER=you@gmail.com
    SMTP_PASS=<gmail-app-password>
    FROM_EMAIL=kai@annuityvoice.com
"""

import argparse
import json
import os
import re
import smtplib
import sqlite3
import ssl
import sys
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
SCRIPT_DIR = Path(__file__).parent
DB_PATH = SCRIPT_DIR / "outreach_log.db"
ENV_PATH = SCRIPT_DIR.parent / "backend" / ".env"

LINKEDIN_SCORE_THRESHOLD = 7   # score >= this gets a LinkedIn DM draft
SKIP_SCORE_THRESHOLD = 5       # score < this is skipped entirely

TOP_VA_STATES = {"CA", "TX", "FL", "NY", "IL", "OH", "PA", "GA", "NJ", "NC"}

# SEC IAPD public search -- no auth required
IAPD_SEARCH_URL = "https://api.iapd.sec.gov/content/search/firms"
# EDGAR full-text fallback
EDGAR_SEARCH_URL = "https://efts.sec.gov/LATEST/search-index"


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS outreach (
            id            INTEGER PRIMARY KEY,
            ts            TEXT NOT NULL,
            firm_name     TEXT,
            firm_crd      TEXT,
            firm_aum      REAL,
            firm_state    TEXT,
            score         INTEGER,
            contact_email TEXT,
            subject       TEXT,
            body          TEXT,
            linkedin_dm   TEXT,
            status        TEXT DEFAULT 'draft',
            sent_at       TEXT,
            notes         TEXT
        )
    """)
    conn.commit()
    return conn


def already_contacted(conn: sqlite3.Connection, firm_crd: str) -> bool:
    if not firm_crd:
        return False
    row = conn.execute(
        "SELECT id FROM outreach WHERE firm_crd = ?", (firm_crd,)
    ).fetchone()
    return row is not None


def save_candidate(conn, *, firm_name, firm_crd, firm_aum, firm_state,
                   score, contact_email, website) -> int:
    """Save a scored lead as 'candidate' -- no draft yet."""
    ts = datetime.now(timezone.utc).isoformat()
    conn.execute("""
        INSERT OR IGNORE INTO outreach
            (ts, firm_name, firm_crd, firm_aum, firm_state, score,
             contact_email, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'candidate')
    """, (ts, firm_name, firm_crd, firm_aum, firm_state, score, contact_email))
    conn.commit()
    return conn.execute("SELECT last_insert_rowid()").fetchone()[0]


def save_draft(conn, *, firm_name, firm_crd, firm_aum, firm_state,
               score, contact_email, subject, body, linkedin_dm) -> int:
    ts = datetime.now(timezone.utc).isoformat()
    conn.execute("""
        INSERT INTO outreach
            (ts, firm_name, firm_crd, firm_aum, firm_state, score,
             contact_email, subject, body, linkedin_dm, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    """, (ts, firm_name, firm_crd, firm_aum, firm_state, score,
          contact_email, subject, body, linkedin_dm))
    conn.commit()
    return conn.execute("SELECT last_insert_rowid()").fetchone()[0]


def update_draft(conn, row_id: int, subject: str, body: str, linkedin_dm: str | None):
    """Promote a candidate row to a full draft."""
    conn.execute("""
        UPDATE outreach SET subject=?, body=?, linkedin_dm=?, status='draft' WHERE id=?
    """, (subject, body, linkedin_dm, row_id))
    conn.commit()


def mark_sent(conn: sqlite3.Connection, row_id: int):
    conn.execute(
        "UPDATE outreach SET status='sent', sent_at=? WHERE id=?",
        (datetime.now(timezone.utc).isoformat(), row_id),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# Lead sourcing -- SEC IAPD API
# ---------------------------------------------------------------------------
def fetch_leads(state: str | None, max_leads: int) -> list[dict]:
    """
    Fetch RIA firm candidates from SEC IAPD.
    Fetches 3x the requested max so scoring can filter down to the best leads.
    Falls back to EDGAR ADV full-text search if IAPD is unavailable.
    """
    fetch_n = min(max_leads * 3, 100)
    params = {
        "query": "retirement income planning fee-only",
        "rows":  fetch_n,
        "start": 0,
    }
    if state:
        params["state"] = state.upper()

    leads = []
    try:
        resp = requests.get(IAPD_SEARCH_URL, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        # IAPD may return hits under different keys depending on version
        firms = (
            data.get("hits", {}).get("hits", [])
            or data.get("firms", [])
            or data.get("results", [])
        )
        for f in firms:
            src = f.get("_source", f)
            leads.append(_normalise_iapd(src))
        print(f"  [IAPD] {len(leads)} firms returned")
    except Exception as exc:
        print(f"  [IAPD] unavailable ({exc}) -- trying EDGAR fallback...", file=sys.stderr)
        leads = _fetch_edgar_fallback(state, fetch_n)

    return leads


def _normalise_iapd(src: dict) -> dict:
    return {
        "firm_name":    src.get("org_nm") or src.get("firm_name") or "",
        "firm_crd":     str(src.get("org_crd") or src.get("crd_number") or ""),
        "firm_aum":     _parse_aum(src.get("reg_assets_mgmt") or src.get("aum") or 0),
        "firm_state":   (src.get("state_cd") or src.get("state") or "").upper(),
        "client_count": int(src.get("num_clients") or src.get("client_count") or 0),
        "website":      src.get("website_url") or src.get("website") or "",
        "contact_email": src.get("email_addr") or src.get("contact_email") or "",
        "fee_only":     _is_fee_only(src),
    }


def _fetch_edgar_fallback(state: str | None, n: int) -> list[dict]:
    query = '"fee-only" "retirement" "income planning"'
    if state:
        query += f' "{state}"'
    params = {
        "q":         query,
        "forms":     "ADV",
        "dateRange": "custom",
        "startdt":   "2023-01-01",
        "enddt":     "2025-12-31",
    }
    try:
        resp = requests.get(EDGAR_SEARCH_URL, params=params, timeout=15)
        resp.raise_for_status()
        hits = resp.json().get("hits", {}).get("hits", [])[:n]
        results = []
        for h in hits:
            src = h.get("_source", {})
            results.append({
                "firm_name":     src.get("entity_name") or src.get("display_names", [""])[0],
                "firm_crd":      src.get("file_num", "").replace("-", ""),
                "firm_aum":      0.0,
                "firm_state":    state or "",
                "client_count":  0,
                "website":       "",
                "contact_email": "",
                "fee_only":      True,
            })
        print(f"  [EDGAR] {len(results)} firms returned")
        return results
    except Exception as exc2:
        print(f"  [EDGAR] also failed: {exc2}", file=sys.stderr)
        return []


def _parse_aum(raw) -> float:
    if not raw:
        return 0.0
    if isinstance(raw, (int, float)):
        return float(raw)
    s = str(raw).replace(",", "").replace("$", "").strip()
    for suffix, mult in (("B", 1e9), ("M", 1e6), ("K", 1e3)):
        if s.upper().endswith(suffix):
            try:
                return float(s[:-1]) * mult
            except ValueError:
                return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def _is_fee_only(src: dict) -> bool:
    flag = src.get("fee_only_flag") or src.get("is_fee_only") or ""
    return str(flag).upper() in ("Y", "YES", "TRUE", "1")


# ---------------------------------------------------------------------------
# Lead scoring
# ---------------------------------------------------------------------------
def score_lead(lead: dict) -> int:
    score = 0
    aum = lead.get("firm_aum", 0)
    if 100_000_000 <= aum <= 500_000_000:
        score += 3
    elif 50_000_000 <= aum < 100_000_000:
        score += 2

    clients = lead.get("client_count", 0)
    if 100 <= clients <= 500:
        score += 2

    if lead.get("fee_only"):
        score += 2

    if lead.get("firm_state", "").upper() in TOP_VA_STATES:
        score += 1

    website = (lead.get("website") or "").lower()
    if any(kw in website for kw in ("retirement", "annuity", "income", "planning")):
        score += 1

    return min(score, 10)


# ---------------------------------------------------------------------------
# Claude drafting
# ---------------------------------------------------------------------------
def draft_outreach(client: Anthropic, lead: dict, score: int) -> tuple[str, str, str | None]:
    """Returns (subject, body, linkedin_dm_or_None)."""
    include_linkedin = score >= LINKEDIN_SCORE_THRESHOLD
    aum_fmt = _fmt_aum(lead["firm_aum"])
    clients = lead.get("client_count") or "unknown"

    # Infer client type from AUM per client
    if lead["firm_aum"] and lead.get("client_count"):
        aum_per = lead["firm_aum"] / lead["client_count"]
        client_type = "high-net-worth" if aum_per > 1_000_000 else "mass-affluent retail"
    else:
        client_type = "retail"

    linkedin_block = (
        "\n3. LINKEDIN DM: Exactly 2 sentences. "
        "One specific hook referencing their practice, then a link to annuityvoice.com. "
        "No pleasantries, no sign-off.\n"
        "Format: LINKEDIN:\n<dm text>"
        if include_linkedin else ""
    )

    prompt = f"""You are drafting cold outreach for AnnuityVoice (annuityvoice.com).
AnnuityVoice is a free Monte Carlo calculator for variable annuity GMWB riders -- \
built by an FSA with 15+ years experience. It runs 1,000 scenarios with real \
mortality tables and shows the actuarial value of the income guarantee vs. fees.

Goal: get this RIA to email kai@annuityvoice.com for a free white-label analysis report.

FIRM:
  Name:         {lead["firm_name"]}
  State:        {lead["firm_state"]}
  AUM:          {aum_fmt}
  Clients:      {clients} ({client_type})
  Website:      {lead["website"] or "not available"}
  Fee-only:     {lead["fee_only"]}

Write:
1. EMAIL SUBJECT: Under 60 chars. Reference the firm's location or inferred client type.
2. EMAIL BODY: 3 short paragraphs.
   - Para 1 (1 sentence): Show you understand their practice. Use AUM + client count to infer \
who they serve. Be specific -- not generic ("I noticed you work with clients").
   - Para 2 (2–3 sentences): Concrete scenario. Many {client_type} clients hold GMWB riders \
(Jackson National, Equitable, etc.) that go unanalyzed. Reference the live Jackson example: \
annuityvoice.com/jackson-national-gmwb-calculator. One specific thing the tool shows.
   - Para 3 (1 sentence): Low-friction CTA -- reply to this email or visit annuityvoice.com. \
No forms, no calls, no demos.
   Sign off: Kai / AnnuityVoice{linkedin_block}

Hard rules:
- Peer-to-peer tone. Not salesy.
- Never use: "excited", "thrilled", "fiduciary", "holistic", "synergy", "game-changer".
- No subject line with "Quick question" or "Following up".
- Body under 120 words total.

Format exactly:
SUBJECT: <subject>
BODY:
<email body>
{("LINKEDIN:" + chr(10) + "<dm>") if include_linkedin else ""}"""

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=600,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = response.content[0].text.strip()
    return _parse_claude_response(raw, include_linkedin)


def _parse_claude_response(text: str, include_linkedin: bool) -> tuple[str, str, str | None]:
    subject = ""
    body = ""
    linkedin = None

    m = re.search(r"SUBJECT:\s*(.+?)(?:\n|$)", text, re.IGNORECASE)
    if m:
        subject = m.group(1).strip()

    if include_linkedin:
        m = re.search(r"BODY:\s*\n(.*?)\nLINKEDIN:", text, re.IGNORECASE | re.DOTALL)
    else:
        m = re.search(r"BODY:\s*\n(.*)", text, re.IGNORECASE | re.DOTALL)
    if m:
        body = m.group(1).strip()

    if include_linkedin:
        m = re.search(r"LINKEDIN:\s*\n(.*)", text, re.IGNORECASE | re.DOTALL)
        if m:
            linkedin = m.group(1).strip()

    return subject, body, linkedin


# ---------------------------------------------------------------------------
# SMTP sending -- pattern from backend/engine/auth.py
# ---------------------------------------------------------------------------
def send_email(to_email: str, subject: str, body: str):
    host     = os.getenv("SMTP_HOST", "")
    port     = int(os.getenv("SMTP_PORT", "587"))
    user     = os.getenv("SMTP_USER", "")
    password = os.getenv("SMTP_PASS", "")
    from_email = os.getenv("FROM_EMAIL") or user or "kai@annuityvoice.com"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = f"AnnuityVoice <{from_email}>"
    msg["To"]      = to_email
    msg.attach(MIMEText(body, "plain"))

    context = ssl.create_default_context()
    with smtplib.SMTP(host, port) as smtp:
        smtp.ehlo()
        smtp.starttls(context=context)
        if user and password:
            smtp.login(user, password)
        smtp.sendmail(from_email, to_email, msg.as_string())


# ---------------------------------------------------------------------------
# Terminal display
# ---------------------------------------------------------------------------
SEP = "-" * 58

def _fmt_aum(aum: float) -> str:
    if not aum:
        return "unknown AUM"
    if aum >= 1e9:
        return f"${aum/1e9:.1f}B"
    if aum >= 1e6:
        return f"${aum/1e6:.0f}M"
    return f"${aum:,.0f}"


def print_draft(lead: dict, score: int, subject: str, body: str, linkedin: str | None):
    star = "  * High-potential" if score >= LINKEDIN_SCORE_THRESHOLD else ""
    print(f"\n{SEP}")
    print(f"FIRM:  {lead['firm_name']}  --  {lead['firm_state']}  "
          f"({_fmt_aum(lead['firm_aum'])}, {lead.get('client_count') or '?'} clients)")
    print(f"CRD:   {lead['firm_crd'] or 'n/a'}  |  Score: {score}/10{star}")
    if lead.get("contact_email"):
        print(f"TO:    {lead['contact_email']}")
    else:
        print("TO:    (no email in IAPD -- LinkedIn or manual lookup needed)")
    print(f"\nSUBJECT:\n  {subject}")
    print(f"\nEMAIL BODY:\n{_indent(body)}")
    if linkedin:
        print(f"\nLINKEDIN DM:\n{_indent(linkedin)}")
    else:
        print(f"\n(No LinkedIn DM -- score {score} below threshold {LINKEDIN_SCORE_THRESHOLD})")
    print(SEP)


def _indent(text: str, prefix: str = "  ") -> str:
    return "\n".join(prefix + line for line in text.splitlines())


def prompt_action() -> str:
    while True:
        raw = input("\n  [S]end email  [k]Skip  [q]Quit  > ").strip().lower()
        if raw in ("s", "", "k", "q"):
            return raw or "s"
        print("  Enter S, K, or Q.")


# ---------------------------------------------------------------------------
# Stats view
# ---------------------------------------------------------------------------
def show_stats(conn: sqlite3.Connection):
    rows = conn.execute(
        "SELECT status, COUNT(*) as n FROM outreach GROUP BY status ORDER BY n DESC"
    ).fetchall()
    total = conn.execute("SELECT COUNT(*) FROM outreach").fetchone()[0]
    high  = conn.execute(
        "SELECT COUNT(*) FROM outreach WHERE score >= ?", (LINKEDIN_SCORE_THRESHOLD,)
    ).fetchone()[0]
    sent  = conn.execute(
        "SELECT COUNT(*) FROM outreach WHERE status = 'sent'"
    ).fetchone()[0]

    print(f"\n{'-'*42}")
    print("  AnnuityVoice -- RIA Outreach Funnel")
    print(f"{'-'*42}")
    for r in rows:
        print(f"  {r['status']:<14}  {r['n']}")
    print(f"{'-'*42}")
    print(f"  total          {total}")
    print(f"  high-potential (score>={LINKEDIN_SCORE_THRESHOLD})  {high}")
    if total:
        print(f"  send rate      {sent/total*100:.0f}%")
    print()


# ---------------------------------------------------------------------------
# Review pending drafts
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
            "firm_name":    row["firm_name"],
            "firm_crd":     row["firm_crd"],
            "firm_aum":     row["firm_aum"] or 0.0,
            "firm_state":   row["firm_state"] or "",
            "client_count": 0,
            "contact_email": row["contact_email"] or "",
            "website":      "",
        }
        print_draft(lead, row["score"], row["subject"], row["body"], row["linkedin_dm"])

        if auto_send:
            action = "s"
        else:
            action = prompt_action()

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
                print("  (skipped send -- no email address on record)")


# ---------------------------------------------------------------------------
# Analyze mode -- score and rank leads, save as candidates, no Claude calls
# ---------------------------------------------------------------------------
def run_analyze(state: str | None, top_n: int):
    """
    Fetch ~3x top_n firms, score all, print ranked table, save as candidates.
    No Claude calls. Run this first to build your shortlist.
    """
    conn = get_db()
    print(f"\nFetching leads for analysis (state={state or 'all'}, target top {top_n})...")
    raw = fetch_leads(state=state, max_leads=top_n)

    scored = []
    for lead in raw:
        crd = lead.get("firm_crd", "")
        if already_contacted(conn, crd):
            continue
        score = score_lead(lead)
        if score >= SKIP_SCORE_THRESHOLD:
            scored.append((score, lead))

    # Sort highest score first, take top N
    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:top_n]

    if not top:
        print("No qualifying leads found.")
        conn.close()
        return

    # Print ranked table
    print(f"\n{'Rank':<5} {'Score':<7} {'Firm':<36} {'St':<4} {'AUM':<10} {'Clients':<8} {'Email'}")
    print("-" * 90)
    for rank, (score, lead) in enumerate(top, 1):
        star = "*" if score >= LINKEDIN_SCORE_THRESHOLD else " "
        email = (lead.get("contact_email") or "")[:24]
        print(
            f"{rank:<5} {score}{star:<6} {lead['firm_name'][:35]:<36} "
            f"{lead['firm_state']:<4} {_fmt_aum(lead['firm_aum']):<10} "
            f"{str(lead.get('client_count') or '?'):<8} {email}"
        )
    print(f"\n* = score >= {LINKEDIN_SCORE_THRESHOLD} (will get LinkedIn DM draft)")
    print(f"\nSaving {len(top)} candidates to outreach_log.db...")

    for _, lead in top:
        save_candidate(
            conn,
            firm_name=lead["firm_name"],
            firm_crd=lead.get("firm_crd", ""),
            firm_aum=lead["firm_aum"],
            firm_state=lead["firm_state"],
            score=score_lead(lead),
            contact_email=lead.get("contact_email", ""),
            website=lead.get("website", ""),
        )

    conn.close()
    print(f"Done. Run `--draft --batch 10` to start drafting the top candidates.")


# ---------------------------------------------------------------------------
# Batch draft mode -- draft N at a time, review batch before continuing
# ---------------------------------------------------------------------------
def run_batch_draft(batch_size: int):
    """
    Drafts `batch_size` candidates at a time using Claude.
    Shows all drafts in the batch, then asks for approval before the next batch.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        sys.exit("Error: ANTHROPIC_API_KEY not set in backend/.env")

    claude = Anthropic(api_key=api_key)
    conn   = get_db()

    total_candidates = conn.execute(
        "SELECT COUNT(*) FROM outreach WHERE status='candidate'"
    ).fetchone()[0]

    if total_candidates == 0:
        print("No candidates found. Run --analyze first to build your shortlist.")
        conn.close()
        return

    print(f"\n{total_candidates} candidates queued. Drafting in batches of {batch_size}.")
    batch_num = 0

    while True:
        # Fetch next batch of unprocessed candidates (highest score first)
        rows = conn.execute("""
            SELECT * FROM outreach
            WHERE status = 'candidate'
            ORDER BY score DESC, id
            LIMIT ?
        """, (batch_size,)).fetchall()

        if not rows:
            print("\nAll candidates processed.")
            break

        batch_num += 1
        print(f"\n{'='*58}")
        print(f"  BATCH {batch_num}  --  {len(rows)} drafts  (press Q after reviewing to stop)")
        print(f"{'='*58}")

        # Draft all in this batch first, then display
        batch_drafts = []
        for row in rows:
            lead = {
                "firm_name":    row["firm_name"],
                "firm_crd":     row["firm_crd"] or "",
                "firm_aum":     row["firm_aum"] or 0.0,
                "firm_state":   row["firm_state"] or "",
                "client_count": 0,
                "contact_email": row["contact_email"] or "",
                "website":      "",
                "fee_only":     True,
            }
            score = row["score"]
            print(f"  Drafting: {lead['firm_name']} (score {score}/10)...")
            try:
                subject, body, linkedin = draft_outreach(claude, lead, score)
                batch_drafts.append((row["id"], lead, score, subject, body, linkedin))
            except Exception as exc:
                print(f"  Claude error for {lead['firm_name']}: {exc}")

        if not batch_drafts:
            # Mark these rows as skipped so we don't loop forever
            for row in rows:
                conn.execute("UPDATE outreach SET status='skipped' WHERE id=?", (row["id"],))
            conn.commit()
            continue

        # Display all drafts in this batch
        print(f"\n{'-'*58}  REVIEW BATCH {batch_num}  {'-'*58}")
        for _, lead, score, subject, body, linkedin in batch_drafts:
            print_draft(lead, score, subject, body, linkedin)

        # Single approval prompt for the whole batch
        print(f"\n{'='*58}")
        print(f"  Batch {batch_num}: {len(batch_drafts)} drafts above.")
        while True:
            choice = input(
                "  [A]pprove all & continue  [s]Skip batch  [q]Quit  > "
            ).strip().lower()
            if choice in ("a", "", "s", "q"):
                break

        if choice == "q":
            print("  Stopping. Drafts NOT saved.")
            break

        if choice in ("a", ""):
            # Save all approved drafts to DB
            for row_id, lead, score, subject, body, linkedin in batch_drafts:
                update_draft(conn, row_id, subject, body, linkedin)
            print(f"  v {len(batch_drafts)} drafts saved. Run --review to send them.")
        else:
            # Mark as skipped so next --draft run skips them
            for row_id, *_ in batch_drafts:
                conn.execute(
                    "UPDATE outreach SET status='skipped' WHERE id=?", (row_id,)
                )
            conn.commit()
            print("  Batch skipped.")

    conn.close()


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------
def run_pipeline(state: str | None, max_leads: int, auto_send: bool):
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        sys.exit("Error: ANTHROPIC_API_KEY not set in backend/.env")

    claude = Anthropic(api_key=api_key)
    conn   = get_db()

    print(f"\nFetching RIA leads (state={state or 'all'}, max={max_leads})...")
    raw = fetch_leads(state=state, max_leads=max_leads)

    if not raw:
        print("No leads returned -- check IAPD/EDGAR connectivity.")
        conn.close()
        return

    drafted = 0
    for lead in raw:
        if drafted >= max_leads:
            break

        crd = lead.get("firm_crd", "")
        if already_contacted(conn, crd):
            print(f"  skip (already contacted): {lead['firm_name']}")
            continue

        score = score_lead(lead)
        if score < SKIP_SCORE_THRESHOLD:
            print(f"  skip (score {score}/10 < {SKIP_SCORE_THRESHOLD}): {lead['firm_name']}")
            continue

        print(f"\n  Drafting for {lead['firm_name']} -- score {score}/10"
              + (" *" if score >= LINKEDIN_SCORE_THRESHOLD else "") + " ...")

        try:
            subject, body, linkedin = draft_outreach(claude, lead, score)
        except Exception as exc:
            print(f"  Claude error: {exc}")
            continue

        if not subject or not body:
            print("  Empty draft returned -- skipping.")
            continue

        row_id = save_draft(
            conn,
            firm_name=lead["firm_name"],
            firm_crd=crd,
            firm_aum=lead["firm_aum"],
            firm_state=lead["firm_state"],
            score=score,
            contact_email=lead.get("contact_email", ""),
            subject=subject,
            body=body,
            linkedin_dm=linkedin,
        )

        print_draft(lead, score, subject, body, linkedin)

        if auto_send:
            action = "s"
        else:
            action = prompt_action()

        if action == "q":
            break
        if action == "s":
            if lead.get("contact_email"):
                try:
                    send_email(lead["contact_email"], subject, body)
                    mark_sent(conn, row_id)
                    print(f"  v Sent to {lead['contact_email']}")
                except Exception as exc:
                    print(f"  x Send failed: {exc}")
            else:
                print("  (draft saved -- no email address from IAPD; use LinkedIn DM or manual lookup)")

        drafted += 1

    conn.close()
    print(f"\nDone. {drafted} leads processed.")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="AnnuityVoice RIA Outreach Agent",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Recommended workflow:
  1. python tools/ria_outreach.py --state TX --analyze --top 100
       Fetch & score leads, show ranked table, save as candidates.

  2. python tools/ria_outreach.py --draft --batch 10
       Draft 10 at a time. Review each batch, approve to continue.

  3. python tools/ria_outreach.py --review --send
       Review saved drafts and send approved emails.

  4. python tools/ria_outreach.py --stats
       Check the outreach funnel.
        """,
    )
    parser.add_argument("--state",   metavar="XX",
                        help="Filter by US state code (e.g. TX)")

    # Step 1: Analyze / build shortlist
    parser.add_argument("--analyze",  action="store_true",
                        help="Score & rank leads, save as candidates (no Claude calls)")
    parser.add_argument("--top",      type=int, default=100, metavar="N",
                        help="Number of top candidates to keep (default 100)")

    # Step 2: Batch drafting
    parser.add_argument("--draft",    action="store_true",
                        help="Draft emails for queued candidates (uses Claude)")
    parser.add_argument("--batch",    type=int, default=10, metavar="N",
                        help="Drafts per batch before review prompt (default 10)")

    # Step 3: Review / send
    parser.add_argument("--review",   action="store_true",
                        help="Review saved drafts interactively")
    parser.add_argument("--send",     action="store_true",
                        help="Send approved emails via SMTP during --review")

    # Legacy / quick mode
    parser.add_argument("--max-leads", type=int, default=10, metavar="N",
                        help="(legacy) Draft N leads in one pass without --analyze first")
    parser.add_argument("--dry-run",   action="store_true",
                        help="Draft and display only -- no sending")

    parser.add_argument("--stats",    action="store_true",
                        help="Show outreach funnel summary")
    args = parser.parse_args()

    load_dotenv(ENV_PATH)
    conn = get_db()

    if args.stats:
        show_stats(conn)
        conn.close()
        return

    if args.analyze:
        conn.close()
        run_analyze(state=args.state, top_n=args.top)
        return

    if args.draft:
        conn.close()
        run_batch_draft(batch_size=args.batch)
        return

    if args.review:
        review_pending(conn, auto_send=args.send and not args.dry_run)
        conn.close()
        return

    conn.close()
    # Legacy single-pass mode
    run_pipeline(
        state=args.state,
        max_leads=args.max_leads,
        auto_send=args.send and not args.dry_run,
    )


if __name__ == "__main__":
    main()
