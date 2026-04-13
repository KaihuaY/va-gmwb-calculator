"""
query_sessions.py — Inspect and export AnnuityVoice simulation session data.

USAGE
─────
  # Show recent runs
  python query_sessions.py

  # Show all runs from a specific user
  python query_sessions.py --email user@example.com

  # Export everything to CSV
  python query_sessions.py --csv sessions_export.csv

  # Download the current /tmp/sessions.db from Lambda and query it locally
  python query_sessions.py --download-from-lambda

DATA SOURCE
───────────
Dev / local:
  Sessions are stored in  backend/data/sessions.db
  (populated by the local uvicorn server — every simulation run records a row)

Production (Lambda):
  Sessions live in  /tmp/sessions.db  on the Lambda container.
  /tmp is ephemeral — it resets on cold starts (~15 min of inactivity).
  To capture data before it's lost, either:
    (a) Run --download-from-lambda periodically to pull it down
    (b) Add an S3 sync step (see `backup_to_s3` below — call it from Lambda)

SCHEMA
──────
sessions
  id              INTEGER  — autoincrement primary key
  ts              TEXT     — ISO-8601 UTC timestamp (e.g. "2026-04-13T12:00:00Z")
  email           TEXT     — verified email (NULL for anonymous standard-mode runs)
  role            TEXT     — user role (advisor / student / actuary / other)
  mode            TEXT     — "standard" | "advanced"
  current_age     INTEGER
  gender          TEXT     — "male" | "female"
  riders          TEXT     — comma-sep e.g. "gmwb" or "gmwb,gmdb"
  account_value   REAL
  benefit_base    REAL
  election_age    INTEGER
  withdrawal_rate REAL     — e.g. 0.05 = 5%
  rider_fee       REAL
  me_fee          REAL
  mu              REAL     — expected return
  sigma           REAL     — volatility
  num_scenarios   INTEGER
  gmwb_mean       REAL     — PV(GMWB claims), mean across scenarios
  gmdb_mean       REAL     — PV(GMDB claims), mean across scenarios
  fee_mean        REAL     — PV(fees), mean across scenarios
  net_mean        REAL     — net benefit to policyholder (gmwb+gmdb-fees)
  meta            TEXT     — JSON: {"full_params": {...}, "product_name": "...", ...}
"""

import argparse
import csv
import json
import sqlite3
import sys
from pathlib import Path

# ── Path resolution ────────────────────────────────────────────────────────────
LOCAL_DB = Path(__file__).parent / "data" / "sessions.db"


def get_conn(db_path: Path) -> sqlite3.Connection:
    if not db_path.exists():
        print(f"[warn] Database not found: {db_path}", file=sys.stderr)
        print("       Run the local backend and click Run Simulation to create it.", file=sys.stderr)
        sys.exit(1)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


# ── Core queries ───────────────────────────────────────────────────────────────

def show_recent(conn, limit=20):
    """Print the N most recent simulation runs."""
    rows = conn.execute("""
        SELECT id, ts, email, mode, current_age, withdrawal_rate,
               account_value, gmwb_mean, fee_mean, net_mean, riders
        FROM sessions
        ORDER BY id DESC
        LIMIT ?
    """, (limit,)).fetchall()
    if not rows:
        print("No sessions found.")
        return
    print(f"\n{'ID':>4}  {'Timestamp':>22}  {'Email':>28}  {'Mode':>8}  {'Age':>3}  "
          f"{'WD%':>5}  {'AV ($K)':>7}  {'GMWB ($K)':>9}  {'Net ($K)':>8}  Riders")
    print("─" * 110)
    for r in rows:
        print(f"{r['id']:>4}  {r['ts']:>22}  {(r['email'] or 'anon'):>28}  "
              f"{r['mode']:>8}  {r['current_age']:>3}  "
              f"{r['withdrawal_rate']*100:>4.1f}%  "
              f"{r['account_value']/1000:>7.0f}  "
              f"{(r['gmwb_mean'] or 0)/1000:>9.1f}  "
              f"{(r['net_mean'] or 0)/1000:>8.1f}  "
              f"{r['riders']}")


def show_summary(conn):
    """Print aggregate statistics."""
    stats = conn.execute("""
        SELECT
            COUNT(*)                                     AS total_runs,
            COUNT(DISTINCT email)                        AS unique_emails,
            SUM(mode = 'advanced')                       AS advanced_runs,
            SUM(mode = 'standard')                       AS standard_runs,
            ROUND(AVG(account_value), 0)                 AS avg_av,
            ROUND(AVG(withdrawal_rate) * 100, 2)         AS avg_wd_pct,
            MIN(ts)                                      AS first_run,
            MAX(ts)                                      AS last_run
        FROM sessions
    """).fetchone()
    if not stats or stats['total_runs'] == 0:
        print("No sessions found.")
        return
    print("\n── Session Summary ──────────────────────────────")
    print(f"  Total runs       : {stats['total_runs']}")
    print(f"  Unique emails    : {stats['unique_emails']}")
    print(f"  Standard / Adv   : {stats['standard_runs']} / {stats['advanced_runs']}")
    print(f"  Avg account value: ${stats['avg_av']:,.0f}")
    print(f"  Avg WD rate      : {stats['avg_wd_pct']:.1f}%")
    print(f"  First run        : {stats['first_run']}")
    print(f"  Last run         : {stats['last_run']}")
    print()


def show_by_email(conn, email):
    """Print all runs for a specific email."""
    rows = conn.execute("""
        SELECT * FROM sessions WHERE email = ? ORDER BY id
    """, (email,)).fetchall()
    if not rows:
        print(f"No runs found for {email}")
        return
    print(f"\n{len(rows)} runs for {email}:\n")
    for r in rows:
        meta = json.loads(r['meta'] or '{}')
        print(f"  [{r['id']}] {r['ts']}  mode={r['mode']}  "
              f"age={r['current_age']}  av=${r['account_value']:,.0f}  "
              f"net=${(r['net_mean'] or 0):,.0f}")
        if meta.get('product_name'):
            print(f"       product: {meta['product_name']}")


def export_csv(conn, output_path: str):
    """Export all sessions to CSV, expanding the meta JSON column."""
    rows = conn.execute("SELECT * FROM sessions ORDER BY id").fetchall()
    if not rows:
        print("No sessions to export.")
        return

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        base_cols = [d[0] for d in conn.execute("PRAGMA table_info(sessions)").fetchall()
                     if d[1] != 'meta']
        writer = csv.writer(f)
        writer.writerow(base_cols + ["meta_json"])
        for r in rows:
            meta_str = r['meta'] or '{}'
            writer.writerow([r[c] for c in base_cols] + [meta_str])
    print(f"Exported {len(rows)} rows → {output_path}")


# ── Lambda /tmp download ───────────────────────────────────────────────────────

def download_from_lambda(dest: str = "sessions_from_lambda.db"):
    """
    Invoke a special Lambda endpoint to base64-encode and return the SQLite file.

    PREREQUISITE: The Lambda must expose a /admin/export-db endpoint
    (not implemented by default — see note below).

    Simpler alternative: use Lambda console → Actions → Test with the
    payload {"path": "/admin/export-db"} if you add that endpoint,
    OR use AWS CLI to invoke Lambda directly and pass the response binary.

    CHEAPEST APPROACH: Add an S3 sync at the end of every Lambda execution.
    See `backup_to_s3()` below — call it from main.py on every /record.
    """
    print("download_from_lambda not yet wired up.")
    print("See docstring in this function for options.")


def backup_to_s3(bucket: str, key: str = "sessions/sessions.db"):
    """
    Copy /tmp/sessions.db to S3. Call this from the /record endpoint after
    save_session() succeeds to durably persist session data.

    Example — add to backend/main.py /record endpoint:

        from engine.session_store import save_session, maybe_backup_to_s3
        row_id = save_session(...)
        maybe_backup_to_s3()   # fire-and-forget, swallows errors

    In session_store.py, add:

        import boto3, os
        from pathlib import Path

        def maybe_backup_to_s3():
            bucket = os.environ.get("SESSIONS_S3_BUCKET")
            if not bucket:
                return
            try:
                s3 = boto3.client("s3")
                s3.upload_file(str(DB_PATH), bucket, "sessions/sessions.db")
            except Exception as exc:
                print(f"[sessions] S3 backup failed: {exc}", file=sys.stderr)

    Then in Lambda env vars: SESSIONS_S3_BUCKET=your-bucket-name

    To restore / query locally:
        aws s3 cp s3://your-bucket/sessions/sessions.db sessions.db
        python query_sessions.py --db sessions.db
    """
    try:
        import boto3
        s3 = boto3.client("s3")
        db_path = Path("/tmp/sessions.db")
        if not db_path.exists():
            print("No sessions.db in /tmp — nothing to back up.")
            return
        s3.upload_file(str(db_path), bucket, key)
        print(f"Backed up to s3://{bucket}/{key}")
    except Exception as exc:
        print(f"Backup failed: {exc}", file=sys.stderr)


# ── Sample ad-hoc queries (copy-paste friendly) ────────────────────────────────

SAMPLE_QUERIES = """
── Useful ad-hoc SQL queries (run with sqlite3 data/sessions.db) ──────────────

-- Total runs by mode
SELECT mode, COUNT(*) as runs FROM sessions GROUP BY mode;

-- Runs per day
SELECT substr(ts, 1, 10) as date, COUNT(*) as runs
FROM sessions GROUP BY date ORDER BY date;

-- Unique users who ran Advanced
SELECT DISTINCT email FROM sessions WHERE mode = 'advanced' AND email IS NOT NULL;

-- Most popular account values (bucketed to nearest $100K)
SELECT ROUND(account_value / 100000) * 100000 AS av_bucket, COUNT(*) AS n
FROM sessions GROUP BY av_bucket ORDER BY n DESC;

-- Average results by rider combination
SELECT riders,
       ROUND(AVG(gmwb_mean), 0)  AS avg_gmwb,
       ROUND(AVG(fee_mean), 0)   AS avg_fees,
       ROUND(AVG(net_mean), 0)   AS avg_net,
       COUNT(*)                   AS n
FROM sessions GROUP BY riders;

-- Runs with very high shortfall risk (net > 0 means guarantee paid off)
SELECT id, ts, email, current_age, withdrawal_rate, net_mean
FROM sessions WHERE net_mean > 0 ORDER BY net_mean DESC LIMIT 10;

-- Full params for a specific run (pretty-print the meta JSON)
SELECT json(meta) FROM sessions WHERE id = 42;
"""


# ── CLI entry point ────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Query AnnuityVoice session database.")
    parser.add_argument("--db", default=str(LOCAL_DB), help="Path to sessions.db")
    parser.add_argument("--email", help="Show all runs for this email")
    parser.add_argument("--csv", metavar="OUTPUT.csv", help="Export all rows to CSV")
    parser.add_argument("--queries", action="store_true", help="Print sample SQL queries")
    parser.add_argument("--download-from-lambda", action="store_true")
    parser.add_argument("--limit", type=int, default=20, help="Rows for recent list (default 20)")
    args = parser.parse_args()

    if args.queries:
        print(SAMPLE_QUERIES)
        return

    if args.download_from_lambda:
        download_from_lambda()
        return

    conn = get_conn(Path(args.db))
    show_summary(conn)

    if args.email:
        show_by_email(conn, args.email)
    elif args.csv:
        export_csv(conn, args.csv)
    else:
        show_recent(conn, args.limit)


if __name__ == "__main__":
    main()
