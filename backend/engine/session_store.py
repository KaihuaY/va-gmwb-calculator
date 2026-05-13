"""
Session store: persists each simulation run alongside the submitting user's email.

Storage:
  - On AWS Lambda (AWS_LAMBDA_FUNCTION_NAME set): DynamoDB (durable across cold starts).
    Tables: annuityvoice-sessions, annuityvoice-ria-interest.
  - Local dev:                                     SQLite at backend/data/sessions.db.

The save_* functions return a string id (uuid on Lambda, str(rowid) in dev) so callers
don't need to know which backend is active.
"""

import json
import os
import sqlite3
import datetime
import uuid
from decimal import Decimal
from pathlib import Path


def _to_ddb(v):
    """Convert Python values to DynamoDB-safe types (floats → Decimal, recursive)."""
    if isinstance(v, float):
        if v != v or v in (float("inf"), float("-inf")):
            return None
        return Decimal(str(v))
    if isinstance(v, dict):
        return {k: _to_ddb(x) for k, x in v.items() if _to_ddb(x) is not None}
    if isinstance(v, (list, tuple)):
        return [_to_ddb(x) for x in v if _to_ddb(x) is not None]
    return v

_ON_LAMBDA = bool(os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))
_DDB_REGION = os.environ.get("AWS_REGION", "us-east-2")
_TABLE_SESSIONS      = "annuityvoice-sessions"
_TABLE_RIA_INTEREST  = "annuityvoice-ria-interest"

DB_PATH = Path(__file__).parent.parent / "data" / "sessions.db"


# ---------------------------------------------------------------------------
# DynamoDB helpers (Lambda)
# ---------------------------------------------------------------------------
def _ddb_resource():
    import boto3  # lazy import — only needed in Lambda
    return boto3.resource("dynamodb", region_name=_DDB_REGION)


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


# ---------------------------------------------------------------------------
# SQLite helpers (local dev)
# ---------------------------------------------------------------------------
def _get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_sessions_table(conn: sqlite3.Connection):
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


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def save_ria_interest(name: str, email: str, message: str) -> str:
    """Persist an RIA interest form submission. Returns the new record id."""
    ts    = _now_iso()
    name  = (name or "").strip()
    email = (email or "").strip().lower()
    msg   = (message or "").strip()

    if _ON_LAMBDA:
        item_id = str(uuid.uuid4())
        _ddb_resource().Table(_TABLE_RIA_INTEREST).put_item(Item={
            "id": item_id, "ts": ts, "name": name, "email": email, "message": msg,
        })
        return item_id

    with _get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ria_interest (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                ts      TEXT NOT NULL,
                name    TEXT,
                email   TEXT NOT NULL,
                message TEXT
            )
        """)
        conn.commit()
        cur = conn.execute(
            "INSERT INTO ria_interest (ts, name, email, message) VALUES (?,?,?,?)",
            (ts, name, email, msg),
        )
        return str(cur.lastrowid)


def save_session(
    *,
    email: str | None,
    role: str | None,
    mode: str,
    params: dict,
    results: dict,
    extra: dict | None = None,
) -> str:
    """
    Persist one simulation session. Returns the new record id.
    `extra` is merged into the `meta` blob alongside the full params snapshot.
    """
    riders = ",".join(filter(None, [
        "gmwb" if params.get("gmwb_enabled") else "",
        "gmdb" if params.get("gmdb_enabled") else "",
    ]))
    meta = {"full_params": params, **(extra or {})}
    ts = _now_iso()

    record = {
        "ts":              ts,
        "email":           email,
        "role":            role,
        "mode":            mode,
        "current_age":     params.get("current_age"),
        "gender":          params.get("gender"),
        "riders":          riders,
        "account_value":   params.get("account_value"),
        "benefit_base":    params.get("benefit_base"),
        "election_age":    params.get("election_age"),
        "withdrawal_rate": params.get("withdrawal_rate"),
        "rider_fee":       params.get("rider_fee"),
        "me_fee":          params.get("me_fee"),
        "mu":              params.get("mu"),
        "sigma":           params.get("sigma"),
        "num_scenarios":   params.get("num_scenarios"),
        "gmwb_mean":       results.get("claim_stats", {}).get("mean"),
        "gmdb_mean":       results.get("gmdb_stats", {}).get("mean"),
        "fee_mean":        results.get("fee_stats", {}).get("mean"),
        "net_mean":        results.get("net_stats", {}).get("mean"),
    }

    if _ON_LAMBDA:
        item_id = str(uuid.uuid4())
        # DynamoDB rejects None and floats; convert floats → Decimal, drop None/NaN.
        item = {"id": item_id}
        for k, v in record.items():
            converted = _to_ddb(v)
            if converted is None:
                continue
            item[k] = converted
        item["meta"] = json.dumps(meta, default=str)
        _ddb_resource().Table(_TABLE_SESSIONS).put_item(Item=item)
        return item_id

    # SQLite path
    with _get_conn() as conn:
        _ensure_sessions_table(conn)
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
        """, (
            ts, email, role, mode,
            record["current_age"], record["gender"], riders,
            record["account_value"], record["benefit_base"], record["election_age"],
            record["withdrawal_rate"], record["rider_fee"], record["me_fee"],
            record["mu"], record["sigma"], record["num_scenarios"],
            record["gmwb_mean"], record["gmdb_mean"], record["fee_mean"], record["net_mean"],
            json.dumps(meta, default=str),
        ))
        return str(cur.lastrowid)
