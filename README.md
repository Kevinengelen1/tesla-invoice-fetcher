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
│   └── index.html              # Dashboard frontend
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
