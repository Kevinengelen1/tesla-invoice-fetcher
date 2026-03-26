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
import secrets
import threading
import time
import urllib.parse
from datetime import datetime
from pathlib import Path

import requests
from flask import Flask, jsonify, redirect, render_template, request, send_from_directory
from dotenv import load_dotenv

# Load config from AUTH_DIR if set (Docker volume), otherwise fall back to local .env
load_dotenv(Path(os.environ.get("AUTH_DIR", ".")) / ".env")

from tesla_invoice_fetcher import (
    run_fetcher, OUTPUT_DIR, load_tracking, AUTH_DIR, TOKEN_FILE,
    load_tokens, save_tokens, refresh_fleet_token, refresh_ownership_token,
)

app = Flask(__name__)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

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
# Routes: main
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")


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


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
