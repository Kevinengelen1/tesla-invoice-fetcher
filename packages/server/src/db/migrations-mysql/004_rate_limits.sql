CREATE TABLE IF NOT EXISTS rate_limits (
    limiter_key  VARCHAR(255) PRIMARY KEY,
    count        INT NOT NULL DEFAULT 0,
    window_start DATETIME NOT NULL,
    updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_rate_limits_updated_at ON rate_limits(updated_at);