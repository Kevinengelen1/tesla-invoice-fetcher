# Tesla Invoice Fetcher

A web application to fetch, manage, and organize invoices from Tesla APIs, with implemented fetch support for Supercharger sessions and Premium Connectivity subscriptions.

## Features

- **Invoice Fetching** — Fetch invoices from Tesla APIs for Supercharger and Premium Connectivity subscription billing
- **Multi-VIN & Multi-Region** — Support for NA, EU, and CN regions with multiple vehicles
- **Dark Mode Dashboard** — Responsive, mobile-friendly UI with real-time log streaming
- **Invoice Management** — Search, sort, paginate, download, bulk rename, CSV export
- **Scheduled Fetching** — Cron-based auto-fetch with dry-run mode
- **Email Notifications** — Automatic email when new invoices are found
- **Dashboard Readiness Wizard** — Guided setup checks for Tesla app config, region auth, vehicles, local fallback, and optional SSO
- **In-App Alerts** — Browser toast alerts for new invoices, failed fetch runs, and Tesla token issues
- **Duplicate Prevention** — Content-hash based deduplication
- **Tesla OAuth** — PKCE-based OAuth2 flow with encrypted token storage and auto-refresh
- **OIDC Login** — Optional SSO via OpenID Connect (e.g., Authentik) + local login fallback
- **Settings UI** — Live-editable settings persisted to database, with .env defaults and write-only secret rotation
- **User Management** — Admins can create local users, assign roles, and reset passwords
- **Schedule Helper** — Ready-made cron presets in the UI for common auto-fetch schedules
- **Diagnostics View** — Dedicated operational page for Tesla auth health, fetch issues, and vehicle assignment problems

## Documentation

- [docs/specification.md](docs/specification.md) — current feature scope, supported flows, and product constraints
- [docs/architecture.md](docs/architecture.md) — architectural layout, runtime boundaries, and key design decisions

## Tech Stack

| Layer      | Technology                                  |
|------------|---------------------------------------------|
| Backend    | Node.js, Express, TypeScript                |
| Frontend   | React 19, TypeScript, Vite, Tailwind CSS 4  |
| Database   | SQLite (better-sqlite3)                     |
| Auth       | Passport.js (local + OIDC), express-session |
| Email      | Nodemailer                                  |
| Testing    | Vitest                                      |
| Container  | Docker (multi-stage build)                  |
| CI/CD      | GitHub Actions                              |

## Quick Start

### Prerequisites

- Node.js 20+
- npm 9+

### Development

```bash
# Clone the repository
git clone <repo-url>
cd tesla-invoice-fetcher

# Install dependencies
npm install

# Copy environment config
cp .env.example .env

# Start development (server + client)
npm run dev
```

The server runs on `http://localhost:3001` and the client dev server on `http://localhost:5173` (proxying API requests to the server).

On first run, an admin user is created with a random password logged to the console.
Admins can later manage additional users and roles from the Users page in the web UI.

### Production Build

```bash
npm run build
npm start
```

## Docker

### Docker Compose (recommended)

```bash
cp .env.example .env
# Edit .env with your configuration
docker compose up -d
```

To run the published GHCR image instead of building locally, set `TESLA_INVOICE_FETCHER_IMAGE=ghcr.io/<owner>/tesla-invoice-fetcher:latest` before `docker compose up -d`.

### Manual Docker Build

```bash
docker build -t tesla-invoice-fetcher .
docker run -d \
  --name tesla-invoice-fetcher \
  -p 3001:3001 \
  -v ./data:/app/data \
  -v ./invoices:/app/invoices \
  --env-file .env \
  tesla-invoice-fetcher
```

The app is available at `http://localhost:3001`.

### GitHub Container Registry

Pushes to `main` trigger [.github/workflows/ci.yml](.github/workflows/ci.yml), which publishes a multi-architecture image to GHCR with these tags:

- `ghcr.io/<owner>/tesla-invoice-fetcher:latest`
- `ghcr.io/<owner>/tesla-invoice-fetcher:sha-<commit>`

Example pull and run flow:

```bash
docker pull ghcr.io/<owner>/tesla-invoice-fetcher:latest
docker run -d \
  --name tesla-invoice-fetcher \
  -p 3001:3001 \
  -v ./data:/app/data \
  -v ./invoices:/app/invoices \
  --env-file .env \
  ghcr.io/<owner>/tesla-invoice-fetcher:latest
```

If the package is private, authenticate first with `docker login ghcr.io` using a GitHub token that can read packages.

## Configuration

Most configuration is managed through environment variables (`.env`) with optional override via the Settings UI. Tesla developer app credentials are stored in the database and managed from the Tesla Authentication page.

| Variable                    | Default                                          | Description                        |
|-----------------------------|--------------------------------------------------|------------------------------------|
| `PORT`                      | `3001`                                           | Server port                        |
| `BASE_URL`                  | `http://localhost:3001`                           | Public URL                         |
| `DATABASE_PATH`             | `./data/tesla-invoices.sqlite`                    | SQLite database path               |
| `INVOICE_STORAGE_DIR`       | `./invoices`                                     | Directory for downloaded PDFs      |
| `SESSION_SECRET`            | Auto-generated                                   | Express session secret             |
| `TOKEN_ENCRYPTION_KEY`      | Auto-generated                                   | AES-256-GCM key for Tesla tokens   |
| `TESLA_REGION`              | `NA`                                             | Active Tesla region used for auth and vehicle onboarding |
| `OIDC_ENABLED`              | `false`                                          | Enable OIDC/SSO login              |
| `OIDC_ISSUER`               |                                                  | OIDC provider issuer URL           |
| `OIDC_CLIENT_ID`            |                                                  | OIDC client ID                     |
| `OIDC_CLIENT_SECRET`        |                                                  | OIDC client secret                 |
| `EMAIL_ENABLED`             | `false`                                          | Enable email notifications         |
| `SMTP_HOST`                 |                                                  | SMTP server host                   |
| `SMTP_PORT`                 | `587`                                            | SMTP server port                   |
| `FETCH_SCHEDULE_CRON`       |                                                  | Cron expression for auto-fetch     |
| `AUTO_FETCH_ENABLED`        | `false`                                          | Enable scheduled auto-fetching     |
| `INVOICE_FILENAME_TEMPLATE` | `{date}_{type}_{vin}_{site}`                     | Template for renamed filenames     |

## Tesla API Setup

1. Register at [developer.tesla.com](https://developer.tesla.com)
2. Create an application and note your Client ID and Client Secret
3. Set the redirect URI to the callback you will store in the Tesla app config, for example `http://localhost:8080/callback`
4. In the UI, open **Tesla Authentication** and add a Tesla developer app config for the correct region
5. Add a Tesla account linked to that app config, then authenticate Fleet and Ownership access for that account

## Current Scope Note

The application keeps `service` as an invoice type in the schema for forward compatibility, filtering, and possible manual imports, but there is no service-invoice fetcher or service-specific Tesla API integration in the current product.

Manual and scheduled fetch execution now go through a shared in-process fetch job service. This is still a single-process design, but it cleanly separates route/scheduler triggers from the orchestration logic.

## Project Structure

```
tesla-invoice-fetcher/
├── packages/
│   ├── server/                 # Express backend
│   │   ├── src/
│   │   │   ├── auth/           # Session, passport, OIDC, CSRF
│   │   │   ├── db/             # SQLite connection, migrations, repositories
│   │   │   ├── middleware/     # Error handling, validation, rate limiting
│   │   │   ├── routes/         # API route handlers
│   │   │   ├── services/       # Email, export, rename, scheduler, log stream
│   │   │   ├── tesla/          # Tesla API client, auth, fetchers
│   │   │   └── types/          # TypeScript type definitions
│   │   └── tests/              # Server tests
│   └── client/                 # React frontend
│       └── src/
│           ├── hooks/          # Auth, toast, log stream hooks
│           ├── lib/            # API client, utilities
│           ├── pages/          # Dashboard, Invoices, Vehicles, Settings, etc.
│           └── components/     # Layout, shared components
├── .github/workflows/ci.yml   # GitHub Actions CI/CD
├── Dockerfile                  # Multi-stage Docker build
├── docker-compose.yml          # Docker Compose setup
└── .env.example                # Environment variable template
```

## Testing

```bash
# Run all tests
npm test

# Run server tests only
npm test -w packages/server

# Run client tests only
npm test -w packages/client

# Watch mode
npm run test:watch -w packages/server
```

## Security

- CSRF protection (double-submit cookie pattern)
- bcrypt password hashing (12 rounds)
- AES-256-GCM encryption for stored Tesla tokens
- Rate limiting (100 API req/15min, 10 login attempts/15min)
- Helmet HTTP security headers
- Session-based auth with httpOnly cookies
- Input validation with Zod schemas
- PKCE for Tesla OAuth flows

## License

MIT
