CREATE TABLE IF NOT EXISTS tesla_app_configs (
    id                  INT NOT NULL AUTO_INCREMENT,
    name                VARCHAR(255) NOT NULL,
    region              VARCHAR(16) NOT NULL,
    client_id           VARCHAR(255) NOT NULL,
    client_secret_enc   TEXT NOT NULL,
    redirect_uri        VARCHAR(512) NOT NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);

ALTER TABLE tesla_accounts ADD COLUMN IF NOT EXISTS app_config_id INT NULL;

SET @fk_tesla_accounts_app_config_exists = (
    SELECT COUNT(*)
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tesla_accounts'
      AND CONSTRAINT_NAME = 'fk_tesla_accounts_app_config'
);
SET @sql = IF(
    @fk_tesla_accounts_app_config_exists = 0,
    'ALTER TABLE tesla_accounts ADD CONSTRAINT fk_tesla_accounts_app_config FOREIGN KEY (app_config_id) REFERENCES tesla_app_configs(id) ON DELETE SET NULL',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

INSERT INTO tesla_app_configs (name, region, client_id, client_secret_enc, redirect_uri)
SELECT
    CONCAT('Imported Tesla app (', settings_region.value, ')'),
    settings_region.value,
    settings_client_id.value,
    settings_client_secret.value,
    settings_redirect_uri.value
FROM settings settings_region
JOIN settings settings_client_id ON settings_client_id.`key` = 'TESLA_CLIENT_ID'
JOIN settings settings_client_secret ON settings_client_secret.`key` = 'TESLA_CLIENT_SECRET'
JOIN settings settings_redirect_uri ON settings_redirect_uri.`key` = 'TESLA_REDIRECT_URI'
LEFT JOIN tesla_app_configs existing
    ON existing.region = settings_region.value
   AND existing.client_id = settings_client_id.value
   AND existing.redirect_uri = settings_redirect_uri.value
WHERE settings_region.`key` = 'TESLA_REGION'
  AND settings_client_id.value <> ''
  AND settings_client_secret.value <> ''
  AND settings_redirect_uri.value <> ''
  AND existing.id IS NULL;

UPDATE tesla_accounts
JOIN tesla_app_configs ON tesla_app_configs.region = tesla_accounts.region
SET tesla_accounts.app_config_id = tesla_app_configs.id
WHERE tesla_accounts.app_config_id IS NULL;

SET @idx_tesla_accounts_app_config_id_exists = (
    SELECT COUNT(*)
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tesla_accounts'
      AND INDEX_NAME = 'idx_tesla_accounts_app_config_id'
);
SET @sql = IF(
    @idx_tesla_accounts_app_config_id_exists = 0,
    'CREATE INDEX idx_tesla_accounts_app_config_id ON tesla_accounts(app_config_id)',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;