CREATE TABLE IF NOT EXISTS tesla_accounts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    region      TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE vehicles ADD COLUMN account_id INTEGER REFERENCES tesla_accounts(id) ON DELETE SET NULL;
ALTER TABLE tesla_tokens ADD COLUMN account_id INTEGER REFERENCES tesla_accounts(id) ON DELETE CASCADE;

INSERT INTO tesla_accounts (name, region)
SELECT 'Imported account (' || region || ')', region
FROM (
    SELECT DISTINCT region FROM tesla_tokens
) existing_regions
WHERE NOT EXISTS (
    SELECT 1 FROM tesla_accounts accounts WHERE accounts.region = existing_regions.region
);

UPDATE tesla_tokens
SET account_id = (
    SELECT tesla_accounts.id
    FROM tesla_accounts
    WHERE tesla_accounts.region = tesla_tokens.region
    ORDER BY tesla_accounts.id ASC
    LIMIT 1
)
WHERE account_id IS NULL;

UPDATE vehicles
SET account_id = (
    SELECT tesla_accounts.id
    FROM tesla_accounts
    WHERE tesla_accounts.region = vehicles.region
    ORDER BY tesla_accounts.id ASC
    LIMIT 1
)
WHERE account_id IS NULL
  AND EXISTS (
    SELECT 1 FROM tesla_accounts WHERE tesla_accounts.region = vehicles.region
  );

CREATE TABLE tesla_tokens_new (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL REFERENCES tesla_accounts(id) ON DELETE CASCADE,
    vehicle_id      INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
    region          TEXT NOT NULL,
    token_category  TEXT NOT NULL DEFAULT 'fleet',
    access_token    TEXT NOT NULL,
    refresh_token   TEXT NOT NULL,
    token_type      TEXT NOT NULL DEFAULT 'bearer',
    expires_at      TEXT NOT NULL,
    scopes          TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(account_id, token_category)
);

INSERT INTO tesla_tokens_new
    (id, account_id, vehicle_id, region, token_category, access_token, refresh_token, token_type, expires_at, scopes, created_at, updated_at)
SELECT
    id, account_id, vehicle_id, region, token_category, access_token, refresh_token, token_type, expires_at, scopes, created_at, updated_at
FROM tesla_tokens
WHERE account_id IS NOT NULL;

DROP TABLE tesla_tokens;

ALTER TABLE tesla_tokens_new RENAME TO tesla_tokens;

CREATE INDEX IF NOT EXISTS idx_vehicles_account_id ON vehicles(account_id);
CREATE INDEX IF NOT EXISTS idx_tesla_tokens_account_id ON tesla_tokens(account_id);