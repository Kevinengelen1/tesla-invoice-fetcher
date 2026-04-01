# Architecture

## System Overview

The application is a monorepo with a TypeScript Express backend and a React/Vite frontend. The backend owns Tesla integration, persistence, scheduling, and file management. The frontend is an authenticated operator console over the backend API.

## Runtime Topology

### Client

- React 19 SPA
- Vite build and development server
- Session-based API access over `/api`
- UI pages for dashboard, invoices, vehicles, users, settings, Tesla authentication, and fetch runs
- UI pages for dashboard, invoices, vehicles, users, settings, Tesla authentication, fetch runs, and diagnostics

### Server

- Express application exposing authenticated JSON routes
- Passport-based local and optional OIDC authentication
- Scheduler/orchestrator for fetch execution
- Repository layer for SQL persistence
- Tesla auth/token manager and invoice fetchers
- File storage for downloaded invoice documents

### Persistence

- SQLite by default, with MySQL support in the repository/migration layer
- Database-backed runtime settings and Tesla app configs
- Local filesystem for invoice PDFs and derived filenames

## Main Architectural Flows

### Tesla Onboarding

1. Admin creates a Tesla app config in the UI.
2. Admin creates a Tesla account linked to that app config.
3. Admin completes Fleet and Ownership OAuth flows.
4. Vehicles are linked to the Tesla account and become eligible for fetching/filtering.

### Fetch Execution

1. User triggers a manual fetch or scheduler triggers one automatically.
2. A shared fetch job service admits or rejects the request based on current in-process job state.
3. Server creates a `fetch_runs` row immediately for accepted work.
4. Orchestrator resolves eligible vehicles/accounts/tokens.
5. Registered fetchers call Tesla APIs and download invoices.
6. Files and metadata are persisted, duplicates are skipped, run logs are appended.
7. UI reads aggregated results from `fetch_runs`, diagnostics, and invoice data.

### Invoice Management

1. Frontend queries paginated invoice data from the API.
2. Server applies filtering and validated server-side sorting.
3. User actions like delete, rename, export, and ZIP download call dedicated routes.
4. Backend performs filesystem and database updates as one operational flow.

## Package Structure

### `packages/server`

- `auth/`: passport, session, login guards
- `db/`: adapter abstraction, migrations, repositories
- `middleware/`: validation, async wrappers, error handling
- `routes/`: HTTP API surface
- `services/`: email, export, rename, scheduling, logging helpers
- `tesla/`: Tesla auth, token refresh, API clients, fetchers, orchestrator
- `types/`: shared backend models and filter contracts

### `packages/client`

- `components/`: layout and reusable UI pieces
- `hooks/`: auth, toast, and related UI hooks
- `lib/`: API client and formatting utilities
- `pages/`: route-level screens

## Key Design Decisions

### Database-Owned Tesla Config

Tesla developer app credentials were moved out of `.env` and settings forms into database-backed app configs. This supports multiple reusable app registrations per region/account setup and removes the single-global-credential bottleneck.

### Repository-Led SQL Whitelisting

User-provided sort fields are validated and mapped through repository allowlists instead of interpolating arbitrary client input. That keeps the API flexible without making ordering unsafe.

### In-Process Orchestration

Fetch execution currently runs in-process through a shared fetch job service plus the orchestrator. This keeps the architecture simple and deployable in a single container, while centralizing concurrency control for both manual and scheduled triggers. Job durability and horizontal scale are still limited compared with a dedicated queue/worker model.

### File-Backed Invoice Storage

Invoice metadata lives in SQL, but binaries remain on disk. That keeps the database smaller and makes ZIP download/rename operations straightforward, at the cost of needing filesystem hygiene and backup discipline.

## Architectural Risks

- Single-process execution for scheduled and manual fetches
- Limited observability beyond logs and fetch-run records
- Tight coupling between API availability and background execution
- Filesystem dependence for invoice persistence and rename flows
- No dedicated service-invoice integration despite the schema allowing that type

## Recommended Next Architectural Steps

- Introduce structured telemetry for fetches, token refresh, and scheduler outcomes
- Split long-running fetch execution behind a job abstraction if concurrency grows
- Add repository/service tests around newer Tesla app-config flows and sort contracts
- Define a formal import boundary if manual invoice ingestion is added later