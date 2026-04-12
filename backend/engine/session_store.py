"""
Session store: persists each simulation run alongside the submitting user's email.

Storage: SQLite with a structured columns + a `meta` JSON column for extensible fields.

Schema (sessions table):
  id          INTEGER PRIMARY KEY AUTOINCREMENT
  ts          TEXT    — ISO-8601 UTC timestamp
  email       TEXT    — user email (from email-gate / post-run capture)
  role        TEXT    — user role (optional)
  mode        TEXT    — 'standard' | 'advanced'
  -- Key inputs (structured for easy filtering/grouping) --
  current_age INTEGER
  gender      TEXT
  riders      TEXT    — comma-separated e.g. 'gmwb,gmdb'
  account_value  REAL
  benefit_base   REAL
  election_age   INTEGER
  withdrawal_rate REAL
  rider_fee      REAL
  me_fee         REAL
  mu             REAL
  sigma          REAL
  num_scenarios  INTEGER
  -- High-level results --
  gmwb_mean   REAL
  gmdb_mean   REAL
  fee_mean    REAL
  net_mean    REAL
  -- Extensible blob for any future fields --
  meta        TEXT    — JSON string (product name, company, notes, full params, etc.)
"""

import json
import sqlite3
import datetime
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "sessions.db"


def _get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_table(conn: sqlite3.Connection):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            ts              TEXT    NOT NULL,
            email           TEXT,
            role            TEXT,
            mode            TEXT,
            current_age     INTEGER,
            gender          TEXT,
            riders          TEXT,
            account_value   REAL,
            benefit_base    REAL,
            election_age    INTEGER,
            withdrawal_rate REAL,
            rider_fee       REAL,
            me_fee          REAL,
            mu              REAL,
            sigma           REAL,
            num_scenarios   INTEGER,
            gmwb_mean       REAL,
            gmdb_mean       REAL,
            fee_mean        REAL,
            net_mean        REAL,
            meta            TEXT
        )
    """)
    conn.commit()


def save_session(
    *,
    email: str | None,
    role: str | None,
    mode: str,
    params: dict,
    results: dict,
    extra: dict | None = None,          # any future fields (product name, company, notes…)
) -> int:
    """
    Persist one simulation session. Returns the new row id.

    `extra` is merged into the `meta` JSON column alongside the full params snapshot.
    This means you can add any fields later without touching the schema:

        save_session(..., extra={"product_name": "SecurePath Elite", "company": "ABC Life"})
    """
    riders = ",".join(filter(None, [
        "gmwb" if params.get("gmwb_enabled") else "",
        "gmdb" if params.get("gmdb_enabled") else "",
    ]))

    meta = {
        "full_params": params,          # complete input snapshot for reproducibility
        **(extra or {}),
    }

    row = (
        datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        email,
        role,
        mode,
        params.get("current_age"),
        params.get("gender"),
        riders,
        params.get("account_value"),
        params.get("benefit_base"),
        params.get("election_age"),
        params.get("withdrawal_rate"),
        params.get("rider_fee"),
        params.get("me_fee"),
        params.get("mu"),
        params.get("sigma"),
        params.get("num_scenarios"),
        results.get("claim_stats", {}).get("mean"),
        results.get("gmdb_stats", {}).get("mean"),
        results.get("fee_stats", {}).get("mean"),
        results.get("net_stats", {}).get("mean"),
        json.dumps(meta),
    )

    with _get_conn() as conn:
        _ensure_table(conn)
        cur = conn.execute("""
            INSERT INTO sessions (
                ts, email, role, mode,
                current_age, gender, riders,
                account_value, benefit_base, election_age,
                withdrawal_rate, rider_fee, me_fee,
                mu, sigma, num_scenarios,
                gmwb_mean, gmdb_mean, fee_mean, net_mean,
                meta
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, row)
        return cur.lastrowid
