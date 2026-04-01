# Specification

## Purpose

Tesla Invoice Fetcher is an internal-style web application for collecting invoice documents from Tesla APIs, storing the resulting files locally, and giving operators an admin UI for review, export, renaming, and monitoring.

## Supported Features

### Authentication and Access

- Local username/password authentication for app users
- Optional OIDC login for SSO environments
- Role-based access with admin and user roles
- CSRF protection on mutation requests

### Tesla Integration

- Region-aware Tesla developer app configs stored in the database
- Multiple Tesla accounts per deployment
- Fleet token flow per Tesla account
- Ownership token flow per Tesla account
- Vehicle onboarding linked to Tesla accounts

### Invoice Fetching

- Supercharger invoice retrieval
- Premium Connectivity subscription invoice retrieval
- Manual and scheduled fetch execution
- Dry-run support for fetch validation
- Fetch-run logging and result history

### Invoice Management

- Search and filter by text, vehicle, invoice type, and date range
- Sortable invoice table columns
- CSV export
- ZIP download for selected invoices
- Bulk rename with preview
- Duplicate detection based on stored file hash

### Operations and Admin

- Startup readiness checks in dashboard
- Diagnostics page for Tesla auth state, problem runs, and vehicle assignment issues
- Settings UI backed by database-stored overrides
- Email notifications for new invoices
- User administration
- Dashboard analytics and recent run visibility

## Explicitly Out Of Scope Today

- Service invoice fetching from Tesla APIs
- Raw Tesla API response explorer/debug UI
- Multi-tenant isolation between independent organizations
- Background job queue infrastructure beyond the in-process fetch job service and scheduler
- Audit trail with per-field change history

## Data Model Summary

- `tesla_app_configs`: Tesla developer applications by region
- `tesla_accounts`: Tesla user accounts linked to app configs
- `vehicles`: Tesla vehicles linked to Tesla accounts
- `tesla_tokens`: encrypted Fleet and Ownership tokens
- `invoices`: invoice metadata and local file references
- `fetch_runs`: execution history and logs for fetch activity
- `settings`: persisted runtime overrides
- `users`: local application users

## Product Constraints

- Tesla developer credentials are managed in the Tesla Authentication UI, not in `.env`
- Tesla app configs are required for onboarding Tesla accounts
- The active region influences Tesla auth and vehicle setup flows
- Subscription invoices may not include a usable amount in Tesla responses, so amount fields can be null
- SQL datetimes are normalized client-side before relative-time formatting

## Planned Expansion Areas

- Service invoice ingestion if Tesla API coverage becomes reliable enough
- Better observability around fetch failures and token health
- Richer import/export workflows
- More operational guardrails for production deployments