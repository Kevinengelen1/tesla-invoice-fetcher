-- Add token_category to tesla_tokens to support both 'fleet' and 'ownership' tokens per region.
-- Existing rows are fleet tokens; default them accordingly.

ALTER TABLE tesla_tokens ADD COLUMN token_category TEXT NOT NULL DEFAULT 'fleet';

-- Drop the old unique constraint on region alone and recreate on (region, token_category).
-- SQLite does not support DROP CONSTRAINT; we recreate the table.
CREATE TABLE tesla_tokens_new (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
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
    UNIQUE(region, token_category)
);

INSERT INTO tesla_tokens_new
    (id, vehicle_id, region, token_category, access_token, refresh_token, token_type, expires_at, scopes, created_at, updated_at)
SELECT
    id, vehicle_id, region, token_category, access_token, refresh_token, token_type, expires_at, scopes, created_at, updated_at
FROM tesla_tokens;

DROP TABLE tesla_tokens;

ALTER TABLE tesla_tokens_new RENAME TO tesla_tokens;
