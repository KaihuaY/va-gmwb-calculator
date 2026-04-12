"""
SQLite-backed OTP store — shares the sessions.db database.

Table: otp_codes
  id         INTEGER PK AUTOINCREMENT
  email      TEXT    NOT NULL (lowercase)
  code       TEXT    NOT NULL
  created_at TEXT    ISO-8601 UTC
  expires_at TEXT    ISO-8601 UTC
  used       INTEGER 0 = active, 1 = consumed/invalidated

Policy:
  - Expiry:        10 minutes from creation
  - Rate limit:    3 send requests per email per 10-minute window
  - Single-use:    verified code is immediately marked used=1
  - Supersede:     any previous unused code for the same email is invalidated on new send
"""

import datetime
import sqlite3
from pathlib import Path

from .auth import verify_otp_safe

OTP_EXPIRY_MINUTES = 10
RATE_LIMIT_WINDOW_MINUTES = 10
RATE_LIMIT_MAX = 3

# Reuse the same SQLite file as session_store
DB_PATH = Path(__file__).parent.parent / "data" / "sessions.db"


def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS otp_codes (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            email      TEXT    NOT NULL,
            code       TEXT    NOT NULL,
            created_at TEXT    NOT NULL,
            expires_at TEXT    NOT NULL,
            used       INTEGER NOT NULL DEFAULT 0
        )
    """)
    conn.commit()


def is_rate_limited(email: str) -> bool:
    """
    Return True when 3 or more OTPs have been requested by `email`
    within the last RATE_LIMIT_WINDOW_MINUTES minutes.
    """
    window_start = (
        datetime.datetime.utcnow()
        - datetime.timedelta(minutes=RATE_LIMIT_WINDOW_MINUTES)
    ).isoformat(timespec="seconds") + "Z"

    with _conn() as conn:
        _ensure_table(conn)
        row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM otp_codes WHERE email = ? AND created_at > ?",
            (email.lower(), window_start),
        ).fetchone()
        return (row["cnt"] if row else 0) >= RATE_LIMIT_MAX


def save_otp(email: str, code: str) -> None:
    """
    Persist a new OTP for `email`.
    All previous unused codes for this email are invalidated first so only
    the latest code is valid at any time.
    """
    now = datetime.datetime.utcnow()
    expires = now + datetime.timedelta(minutes=OTP_EXPIRY_MINUTES)
    now_s = now.isoformat(timespec="seconds") + "Z"
    exp_s = expires.isoformat(timespec="seconds") + "Z"

    with _conn() as conn:
        _ensure_table(conn)
        # Invalidate any outstanding codes for this email
        conn.execute(
            "UPDATE otp_codes SET used = 1 WHERE email = ? AND used = 0",
            (email.lower(),),
        )
        conn.execute(
            "INSERT INTO otp_codes (email, code, created_at, expires_at, used) "
            "VALUES (?, ?, ?, ?, 0)",
            (email.lower(), code, now_s, exp_s),
        )
        conn.commit()


def verify_otp(email: str, code: str) -> tuple[bool, str]:
    """
    Validate `code` for `email`.  Returns (success, error_message).

    On success the code is immediately marked used so it cannot be replayed.
    Uses timing-safe comparison to prevent enumeration.
    """
    now = datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z"

    with _conn() as conn:
        _ensure_table(conn)
        row = conn.execute(
            """
            SELECT id, code, expires_at
            FROM otp_codes
            WHERE email = ? AND used = 0
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (email.lower(),),
        ).fetchone()

        if row is None:
            return False, "No active code found. Please request a new one."

        if row["expires_at"] < now:
            return False, "This code has expired. Please request a new one."

        if not verify_otp_safe(code.strip(), row["code"]):
            return False, "Incorrect code. Please try again."

        # Consume the code
        conn.execute(
            "UPDATE otp_codes SET used = 1 WHERE id = ?",
            (row["id"],),
        )
        conn.commit()

    return True, ""
