"""
Tesla Invoice Fetcher – Web Interface
Flask app to run the fetcher on demand, view downloaded invoices, and
handle OAuth re-authorization for both Fleet API and Ownership API.
"""

import base64
import hashlib
import json
import logging
import os
import re
import secrets
import threading
import time
import urllib.parse
from datetime import datetime
from pathlib import Path

import requests
from flask import Flask, jsonify, redirect, render_template, request, send_from_directory, session
from dotenv import load_dotenv

# Load config from AUTH_DIR if set (Docker volume), otherwise fall back to local .env
load_dotenv(Path(os.environ.get("AUTH_DIR", ".")) / ".env")

from tesla_invoice_fetcher import (
    run_fetcher, OUTPUT_DIR, load_tracking, AUTH_DIR, TOKEN_FILE,
    load_tokens, save_tokens, refresh_fleet_token, refresh_ownership_token,
)

APP_VERSION = "0.0.2"

# Keys that the web UI is allowed to edit
_EDITABLE_KEYS = {
    "TESLA_REGION", "TESLA_CLIENT_ID", "TESLA_CLIENT_SECRET",
    "TESLA_EMAIL", "TESLA_VINS", "TESLA_REDIRECT_URI",
    "INVOICE_NAME_PATTERN",
    "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD",
    "EMAIL_FROM", "EMAIL_TO",
    "OIDC_ENABLED", "OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET",
    "OIDC_REDIRECT_URI",
}
# These keys are write-only: submitting blank means "keep current value"
_PASSWORD_KEYS = {"TESLA_CLIENT_SECRET", "SMTP_PASSWORD", "OIDC_CLIENT_SECRET"}


def _update_env_file(updates: dict) -> None:
    """Update or insert key=value pairs in the AUTH_DIR/.env file."""
    env_file = AUTH_DIR / ".env"
    lines: list[str] = env_file.read_text(encoding="utf-8").splitlines() if env_file.exists() else []
    seen: set[str] = set()
    new_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            new_lines.append(line)
            continue
        if "=" in stripped:
            key = stripped.split("=", 1)[0].strip()
            if key in updates:
                seen.add(key)
                if updates[key]:
                    new_lines.append(f"{key}={updates[key]}")
                # empty → remove the key from file
                continue
        new_lines.append(line)
    for key, val in updates.items():
        if key not in seen and val:
            new_lines.append(f"{key}={val}")
    env_file.parent.mkdir(parents=True, exist_ok=True)
    env_file.write_text("\n".join(new_lines) + "\n", encoding="utf-8")

app = Flask(__name__)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
# Flask session secret — set SECRET_KEY in .env for persistence across restarts
app.secret_key = os.getenv("SECRET_KEY") or secrets.token_hex(32)

# Auth configuration (used by the in-app OAuth flows)
_CLIENT_ID = os.getenv("TESLA_CLIENT_ID", "")
_CLIENT_SECRET = os.getenv("TESLA_CLIENT_SECRET", "")
_TESLA_EMAIL = os.getenv("TESLA_EMAIL", "")
_AUTH_BASE = "https://auth.tesla.com/oauth2/v3"
_SCOPES = "openid offline_access user_data vehicle_charging_cmds energy_cmds"


# ---------------------------------------------------------------------------
# Log capture for the web UI
# ---------------------------------------------------------------------------
class LogCapture(logging.Handler):
    def __init__(self):
        super().__init__()
        self.logs: list[str] = []

    def emit(self, record):
        self.logs.append(self.format(record))

    def get_and_clear(self) -> list[str]:
        logs = self.logs.copy()
        self.logs.clear()
        return logs


log_capture = LogCapture()
log_capture.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
logging.getLogger().addHandler(log_capture)


# ---------------------------------------------------------------------------
# Invoice fetcher run state
# ---------------------------------------------------------------------------
run_state = {
    "running": False,
    "last_run": None,
    "last_result": None,
    "last_logs": [],
}
run_lock = threading.Lock()


def execute_fetcher():
    try:
        new_files = run_fetcher()
        run_state["last_result"] = {
            "success": True,
            "new_invoices": len(new_files),
            "files": [f.name for f in new_files],
        }
    except Exception as e:
        run_state["last_result"] = {"success": False, "error": str(e)}
    finally:
        run_state["running"] = False
        run_state["last_run"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        run_state["last_logs"] = log_capture.get_and_clear()


# ---------------------------------------------------------------------------
# PKCE helpers (shared by both auth flows)
# ---------------------------------------------------------------------------
_fleet_pending: dict = {}
_fleet_lock = threading.Lock()

_ownership_pending: dict = {}
_ownership_lock = threading.Lock()


def _make_pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)[:128]
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return verifier, challenge


# ---------------------------------------------------------------------------
# OIDC helpers (built-in login via Authentik or any OIDC provider)
# ---------------------------------------------------------------------------
_oidc_pending: dict = {}
_oidc_lock = threading.Lock()
_oidc_discovery_cache: dict = {}


def _oidc_enabled() -> bool:
    return os.getenv("OIDC_ENABLED", "").lower() in ("1", "true", "yes")


def _get_oidc_discovery() -> "dict | None":
    issuer = os.getenv("OIDC_ISSUER", "").rstrip("/")
    if not issuer:
        return None
    with _oidc_lock:
        if _oidc_discovery_cache.get("issuer") == issuer:
            return _oidc_discovery_cache.get("doc")
        try:
            resp = requests.get(
                f"{issuer}/.well-known/openid-configuration", timeout=10
            )
            resp.raise_for_status()
            doc = resp.json()
            _oidc_discovery_cache["issuer"] = issuer
            _oidc_discovery_cache["doc"] = doc
            return doc
        except Exception:
            return None


def _get_oidc_redirect_uri() -> str:
    env_uri = os.getenv("OIDC_REDIRECT_URI", "").strip()
    if env_uri:
        return env_uri
    return request.host_url.rstrip("/") + "/auth/oidc/callback"


# ---------------------------------------------------------------------------
# Fleet API auth helpers
# ---------------------------------------------------------------------------
def _get_fleet_redirect_uri() -> str:
    """Return the Fleet API redirect URI.

    Uses TESLA_REDIRECT_URI from env if set, otherwise auto-detects from
    the current request to point at this Flask app's own callback endpoint.
    """
    env_uri = os.getenv("TESLA_REDIRECT_URI", "").strip()
    if env_uri:
        return env_uri
    # Auto-detect from request context
    return request.host_url.rstrip("/") + "/auth/fleet/callback"


def _fleet_build_auth_url(state: str, challenge: str, redirect_uri: str) -> str:
    params = {
        "response_type": "code",
        "client_id": _CLIENT_ID,
        "redirect_uri": redirect_uri,
        "scope": _SCOPES,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    return f"{_AUTH_BASE}/authorize?{urllib.parse.urlencode(params)}"


def _fleet_exchange_code(code: str, verifier: str, redirect_uri: str) -> dict:
    resp = requests.post(
        f"{_AUTH_BASE}/token",
        json={
            "grant_type": "authorization_code",
            "client_id": _CLIENT_ID,
            "client_secret": _CLIENT_SECRET,
            "code": code,
            "redirect_uri": redirect_uri,
            "code_verifier": verifier,
        },
        headers={"Content-Type": "application/json"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def _save_fleet_token(token_data: dict) -> None:
    """Save Fleet API token in unified format."""
    expires_in = int(token_data.get("expires_in", 28800))
    tokens = load_tokens()
    tokens["fleet"] = {
        "access_token": token_data["access_token"],
        "refresh_token": token_data.get("refresh_token", ""),
        "token_type": token_data.get("token_type", "Bearer"),
        "expires_at": time.time() + expires_in,
    }
    save_tokens(tokens)


# ---------------------------------------------------------------------------
# Ownership API auth helpers
# ---------------------------------------------------------------------------
_OWNERSHIP_CLIENT_ID = "ownerapi"
_OWNERSHIP_REDIRECT_URI = "https://auth.tesla.com/void/callback"
_OWNERSHIP_SCOPES = "openid email offline_access"


def _ownership_build_auth_url(state: str, challenge: str) -> str:
    params = {
        "response_type": "code",
        "client_id": _OWNERSHIP_CLIENT_ID,
        "redirect_uri": _OWNERSHIP_REDIRECT_URI,
        "scope": _OWNERSHIP_SCOPES,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    return f"{_AUTH_BASE}/authorize?{urllib.parse.urlencode(params)}"


def _ownership_exchange_code(code: str, verifier: str) -> dict:
    resp = requests.post(
        f"{_AUTH_BASE}/token",
        json={
            "grant_type": "authorization_code",
            "client_id": _OWNERSHIP_CLIENT_ID,
            "code": code,
            "redirect_uri": _OWNERSHIP_REDIRECT_URI,
            "code_verifier": verifier,
        },
        headers={"Content-Type": "application/json"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def _save_ownership_token(token_data: dict) -> None:
    """Save Ownership API token in unified format."""
    expires_in = int(token_data.get("expires_in", 28800))
    tokens = load_tokens()
    tokens["ownership"] = {
        "access_token": token_data["access_token"],
        "refresh_token": token_data.get("refresh_token", ""),
        "token_type": token_data.get("token_type", "Bearer"),
        "expires_at": time.time() + expires_in,
    }
    save_tokens(tokens)


# ---------------------------------------------------------------------------
# OIDC login guard
# ---------------------------------------------------------------------------
@app.before_request
def _require_oidc_login():
    if not _oidc_enabled():
        return
    public = {"/login", "/auth/oidc/callback", "/logout"}
    if request.path in public:
        return
    if not session.get("oidc_user"):
        return redirect(f"/login?next={urllib.parse.quote(request.url, safe='')}")


# ---------------------------------------------------------------------------
# Routes: OIDC login / logout
# ---------------------------------------------------------------------------
@app.route("/login")
def oidc_login():
    if not _oidc_enabled():
        return redirect("/")
    doc = _get_oidc_discovery()
    if not doc:
        return render_template(
            "login.html",
            title="OIDC not configured",
            message="Set OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET in your .env file.",
        ), 503
    verifier, challenge = _make_pkce()
    state = secrets.token_urlsafe(32)
    redirect_uri = _get_oidc_redirect_uri()
    with _oidc_lock:
        _oidc_pending["verifier"] = verifier
        _oidc_pending["state"] = state
    params = {
        "response_type": "code",
        "client_id": os.getenv("OIDC_CLIENT_ID", ""),
        "redirect_uri": redirect_uri,
        "scope": "openid email profile",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    return redirect(doc["authorization_endpoint"] + "?" + urllib.parse.urlencode(params))


@app.route("/auth/oidc/callback")
def oidc_callback():
    error = request.args.get("error")
    if error:
        return render_template(
            "login.html",
            title=f"Login error: {error}",
            message=request.args.get("error_description", ""),
        ), 400
    code = request.args.get("code")
    state = request.args.get("state")
    with _oidc_lock:
        expected = _oidc_pending.get("state")
        verifier = _oidc_pending.get("verifier")
    if not expected or state != expected:
        return render_template(
            "login.html",
            title="State mismatch",
            message="Please try logging in again.",
        ), 400
    doc = _get_oidc_discovery()
    if not doc:
        return render_template("login.html", title="OIDC unavailable", message=""), 503
    try:
        resp = requests.post(
            doc["token_endpoint"],
            data={
                "grant_type": "authorization_code",
                "client_id": os.getenv("OIDC_CLIENT_ID", ""),
                "client_secret": os.getenv("OIDC_CLIENT_SECRET", ""),
                "code": code,
                "redirect_uri": _get_oidc_redirect_uri(),
                "code_verifier": verifier,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=30,
        )
        resp.raise_for_status()
        tokens = resp.json()
    except Exception as e:
        return render_template(
            "login.html", title="Token exchange failed", message=str(e)
        ), 500
    try:
        user_resp = requests.get(
            doc["userinfo_endpoint"],
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
            timeout=10,
        )
        user_resp.raise_for_status()
        user_info = user_resp.json()
    except Exception as e:
        return render_template(
            "login.html", title="Could not fetch user info", message=str(e)
        ), 500
    with _oidc_lock:
        _oidc_pending.clear()
    session["oidc_user"] = {
        "sub": user_info.get("sub", ""),
        "email": user_info.get("email", ""),
        "name": user_info.get("name") or user_info.get("preferred_username", ""),
    }
    next_url = request.args.get("next") or "/"
    # Basic open-redirect protection
    parsed = urllib.parse.urlparse(next_url)
    if parsed.netloc and parsed.netloc != request.host:
        next_url = "/"
    return redirect(next_url)


@app.route("/logout", methods=["GET", "POST"])
def oidc_logout():
    session.pop("oidc_user", None)
    doc = _get_oidc_discovery()
    if doc and doc.get("end_session_endpoint"):
        params = {"post_logout_redirect_uri": request.host_url.rstrip("/")}
        return redirect(
            doc["end_session_endpoint"] + "?" + urllib.parse.urlencode(params)
        )
    return redirect("/login" if _oidc_enabled() else "/")


@app.route("/api/me")
def api_me():
    return jsonify({
        "oidc_enabled": _oidc_enabled(),
        "user": session.get("oidc_user"),
    })


# ---------------------------------------------------------------------------
# Routes: main
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html", version=APP_VERSION)


@app.route("/config")
def config_page():
    return render_template("config.html", version=APP_VERSION)


@app.route("/api/run", methods=["POST"])
def api_run():
    with run_lock:
        if run_state["running"]:
            return jsonify({"status": "already_running"}), 409
        run_state["running"] = True
        log_capture.get_and_clear()
    threading.Thread(target=execute_fetcher, daemon=True).start()
    return jsonify({"status": "started"})


@app.route("/api/status")
def api_status():
    return jsonify({
        "running": run_state["running"],
        "last_run": run_state["last_run"],
        "last_result": run_state["last_result"],
        "last_logs": run_state["last_logs"],
    })


@app.route("/api/invoices")
def api_invoices():
    invoices = []
    if not OUTPUT_DIR.exists():
        return jsonify(invoices)
    for category_dir in sorted(OUTPUT_DIR.iterdir()):
        if not category_dir.is_dir():
            continue
        category = category_dir.name
        for pdf in sorted(category_dir.glob("*.pdf"), reverse=True):
            invoices.append({
                "name": pdf.name,
                "category": category,
                "size": pdf.stat().st_size,
                "modified": datetime.fromtimestamp(pdf.stat().st_mtime).strftime("%Y-%m-%d %H:%M"),
                "path": f"{category}/{pdf.name}",
            })
    return jsonify(invoices)


@app.route("/invoices/<path:filepath>")
def serve_invoice(filepath):
    return send_from_directory(OUTPUT_DIR, filepath)


# ---------------------------------------------------------------------------
# Routes: combined auth status
# ---------------------------------------------------------------------------
@app.route("/api/auth")
def api_auth():
    tokens = load_tokens()

    # Fleet API token status
    fleet_tok = tokens.get("fleet", {})
    fleet = {
        "valid": False,
        "expires": None,
        "has_token": bool(fleet_tok.get("access_token")),
    }
    if fleet["has_token"]:
        expires_at = float(fleet_tok.get("expires_at", 0))
        fleet["expires"] = datetime.fromtimestamp(expires_at).strftime("%Y-%m-%d %H:%M")
        fleet["valid"] = expires_at - 300 > time.time()

    # Ownership API token status
    own_tok = tokens.get("ownership", {})
    ownership = {
        "valid": False,
        "has_cache": bool(own_tok.get("access_token")),
        "configured": bool(_TESLA_EMAIL),
    }
    if ownership["has_cache"]:
        expires_at = float(own_tok.get("expires_at", 0))
        ownership["valid"] = expires_at - 300 > time.time()

    return jsonify({"fleet": fleet, "ownership": ownership})


@app.route("/api/auth/refresh", methods=["POST"])
def api_auth_refresh():
    """Proactively refresh expired tokens using stored refresh tokens."""
    results = {"fleet": None, "ownership": None}
    tokens = load_tokens()

    # Try refreshing Fleet token if expired
    fleet_tok = tokens.get("fleet", {})
    if fleet_tok.get("refresh_token") and float(fleet_tok.get("expires_at", 0)) - 300 < time.time():
        try:
            refresh_fleet_token()
            results["fleet"] = "refreshed"
        except Exception as e:
            results["fleet"] = f"failed: {e}"

    # Try refreshing Ownership token if expired
    own_tok = tokens.get("ownership", {})
    if own_tok.get("refresh_token") and float(own_tok.get("expires_at", 0)) - 300 < time.time():
        try:
            refresh_ownership_token()
            results["ownership"] = "refreshed"
        except Exception as e:
            results["ownership"] = f"failed: {e}"

    return jsonify(results)


# ---------------------------------------------------------------------------
# Routes: Fleet API re-auth (PKCE OAuth2 with auto-redirect callback)
# ---------------------------------------------------------------------------
@app.route("/auth/fleet/start", methods=["POST"])
def fleet_auth_start():
    verifier, challenge = _make_pkce()
    state = secrets.token_urlsafe(32)
    redirect_uri = _get_fleet_redirect_uri()
    with _fleet_lock:
        _fleet_pending["verifier"] = verifier
        _fleet_pending["state"] = state
        _fleet_pending["redirect_uri"] = redirect_uri
    # Auto-redirect only works when the redirect URI actually points to this
    # Flask app (same host:port as the current request). Otherwise the browser
    # would land on a dead endpoint after Tesla login, so we show the paste flow.
    auto_redirect = False
    if redirect_uri.rstrip("/").endswith("/auth/fleet/callback"):
        parsed = urllib.parse.urlparse(redirect_uri)
        auto_redirect = parsed.netloc == request.host
    return jsonify({
        "auth_url": _fleet_build_auth_url(state, challenge, redirect_uri),
        "auto_redirect": auto_redirect,
    })


@app.route("/auth/fleet/callback")
def fleet_auth_callback():
    error = request.args.get("error")
    if error:
        return (
            f"<h3>Authorization failed: {error}</h3>"
            f"<p>{request.args.get('error_description', '')}</p>"
            f"<a href='/'>Back to dashboard</a>",
            400,
        )

    code = request.args.get("code")
    state = request.args.get("state")

    with _fleet_lock:
        expected = _fleet_pending.get("state")
        verifier = _fleet_pending.get("verifier")
        redirect_uri = _fleet_pending.get("redirect_uri", _get_fleet_redirect_uri())

    if not expected or state != expected:
        return "<h3>Error: state mismatch (possible CSRF)</h3><a href='/'>Back</a>", 400

    try:
        token_data = _fleet_exchange_code(code, verifier, redirect_uri)
        _save_fleet_token(token_data)
        with _fleet_lock:
            _fleet_pending.clear()
    except Exception as e:
        return f"<h3>Token exchange failed: {e}</h3><a href='/'>Back</a>", 500

    return redirect("/?auth=fleet_ok")


@app.route("/auth/fleet/submit", methods=["POST"])
def fleet_auth_submit():
    """Accept the full redirect URL pasted by the user (fallback for non-auto-redirect setups)."""
    callback_url = (request.json or {}).get("callback_url", "").strip()
    if not callback_url:
        return jsonify({"error": "callback_url is required"}), 400

    try:
        params = urllib.parse.parse_qs(urllib.parse.urlparse(callback_url).query)
        code = params.get("code", [None])[0]
        state = params.get("state", [None])[0]
    except Exception as e:
        return jsonify({"error": f"Could not parse URL: {e}"}), 400

    if not code:
        return jsonify({"error": "No authorization code found in the URL"}), 400

    with _fleet_lock:
        expected_state = _fleet_pending.get("state")
        verifier = _fleet_pending.get("verifier")
        redirect_uri = _fleet_pending.get("redirect_uri", _get_fleet_redirect_uri())

    if not expected_state or state != expected_state:
        return jsonify({"error": "State mismatch — start a new authorization"}), 400

    try:
        token_data = _fleet_exchange_code(code, verifier, redirect_uri)
        _save_fleet_token(token_data)
        with _fleet_lock:
            _fleet_pending.clear()
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# Routes: Ownership API re-auth
# ---------------------------------------------------------------------------
@app.route("/auth/ownership/start", methods=["POST"])
def ownership_auth_start():
    if not _TESLA_EMAIL:
        return jsonify({"error": "TESLA_EMAIL not configured in .env"}), 400
    verifier, challenge = _make_pkce()
    state = secrets.token_urlsafe(32)
    with _ownership_lock:
        _ownership_pending["verifier"] = verifier
        _ownership_pending["state"] = state
    return jsonify({"auth_url": _ownership_build_auth_url(state, challenge)})


@app.route("/auth/ownership/submit", methods=["POST"])
def ownership_auth_submit():
    callback_url = (request.json or {}).get("callback_url", "").strip()
    if not callback_url:
        return jsonify({"error": "callback_url is required"}), 400

    try:
        params = urllib.parse.parse_qs(urllib.parse.urlparse(callback_url).query)
        code = params.get("code", [None])[0]
        state = params.get("state", [None])[0]
    except Exception as e:
        return jsonify({"error": f"Could not parse URL: {e}"}), 400

    if not code:
        return jsonify({"error": "No authorization code found in the URL"}), 400

    with _ownership_lock:
        expected_state = _ownership_pending.get("state")
        verifier = _ownership_pending.get("verifier")

    if not expected_state or state != expected_state:
        return jsonify({"error": "State mismatch — start a new authorization"}), 400

    try:
        token_data = _ownership_exchange_code(code, verifier)
        _save_ownership_token(token_data)
        with _ownership_lock:
            _ownership_pending.clear()
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# Routes: config / app info
# ---------------------------------------------------------------------------
@app.route("/api/config")
def api_config():
    def mask_email(e: str) -> str:
        if not e:
            return ""
        if "@" not in e:
            return e[:2] + "***"
        local, domain = e.split("@", 1)
        return local[:2] + "***@" + domain

    def mask_vin(v: str) -> str:
        return (v[:5] + "***" + v[-4:]) if len(v) >= 9 else "***"

    vins = [v.strip() for v in os.getenv("TESLA_VINS", "").split(",") if v.strip()]
    smtp_ok = bool(os.getenv("SMTP_HOST") and os.getenv("SMTP_USER") and os.getenv("SMTP_PASSWORD"))

    return jsonify({
        "version": APP_VERSION,
        "tesla_region": os.getenv("TESLA_REGION", "eu"),
        "vins": [mask_vin(v) for v in vins],
        "vin_count": len(vins),
        "client_id_configured": bool(_CLIENT_ID),
        "client_secret_configured": bool(_CLIENT_SECRET),
        "redirect_uri": os.getenv("TESLA_REDIRECT_URI", "") or "(auto-detect from request)",
        "email_configured": bool(_TESLA_EMAIL),
        "email_masked": mask_email(_TESLA_EMAIL),
        "invoice_output_dir": str(OUTPUT_DIR),
        "invoice_name_pattern": os.getenv("INVOICE_NAME_PATTERN", "{date} - Tesla - {label} {name}"),
        "auth_dir": str(AUTH_DIR),
        "smtp_configured": smtp_ok,
        "smtp_password_configured": bool(os.getenv("SMTP_PASSWORD")),
        "smtp_host": os.getenv("SMTP_HOST") or None,
        "email_from_masked": mask_email(os.getenv("EMAIL_FROM", "")),
        "email_to_masked": mask_email(os.getenv("EMAIL_TO", "")),
        "oidc_enabled": _oidc_enabled(),
        "oidc_issuer_configured": bool(os.getenv("OIDC_ISSUER")),
        "oidc_client_id_configured": bool(os.getenv("OIDC_CLIENT_ID")),
        "oidc_secret_configured": bool(os.getenv("OIDC_CLIENT_SECRET")),
        # Raw values for pre-filling edit forms (passwords intentionally excluded)
        "edit_values": {
            "TESLA_REGION": os.getenv("TESLA_REGION", "eu"),
            "TESLA_CLIENT_ID": _CLIENT_ID,
            "TESLA_EMAIL": _TESLA_EMAIL,
            "TESLA_VINS": os.getenv("TESLA_VINS", ""),
            "TESLA_REDIRECT_URI": os.getenv("TESLA_REDIRECT_URI", ""),
            "INVOICE_NAME_PATTERN": os.getenv("INVOICE_NAME_PATTERN", "{date} - Tesla - {label} {name}"),
            "SMTP_HOST": os.getenv("SMTP_HOST", ""),
            "SMTP_PORT": os.getenv("SMTP_PORT", "587"),
            "SMTP_USER": os.getenv("SMTP_USER", ""),
            "EMAIL_FROM": os.getenv("EMAIL_FROM", ""),
            "EMAIL_TO": os.getenv("EMAIL_TO", ""),
            "OIDC_ENABLED": os.getenv("OIDC_ENABLED", ""),
            "OIDC_ISSUER": os.getenv("OIDC_ISSUER", ""),
            "OIDC_CLIENT_ID": os.getenv("OIDC_CLIENT_ID", ""),
            "OIDC_REDIRECT_URI": os.getenv("OIDC_REDIRECT_URI", ""),
        },
    })


# ---------------------------------------------------------------------------
# Invoice rename helpers
# ---------------------------------------------------------------------------
_KNOWN_LABELS = ["Premium Connectivity", "Superchargen"]


def _pattern_to_regex(pattern: str) -> "re.Pattern | None":
    """Convert an invoice filename pattern to a regex for reverse-parsing stems."""
    parts = re.split(r"\{(date|label|name|id)\}", pattern)
    placeholder_count = len(parts) // 2
    idx = 0
    rx = "^"
    for i, part in enumerate(parts):
        if i % 2 == 0:
            rx += re.escape(part)
        else:
            name = part
            idx += 1
            is_last = idx == placeholder_count
            if name == "date":
                rx += r"(?P<date>\d{4}-\d{2}-\d{2})"
            elif name == "label":
                opts = "|".join(re.escape(l) for l in sorted(_KNOWN_LABELS, key=len, reverse=True))
                rx += f"(?P<label>{opts})"
            elif is_last:
                rx += f"(?P<{name}>.+)"
            else:
                rx += f"(?P<{name}>.+?)"
    rx += "$"
    try:
        return re.compile(rx)
    except re.error:
        return None


@app.route("/api/invoices/rename", methods=["POST"])
def api_invoices_rename():
    data = request.get_json(force=True) or {}
    old_pattern = (data.get("old_pattern") or "").strip()
    new_pattern = (data.get("new_pattern") or "").strip()
    dry_run = bool(data.get("dry_run", True))

    if not old_pattern or not new_pattern:
        return jsonify({"error": "old_pattern and new_pattern are required"}), 400
    if old_pattern == new_pattern:
        return jsonify({"results": [], "errors": [], "to_rename": 0}), 200

    rx = _pattern_to_regex(old_pattern)
    if not rx:
        return jsonify({"error": "Could not build regex from old pattern"}), 400

    results, errors = [], []
    if OUTPUT_DIR.exists():
        for cat_dir in sorted(OUTPUT_DIR.iterdir()):
            if not cat_dir.is_dir():
                continue
            for pdf in sorted(cat_dir.glob("*.pdf")):
                stem = pdf.stem
                m = rx.match(stem)
                if not m:
                    errors.append({"file": pdf.name, "reason": "filename does not match old pattern"})
                    continue
                try:
                    new_stem = new_pattern.format(**m.groupdict())
                except KeyError as e:
                    errors.append({"file": pdf.name, "reason": f"placeholder {e} not available"})
                    continue
                new_name = f"{new_stem}.pdf"
                results.append({
                    "old": pdf.name,
                    "new": new_name,
                    "category": cat_dir.name,
                    "changed": pdf.name != new_name,
                })
                if not dry_run and pdf.name != new_name:
                    try:
                        pdf.rename(cat_dir / new_name)
                    except Exception as exc:
                        errors.append({"file": pdf.name, "reason": str(exc)})

    to_rename = sum(1 for r in results if r["changed"])
    renamed = to_rename if not dry_run else 0
    return jsonify({"results": results, "errors": errors, "to_rename": to_rename, "renamed": renamed})


@app.route("/api/config", methods=["POST"])
def api_config_save():
    data = request.get_json(force=True) or {}
    bad = [k for k in data if k not in _EDITABLE_KEYS]
    if bad:
        return jsonify({"error": f"Non-editable key(s): {bad}"}), 400

    updates: dict[str, str] = {}
    for key, value in data.items():
        val = str(value).strip() if value is not None else ""
        if not val and key in _PASSWORD_KEYS:
            continue  # blank password = keep current
        updates[key] = val
        if val:
            os.environ[key] = val
        else:
            os.environ.pop(key, None)

    if updates:
        _update_env_file(updates)

    # Refresh in-memory globals that were captured at startup
    global _CLIENT_ID, _CLIENT_SECRET, _TESLA_EMAIL
    _CLIENT_ID = os.getenv("TESLA_CLIENT_ID", "")
    _CLIENT_SECRET = os.getenv("TESLA_CLIENT_SECRET", "")
    _TESLA_EMAIL = os.getenv("TESLA_EMAIL", "")

    # Clear OIDC discovery cache if OIDC settings changed so it re-fetches
    if any(k in updates for k in ("OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_ENABLED")):
        with _oidc_lock:
            _oidc_discovery_cache.clear()

    return jsonify({"updated": list(updates.keys())})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
