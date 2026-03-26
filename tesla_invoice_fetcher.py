"""
Tesla Invoice Fetcher
Automatically downloads Supercharger and Premium Connectivity invoices
using the Tesla Fleet API and Ownership API, and stores them locally / sends via email.
"""

import json
import logging
import os
import smtplib
import sys
import time
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime
from pathlib import Path

import requests
from dotenv import load_dotenv

# Load config from AUTH_DIR if set (Docker volume), otherwise fall back to local .env
load_dotenv(Path(os.environ.get("AUTH_DIR", ".")) / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CLIENT_ID = os.getenv("TESLA_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("TESLA_CLIENT_SECRET", "")
TESLA_REGION = os.getenv("TESLA_REGION", "eu")
TESLA_VINS = [v.strip() for v in os.getenv("TESLA_VINS", "").split(",") if v.strip()]
OUTPUT_DIR = Path(os.getenv("INVOICE_OUTPUT_DIR", "./invoices"))
TRACKING_FILE = OUTPUT_DIR / ".downloaded_invoices.json"
INVOICE_NAME_PATTERN = os.getenv(
    "INVOICE_NAME_PATTERN",
    "{date} - Tesla - {label} {name} - IT Precision Analytics",
)
AUTH_DIR = Path(os.getenv("AUTH_DIR", "."))
TOKEN_FILE = AUTH_DIR / "tokens.json"

TESLA_EMAIL = os.getenv("TESLA_EMAIL", "")

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
EMAIL_FROM = os.getenv("EMAIL_FROM", "")
EMAIL_TO = os.getenv("EMAIL_TO", "")

AUTH_BASE = "https://auth.tesla.com/oauth2/v3"
FLEET_API_BASES = {
    "na": "https://fleet-api.prd.na.vn.cloud.tesla.com",
    "eu": "https://fleet-api.prd.eu.vn.cloud.tesla.com",
    "cn": "https://fleet-api.prd.cn.vn.cloud.tesla.cn",
}
FLEET_BASE = FLEET_API_BASES.get(TESLA_REGION, FLEET_API_BASES["eu"])
OWNERSHIP_BASE = "https://ownership.tesla.com"


# ---------------------------------------------------------------------------
# Unified token storage
#
# tokens.json format:
# {
#   "fleet": {
#     "access_token": "...", "refresh_token": "...",
#     "token_type": "Bearer", "expires_at": 1774503357.0
#   },
#   "ownership": {
#     "access_token": "...", "refresh_token": "...",
#     "token_type": "Bearer", "expires_at": 1774503357.0
#   }
# }
# ---------------------------------------------------------------------------
def load_tokens() -> dict:
    """Load unified token file, auto-migrating from old format if needed."""
    if not TOKEN_FILE.exists():
        migrated = _migrate_tokens()
        if migrated:
            return migrated
        return {}
    raw = TOKEN_FILE.read_text().strip()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        log.warning("tokens.json is corrupt, starting fresh")
        return {}
    # Detect old flat format (fleet tokens at root level without "fleet" key)
    if "access_token" in data and "fleet" not in data:
        return _migrate_tokens()
    return data


def save_tokens(tokens: dict) -> None:
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_FILE.write_text(json.dumps(tokens, indent=2))


def _migrate_tokens() -> dict:
    """Migrate from old split format (flat tokens.json + cache.json) to unified format."""
    tokens = {}

    # Migrate old flat Fleet API tokens from tokens.json
    if TOKEN_FILE.exists():
        try:
            old = json.loads(TOKEN_FILE.read_text())
            if "access_token" in old and "fleet" not in old:
                obtained = int(old.get("obtained_at", 0))
                expires_in = int(old.get("expires_in", 28800))
                tokens["fleet"] = {
                    "access_token": old["access_token"],
                    "refresh_token": old.get("refresh_token", ""),
                    "token_type": old.get("token_type", "Bearer"),
                    "expires_at": float(obtained + expires_in),
                }
                log.info("Migrated Fleet API tokens to unified format.")
        except Exception:
            pass

    # Migrate old Ownership API tokens from cache.json
    cache_file = AUTH_DIR / "cache.json"
    if cache_file.exists() and TESLA_EMAIL:
        try:
            cache = json.loads(cache_file.read_text())
            tok = cache.get(TESLA_EMAIL, {})
            if tok and "access_token" in tok:
                tokens["ownership"] = {
                    "access_token": tok["access_token"],
                    "refresh_token": tok.get("refresh_token", ""),
                    "token_type": tok.get("token_type", "Bearer"),
                    "expires_at": float(tok.get("expires_at", 0)),
                }
                log.info("Migrated Ownership API tokens to unified format.")
        except Exception:
            pass

    if tokens:
        save_tokens(tokens)
        log.info("Token migration complete. Old cache.json can be removed.")
    return tokens


# ---------------------------------------------------------------------------
# Token refresh
# ---------------------------------------------------------------------------
def refresh_fleet_token() -> dict:
    """Refresh the Fleet API access token. Returns the updated fleet token dict."""
    tokens = load_tokens()
    fleet = tokens.get("fleet", {})
    refresh_token = fleet.get("refresh_token")
    if not refresh_token:
        raise RuntimeError("No Fleet API refresh token. Re-authorize via the web UI.")

    log.info("Refreshing Fleet API access token...")
    resp = requests.post(
        f"{AUTH_BASE}/token",
        json={
            "grant_type": "refresh_token",
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "refresh_token": refresh_token,
        },
        headers={"Content-Type": "application/json"},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    expires_in = int(data.get("expires_in", 28800))

    fleet = {
        "access_token": data["access_token"],
        "refresh_token": data.get("refresh_token", refresh_token),
        "token_type": data.get("token_type", "Bearer"),
        "expires_at": time.time() + expires_in,
    }
    tokens["fleet"] = fleet
    save_tokens(tokens)
    log.info("Fleet API access token refreshed.")
    return fleet


def refresh_ownership_token() -> dict:
    """Refresh the Ownership API access token. Returns the updated ownership token dict."""
    tokens = load_tokens()
    ownership = tokens.get("ownership", {})
    refresh_token = ownership.get("refresh_token")
    if not refresh_token:
        raise RuntimeError("No Ownership API refresh token. Re-authorize via the web UI.")

    log.info("Refreshing Ownership API access token...")
    resp = requests.post(
        f"{AUTH_BASE}/token",
        json={
            "grant_type": "refresh_token",
            "client_id": "ownerapi",
            "refresh_token": refresh_token,
        },
        headers={"Content-Type": "application/json"},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    expires_in = int(data.get("expires_in", 28800))

    ownership = {
        "access_token": data["access_token"],
        "refresh_token": data.get("refresh_token", refresh_token),
        "token_type": data.get("token_type", "Bearer"),
        "expires_at": time.time() + expires_in,
    }
    tokens["ownership"] = ownership
    save_tokens(tokens)
    log.info("Ownership API access token refreshed.")
    return ownership


def get_valid_access_token() -> str:
    """Get a valid Fleet API access token, refreshing if within 5 min of expiry."""
    tokens = load_tokens()
    fleet = tokens.get("fleet", {})
    if not fleet.get("access_token"):
        raise RuntimeError("Fleet API not authorized. Use the web UI to authorize.")
    if float(fleet.get("expires_at", 0)) - 300 < time.time():
        fleet = refresh_fleet_token()
    return fleet["access_token"]


def get_owner_access_token() -> str:
    """Get a valid Ownership API access token, refreshing if within 5 min of expiry."""
    tokens = load_tokens()
    ownership = tokens.get("ownership", {})
    if not ownership.get("access_token"):
        raise RuntimeError(
            "Ownership API not authorized. Use the Authorization panel in the web UI."
        )
    if float(ownership.get("expires_at", 0)) - 300 < time.time():
        ownership = refresh_ownership_token()
    return ownership["access_token"]


def api_headers(access_token: str) -> dict:
    return {"Authorization": f"Bearer {access_token}"}


# ---------------------------------------------------------------------------
# Tracking – remember which invoices were already downloaded
# ---------------------------------------------------------------------------
def load_tracking() -> set:
    if TRACKING_FILE.exists():
        return set(json.loads(TRACKING_FILE.read_text()))
    return set()


def save_tracking(ids: set) -> None:
    TRACKING_FILE.write_text(json.dumps(sorted(ids), indent=2))


# ---------------------------------------------------------------------------
# Charging (Supercharger) invoices
# ---------------------------------------------------------------------------
def fetch_charging_history(access_token: str, vin: str) -> list[dict]:
    """Fetch Supercharger charging history via Fleet API."""
    resp = requests.get(
        f"{FLEET_BASE}/api/1/dx/charging/history",
        headers=api_headers(access_token),
        params={"vin": vin},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    return data.get("data", [])


def download_invoice(access_token: str, content_id: str) -> tuple[bytes | None, str | None]:
    """Download an invoice PDF by contentId. Returns (pdf_bytes, filename)."""
    resp = requests.get(
        f"{FLEET_BASE}/api/1/dx/charging/invoice/{content_id}",
        headers=api_headers(access_token),
        timeout=30,
    )
    if resp.status_code == 200 and len(resp.content) > 0:
        # Extract filename from Content-Disposition header if available
        cd = resp.headers.get("Content-Disposition", "")
        filename = None
        if "filename=" in cd:
            filename = cd.split("filename=")[1].split(";")[0].strip().strip('"')
        return resp.content, filename
    log.warning("Failed to download invoice %s (HTTP %d)", content_id, resp.status_code)
    return None, None


# ---------------------------------------------------------------------------
# File storage
# ---------------------------------------------------------------------------
def save_invoice(pdf_bytes: bytes, category: str, filename: str | None, content_id: str, date_str: str) -> Path:
    """Save an invoice PDF to the output directory."""
    folder = OUTPUT_DIR / category
    folder.mkdir(parents=True, exist_ok=True)

    # Parse date to YYYY-MM-DD
    try:
        date_obj = datetime.fromisoformat(date_str)
        date_formatted = date_obj.strftime("%Y-%m-%d")
    except (ValueError, TypeError):
        date_formatted = date_str.replace("/", "-").replace(":", "-")

    # Original name without .pdf extension
    if filename:
        original_name = filename.removesuffix(".pdf").removesuffix(".PDF")
    else:
        original_name = content_id

    # Label based on category
    label = "Premium Connectivity" if category == "premium_connectivity" else "Superchargen"

    stem = INVOICE_NAME_PATTERN.format(date=date_formatted, label=label, name=original_name, id=content_id)
    filepath = folder / f"{stem}.pdf"
    filepath.write_bytes(pdf_bytes)
    log.info("Saved: %s", filepath)
    return filepath


# ---------------------------------------------------------------------------
# Email
# ---------------------------------------------------------------------------
def send_email(subject: str, body: str, attachments: list[Path]) -> None:
    if not all([SMTP_HOST, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM, EMAIL_TO]):
        log.info("Email not configured – skipping.")
        return

    msg = MIMEMultipart()
    msg["From"] = EMAIL_FROM
    msg["To"] = EMAIL_TO
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain"))

    for filepath in attachments:
        part = MIMEBase("application", "pdf")
        part.set_payload(filepath.read_bytes())
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", f"attachment; filename={filepath.name}")
        msg.attach(part)

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.sendmail(EMAIL_FROM, EMAIL_TO.split(","), msg.as_string())

    log.info("Email sent to %s with %d attachment(s)", EMAIL_TO, len(attachments))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def run_fetcher() -> list[Path]:
    """Run the invoice fetcher. Returns list of newly downloaded files."""
    log.info("=== Tesla Invoice Fetcher started ===")

    if not CLIENT_ID:
        raise RuntimeError("TESLA_CLIENT_ID not set. Check your .env file.")

    if not TESLA_VINS:
        raise RuntimeError("TESLA_VINS not set. Add your VIN(s) to .env file.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    downloaded = load_tracking()
    new_files: list[Path] = []

    # --- Supercharger invoices (Fleet API) ---
    access_token = get_valid_access_token()
    log.info("Processing %d VIN(s)", len(TESLA_VINS))

    for vin in TESLA_VINS:
        log.info("Fetching charging history for VIN %s ...", vin)

        try:
            history = fetch_charging_history(access_token, vin)
        except requests.HTTPError as e:
            # Retry once on 401 (token may have been invalidated server-side)
            if e.response is not None and e.response.status_code == 401:
                log.info("Fleet API returned 401, refreshing token and retrying...")
                try:
                    fleet = refresh_fleet_token()
                    access_token = fleet["access_token"]
                    history = fetch_charging_history(access_token, vin)
                except Exception as retry_err:
                    log.error("Failed after token refresh for %s: %s", vin, retry_err)
                    continue
            else:
                log.error("Failed to fetch charging history for %s: %s", vin, e)
                continue

        log.info("Found %d charging session(s)", len(history))

        for session in history:
            invoices = session.get("invoices", [])
            if not invoices:
                continue

            date_str = session.get("chargeStartDateTime", "unknown")
            location = session.get("siteLocationName", "unknown")

            for inv in invoices:
                content_id = inv.get("contentId")
                if not content_id or content_id in downloaded:
                    continue

                log.info("Downloading invoice %s (%s, %s)",
                         inv.get("fileName", content_id), date_str, location)

                pdf, filename = download_invoice(access_token, content_id)
                if pdf:
                    path = save_invoice(pdf, "supercharger", filename, content_id, date_str)
                    new_files.append(path)
                    downloaded.add(content_id)

    # --- Premium Connectivity invoices (Ownership API) ---
    if TESLA_EMAIL:
        log.info("Fetching Premium Connectivity invoices ...")
        try:
            owner_token = get_owner_access_token()
            owner_headers = {"Authorization": f"Bearer {owner_token}"}

            for vin in TESLA_VINS:
                # Fetch subscription invoice list
                resp = requests.get(
                    f"{OWNERSHIP_BASE}/mobile-app/subscriptions/invoices",
                    headers=owner_headers,
                    params={
                        "deviceLanguage": "en",
                        "deviceCountry": "NL",
                        "httpLocale": "en_US",
                        "vin": vin,
                        "optionCode": "$CPF1",
                    },
                    timeout=30,
                )

                # Retry once on 401
                if resp.status_code == 401:
                    log.info("Ownership API returned 401, refreshing token and retrying...")
                    try:
                        ownership = refresh_ownership_token()
                        owner_token = ownership["access_token"]
                        owner_headers = {"Authorization": f"Bearer {owner_token}"}
                        resp = requests.get(
                            f"{OWNERSHIP_BASE}/mobile-app/subscriptions/invoices",
                            headers=owner_headers,
                            params={
                                "deviceLanguage": "en",
                                "deviceCountry": "NL",
                                "httpLocale": "en_US",
                                "vin": vin,
                                "optionCode": "$CPF1",
                            },
                            timeout=30,
                        )
                    except Exception as retry_err:
                        log.error("Failed after Ownership token refresh for %s: %s", vin, retry_err)
                        continue

                if resp.status_code != 200:
                    log.warning("Subscription invoices returned HTTP %d for VIN %s", resp.status_code, vin)
                    continue

                sub_invoices = resp.json()
                if isinstance(sub_invoices, dict):
                    sub_invoices = sub_invoices.get("data", sub_invoices.get("invoices", []))
                if not isinstance(sub_invoices, list):
                    sub_invoices = [sub_invoices]

                log.info("Found %d subscription invoice(s) for VIN %s", len(sub_invoices), vin)

                for inv in sub_invoices:
                    invoice_id = inv.get("InvoiceId") or inv.get("invoiceId")
                    if not invoice_id or str(invoice_id) in downloaded:
                        continue

                    date_str = inv.get("InvoiceDate") or inv.get("invoiceDate") or "unknown"
                    invoice_filename = inv.get("InvoiceFileName") or inv.get("invoiceFileName")
                    log.info("Downloading subscription invoice %s (%s)", invoice_id, date_str)

                    # Download the PDF using the InvoiceId
                    dl_resp = requests.get(
                        f"{OWNERSHIP_BASE}/mobile-app/documents/invoices/{invoice_id}",
                        headers=owner_headers,
                        params={
                            "deviceLanguage": "en",
                            "deviceCountry": "NL",
                            "httpLocale": "en_US",
                            "vin": vin,
                        },
                        timeout=30,
                    )
                    if dl_resp.status_code == 200 and len(dl_resp.content) > 0:
                        cd = dl_resp.headers.get("Content-Disposition", "")
                        filename = None
                        if "filename=" in cd:
                            filename = cd.split("filename=")[1].split(";")[0].strip().strip('"')
                        path = save_invoice(dl_resp.content, "premium_connectivity", filename, str(invoice_id), date_str)
                        new_files.append(path)
                        downloaded.add(str(invoice_id))
                    else:
                        log.warning("Failed to download subscription invoice %s (HTTP %d)", invoice_id, dl_resp.status_code)

        except Exception as e:
            log.error("Failed to fetch Premium Connectivity invoices: %s", e)
    else:
        log.info("TESLA_EMAIL not set – skipping Premium Connectivity invoices")

    # Save tracking state
    save_tracking(downloaded)

    # Send email if there are new invoices
    if new_files:
        log.info("Downloaded %d new invoice(s)", len(new_files))
        today = datetime.now().strftime("%Y-%m-%d")
        send_email(
            subject=f"Tesla Invoices - {today}",
            body=f"{len(new_files)} new Tesla invoice(s) downloaded on {today}.\n\n"
                 + "\n".join(f"  - {f.name}" for f in new_files),
            attachments=new_files,
        )
    else:
        log.info("No new invoices found.")

    log.info("=== Done ===")
    return new_files


def main() -> None:
    try:
        run_fetcher()
    except RuntimeError as e:
        log.error(str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
