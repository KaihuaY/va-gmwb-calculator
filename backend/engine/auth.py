"""
Email OTP authentication helpers for AnnuityVoice.

Flow:
  1. POST /auth/send-otp   { email }       → generate 6-digit code, store, send email
  2. POST /auth/verify-otp { email, code } → validate, mark used, return success

Email transport (in priority order):
  AWS SES  — set SES_REGION (+ optional FROM_EMAIL)
  SMTP     — set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL
  Dev/none — code is printed to stderr; nothing is returned to the client
"""

import hmac
import os
import random
import smtplib
import ssl
import sys
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText


def generate_otp() -> str:
    """Return a cryptographically random 6-digit string."""
    return f"{random.SystemRandom().randint(0, 999_999):06d}"


def send_otp_email(to_email: str, otp: str) -> None:
    """
    Dispatch the OTP to `to_email` via the first available transport.
    Never raises — logs failures to stderr so the endpoint still returns 200.
    """
    subject = "Your AnnuityVoice access code"
    body = (
        f"Your AnnuityVoice verification code is:\n\n"
        f"    {otp}\n\n"
        f"This code expires in 10 minutes and can only be used once.\n\n"
        f"If you didn't request this, you can safely ignore this email.\n\n"
        f"— The AnnuityVoice Team\n"
    )

    ses_region = os.getenv("SES_REGION")
    if ses_region:
        _send_via_ses(to_email, subject, body, ses_region)
        return

    smtp_host = os.getenv("SMTP_HOST")
    if smtp_host:
        _send_via_smtp(to_email, subject, body)
        return

    # Dev fallback — visible in Lambda logs / uvicorn console, never in the API response
    print(
        f"\n[AnnuityVoice OTP — DEV MODE] To: {to_email} | Code: {otp}\n",
        file=sys.stderr,
    )


def verify_otp_safe(user_input: str, stored_code: str) -> bool:
    """Timing-safe string comparison to prevent timing attacks."""
    return hmac.compare_digest(user_input.strip(), stored_code)


# ---------------------------------------------------------------------------
# Private transport helpers
# ---------------------------------------------------------------------------

def _send_via_ses(to: str, subject: str, body: str, region: str) -> None:
    try:
        import boto3  # type: ignore
        from_email = os.getenv("FROM_EMAIL", "noreply@annuityvoice.com")
        ses = boto3.client("ses", region_name=region)
        ses.send_email(
            Source=from_email,
            Destination={"ToAddresses": [to]},
            Message={
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {"Text": {"Data": body, "Charset": "UTF-8"}},
            },
        )
    except Exception as exc:
        print(f"[AnnuityVoice] SES send failed: {exc}", file=sys.stderr)


def _send_via_smtp(to: str, subject: str, body: str) -> None:
    try:
        host = os.getenv("SMTP_HOST", "")
        port = int(os.getenv("SMTP_PORT", "587"))
        user = os.getenv("SMTP_USER", "")
        password = os.getenv("SMTP_PASS", "")
        from_email = os.getenv("FROM_EMAIL") or user or "noreply@annuityvoice.com"

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"AnnuityVoice <{from_email}>"
        msg["To"] = to
        msg.attach(MIMEText(body, "plain"))

        context = ssl.create_default_context()
        with smtplib.SMTP(host, port) as smtp:
            smtp.ehlo()
            smtp.starttls(context=context)
            if user and password:
                smtp.login(user, password)
            smtp.sendmail(from_email, to, msg.as_string())
    except Exception as exc:
        print(f"[AnnuityVoice] SMTP send failed: {exc}", file=sys.stderr)
