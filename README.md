# Tesla Invoice Fetcher

Automatically downloads Supercharger and Premium Connectivity invoices from Tesla's APIs. Provides a web dashboard for managing authorization, running the fetcher, and viewing/downloading invoices.

## Features

- **Supercharger invoices** via the Tesla Fleet API (charging history + PDF download)
- **Premium Connectivity invoices** via the Tesla Ownership API (subscription billing)
- **Web dashboard** with authorization management, one-click fetching, and invoice browser
- **Unified token storage** — both API tokens in a single `tokens.json`, with automatic refresh
- **Automatic retry on 401** — transparently refreshes tokens and retries on authentication failures
- **Email notifications** — optionally sends new invoices as email attachments
- **Docker support** for headless / NAS deployment with pre-built images from GHCR
- **Duplicate tracking** — remembers downloaded invoices to avoid re-downloading
- **Built-in OIDC login** — protect the dashboard with Authentik, Keycloak, or any OpenID Connect provider
- **Dark mode** — persisted per-browser via `localStorage`
- **Invoice filtering & sorting** — client-side search and sort across all invoice categories

## Quick Start

### 1. Tesla Developer Setup

1. Create an application at [developer.tesla.com](https://developer.tesla.com)
2. Note the **Client ID** and **Client Secret**
3. Register `http://localhost:5000/auth/fleet/callback` as a redirect URI

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Required | Description |
|---|---|---|
| `TESLA_CLIENT_ID` | Yes | From developer.tesla.com |
| `TESLA_CLIENT_SECRET` | Yes | From developer.tesla.com |
| `TESLA_EMAIL` | For subscriptions | Your Tesla account email |
| `TESLA_VINS` | Yes | Vehicle VIN(s), comma-separated |
| `TESLA_REGION` | Yes | `na`, `eu`, or `cn` |
| `SECRET_KEY` | Recommended | Random string for persistent Flask sessions — generate with `python -c "import secrets; print(secrets.token_hex(32))"`. If omitted, a new key is generated on every restart (all sessions are invalidated). |

### 3. Install & Run

```bash
pip install -r requirements.txt
python app.py
```

Open [http://localhost:5000](http://localhost:5000) and click **Re-authorize** for each API.

### 4. Authorize

**Fleet API** — Click "Re-authorize" and log in at Tesla. If the redirect URI points to this app (local dev), you're automatically redirected back. If running in Docker and accessing from another machine, copy the URL from the error page and paste it in the dashboard.

**Ownership API** — Click "Re-authorize", log in at Tesla, then copy the URL from the blank page and paste it in the dashboard. (Tesla's first-party client redirects to a page we can't control.)

**Both at once** — If both APIs need authorization, click "Authorize Both APIs" to walk through them sequentially.

## CLI Usage

Run the fetcher directly without the web UI:

```bash
python tesla_invoice_fetcher.py
```

Tokens must already exist in `tokens.json` (created via the web UI or a previous run).

## Docker

### Using the pre-built image (recommended)

```yaml
services:
  tesla-invoice-fetcher:
    image: ghcr.io/kevinengelen1/tesla-invoice-fetcher:latest
    container_name: tesla-invoice-fetcher
    ports:
      - "5000:5000"
    volumes:
      - /path/to/config:/app/config    # .env, tokens.json
      - /path/to/invoices:/app/invoices # PDF storage
    environment:
      AUTH_DIR: /app/config
      INVOICE_OUTPUT_DIR: /app/invoices
    restart: unless-stopped
```

### Building from source

```yaml
services:
  tesla-invoice-fetcher:
    build: .
    ports:
      - "5000:5000"
    volumes:
      - /path/to/config:/app/config
      - /path/to/invoices:/app/invoices
    environment:
      AUTH_DIR: /app/config
      INVOICE_OUTPUT_DIR: /app/invoices
    restart: unless-stopped
```

Place your `.env` inside the config volume.

To update when using the pre-built image:

```bash
docker compose pull && docker compose up -d
```

> **Note:** Tesla's OAuth only accepts `localhost` as a redirect host (private IPs like `192.168.x.x` are rejected). Set `TESLA_REDIRECT_URI=http://localhost:8080/callback` (or whichever localhost URI you registered at developer.tesla.com). When accessing the dashboard from another machine on the LAN, the paste flow is used for Fleet API authorization since the `localhost` redirect can't reach the Flask app from the browser.

## OIDC / SSO Login

The dashboard can be protected with any OpenID Connect provider (Authentik, Keycloak, Auth0, etc.). When enabled, all routes require an active session — unauthenticated visitors are redirected to the provider's login page.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `OIDC_ENABLED` | — | Set to `true` to enable OIDC login guard |
| `OIDC_ISSUER` | Yes (if enabled) | Provider issuer URL, e.g. `https://auth.example.com/application/o/tesla-invoice-fetcher/` |
| `OIDC_CLIENT_ID` | Yes (if enabled) | Client ID from the provider |
| `OIDC_CLIENT_SECRET` | Yes (if enabled) | Client secret from the provider |
| `OIDC_REDIRECT_URI` | Recommended | Full callback URL, e.g. `https://tif.example.com/auth/oidc/callback`. If omitted the app auto-detects from the incoming request — set this explicitly when behind a reverse proxy. |
| `SECRET_KEY` | Recommended | Persistent session secret (see above) |

### Setting up with Authentik

1. In Authentik, go to **Applications → Providers → Create** and choose **OAuth2/OpenID Provider**.
2. Configure the provider:
   - **Client type**: `Confidential`
   - **Redirect URIs**: `https://<your-domain>/auth/oidc/callback` (exact match, no trailing slash)
   - **Scopes**: `openid`, `email`, `profile`
   - **Subject mode**: `Based on the User's hashed ID` (or `Based on the User's ID`)
   - Note the **Client ID** and **Client Secret**
3. Create an **Application** linked to this provider.
4. Find your **Issuer URL** — it appears in the provider detail page and looks like `https://auth.example.com/application/o/<slug>/`. Verify it by opening `<issuer>/.well-known/openid-configuration` in your browser.
5. Add to your `.env` (or via the Settings page in the dashboard):

```env
OIDC_ENABLED=true
OIDC_ISSUER=https://auth.example.com/application/o/tesla-invoice-fetcher/
OIDC_CLIENT_ID=<client-id>
OIDC_CLIENT_SECRET=<client-secret>
OIDC_REDIRECT_URI=https://tif.example.com/auth/oidc/callback
SECRET_KEY=<random-hex-string>
```

> **Reverse proxy note:** Point your reverse proxy (nginx, Caddy, etc.) at the Tesla Invoice Fetcher container — **not** at Authentik. Authentik handles login only during the OAuth redirect flow; the app itself enforces the session guard.

## CI/CD

The Docker image is automatically built and pushed to GHCR on every push to `main` and on version tags (`v*`). The workflow is defined in [`.github/workflows/docker.yml`](.github/workflows/docker.yml).

Tagged releases produce versioned images:

```
ghcr.io/kevinengelen1/tesla-invoice-fetcher:latest   # latest main
ghcr.io/kevinengelen1/tesla-invoice-fetcher:1.0.0     # tagged release
```

## Design Decisions

### Why two APIs?

Tesla doesn't expose all invoice types through a single API:

- **Fleet API** (`fleet-api.prd.*.vn.cloud.tesla.com`) — Third-party developer API. Provides Supercharger charging history and invoice PDFs. Requires a registered application with client ID + secret.
- **Ownership API** (`ownership.tesla.com`) — First-party API used by the Tesla mobile app. Provides Premium Connectivity subscription invoices. Uses the `ownerapi` client ID (no secret required).

These are fundamentally different OAuth clients with different scopes, so they require separate authorization flows. The app makes this as painless as possible with the "Authorize Both" wizard.

### Unified token storage

Both API tokens live in a single `tokens.json` under `fleet` and `ownership` keys, with a consistent `expires_at` timestamp format. On first run, old tokens from a previous split format (`tokens.json` + `cache.json`) are automatically migrated.

### Fleet API auto-redirect

When the redirect URI points to the Flask app's own `/auth/fleet/callback` endpoint **and** the browser accesses the dashboard on the same host:port, Fleet API authorization is a single-click flow: the browser navigates to Tesla's login, and after authentication, redirects straight back to the dashboard.

When accessed from a different machine (common with Docker on a NAS), the redirect URI (`localhost:8080/callback`) won't reach the Flask app from the browser's perspective. In this case, the app detects the mismatch and automatically shows the manual paste flow instead — same as the Ownership API.

### Ownership API paste flow

Tesla's `ownerapi` client has a hardcoded redirect URI (`https://auth.tesla.com/void/callback`) that goes to a blank Tesla page. Since we can't receive the redirect, the user must copy the URL from their browser's address bar and paste it into the dashboard. This is a Tesla platform limitation.

### Token refresh strategy

- Access tokens expire every 8 hours (28800 seconds)
- The app proactively refreshes tokens **5 minutes before expiry** to prevent mid-request failures
- On page load, the dashboard attempts to refresh any expired tokens using stored refresh tokens
- If an API returns **401**, the app forces a token refresh and **retries the request once** before reporting an error

### Invoice tracking

Downloaded invoice IDs (both Fleet `contentId` and Ownership `invoiceId`) are persisted in `invoices/.downloaded_invoices.json`. This prevents re-downloading on subsequent runs and makes the fetcher safe to run repeatedly or on a schedule.

### Invoice naming

Configurable via `INVOICE_NAME_PATTERN` in `.env`. Placeholders: `{date}` (YYYY-MM-DD), `{label}` (Superchargen / Premium Connectivity), `{name}` (original filename), `{id}` (Tesla's invoice ID).

## Project Structure

```
tesla-invoice-fetcher/
├── app.py                      # Flask web UI + OAuth flows
├── tesla_invoice_fetcher.py    # Core fetching logic
├── templates/
│   ├── index.html              # Dashboard frontend
│   ├── config.html             # Settings page
│   └── login.html              # OIDC login / error page
├── tokens.json                 # Unified token storage (auto-created)
├── invoices/
│   ├── .downloaded_invoices.json
│   ├── supercharger/           # Supercharger invoice PDFs
│   └── premium_connectivity/   # Subscription invoice PDFs
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── .github/workflows/
│   └── docker.yml              # CI: build & push to GHCR
├── .env                        # Configuration (from .env.example)
├── .env.example
└── LICENSE
```

## License

[MIT](LICENSE)
