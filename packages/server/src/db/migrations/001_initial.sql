CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    oidc_sub      TEXT UNIQUE,
    display_name  TEXT,
    role          TEXT NOT NULL DEFAULT 'user',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    vin         TEXT NOT NULL UNIQUE,
    name        TEXT,
    region      TEXT NOT NULL DEFAULT 'NA',
    tesla_id    TEXT,
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tesla_tokens (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id      INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
    region          TEXT NOT NULL UNIQUE,
    access_token    TEXT NOT NULL,
    refresh_token   TEXT NOT NULL,
    token_type      TEXT NOT NULL DEFAULT 'bearer',
    expires_at      TEXT NOT NULL,
    scopes          TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id     TEXT NOT NULL,
    vin             TEXT NOT NULL,
    vehicle_id      INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
    invoice_type    TEXT NOT NULL,
    invoice_date    TEXT NOT NULL,
    amount_cents    INTEGER,
    currency        TEXT DEFAULT 'USD',
    site_name       TEXT,
    energy_kwh      REAL,
    file_path       TEXT NOT NULL,
    file_hash       TEXT NOT NULL,
    file_size       INTEGER,
    original_name   TEXT,
    renamed         INTEGER NOT NULL DEFAULT 0,
    emailed         INTEGER NOT NULL DEFAULT 0,
    metadata        TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(external_id, invoice_type)
);

CREATE INDEX IF NOT EXISTS idx_invoices_vin ON invoices(vin);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_hash ON invoices(file_hash);

CREATE TABLE IF NOT EXISTS fetch_runs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at       TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at      TEXT,
    status           TEXT NOT NULL DEFAULT 'running',
    dry_run          INTEGER NOT NULL DEFAULT 0,
    invoices_found   INTEGER DEFAULT 0,
    invoices_new     INTEGER DEFAULT 0,
    invoices_skipped INTEGER DEFAULT 0,
    error_message    TEXT,
    log              TEXT
);
