CREATE TABLE IF NOT EXISTS tesla_app_configs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT NOT NULL,
    region              TEXT NOT NULL,
    client_id           TEXT NOT NULL,
    client_secret_enc   TEXT NOT NULL,
    redirect_uri        TEXT NOT NULL,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE tesla_accounts ADD COLUMN app_config_id INTEGER REFERENCES tesla_app_configs(id) ON DELETE SET NULL;

INSERT INTO tesla_app_configs (name, region, client_id, client_secret_enc, redirect_uri)
SELECT
    'Imported Tesla app (' || settings_region.value || ')',
    settings_region.value,
    settings_client_id.value,
    settings_client_secret.value,
    settings_redirect_uri.value
FROM settings settings_region
JOIN settings settings_client_id ON settings_client_id.key = 'TESLA_CLIENT_ID'
JOIN settings settings_client_secret ON settings_client_secret.key = 'TESLA_CLIENT_SECRET'
JOIN settings settings_redirect_uri ON settings_redirect_uri.key = 'TESLA_REDIRECT_URI'
WHERE settings_region.key = 'TESLA_REGION'
  AND settings_client_id.value <> ''
  AND settings_client_secret.value <> ''
  AND settings_redirect_uri.value <> ''
  AND NOT EXISTS (
      SELECT 1
      FROM tesla_app_configs app
      WHERE app.region = settings_region.value
        AND app.client_id = settings_client_id.value
        AND app.redirect_uri = settings_redirect_uri.value
  );

UPDATE tesla_accounts
SET app_config_id = (
    SELECT tesla_app_configs.id
    FROM tesla_app_configs
    WHERE tesla_app_configs.region = tesla_accounts.region
    ORDER BY tesla_app_configs.id ASC
    LIMIT 1
)
WHERE app_config_id IS NULL
  AND EXISTS (
      SELECT 1 FROM tesla_app_configs WHERE tesla_app_configs.region = tesla_accounts.region
  );

CREATE INDEX IF NOT EXISTS idx_tesla_accounts_app_config_id ON tesla_accounts(app_config_id);