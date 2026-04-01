CREATE TABLE IF NOT EXISTS rate_limits (
    limiter_key  TEXT PRIMARY KEY,
    count        INTEGER NOT NULL DEFAULT 0,
    window_start TEXT NOT NULL,
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_updated_at ON rate_limits(updated_at);