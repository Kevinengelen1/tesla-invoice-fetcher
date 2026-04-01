CREATE TABLE IF NOT EXISTS tesla_accounts (
    id          INT NOT NULL AUTO_INCREMENT,
    name        VARCHAR(255) NOT NULL,
    region      VARCHAR(16) NOT NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS account_id INT NULL;

SET @fk_vehicles_account_exists = (
    SELECT COUNT(*)
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'vehicles'
      AND CONSTRAINT_NAME = 'fk_vehicles_account'
);
SET @sql = IF(
    @fk_vehicles_account_exists = 0,
    'ALTER TABLE vehicles ADD CONSTRAINT fk_vehicles_account FOREIGN KEY (account_id) REFERENCES tesla_accounts(id) ON DELETE SET NULL',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE tesla_tokens ADD COLUMN IF NOT EXISTS account_id INT NULL;

INSERT INTO tesla_accounts (name, region)
SELECT CONCAT('Imported account (', regions.region, ')'), regions.region
FROM (SELECT DISTINCT region FROM tesla_tokens) regions
LEFT JOIN tesla_accounts existing ON existing.region = regions.region
WHERE existing.id IS NULL;

UPDATE tesla_tokens
JOIN tesla_accounts ON tesla_accounts.region = tesla_tokens.region
SET tesla_tokens.account_id = tesla_accounts.id
WHERE tesla_tokens.account_id IS NULL;

UPDATE vehicles
JOIN tesla_accounts ON tesla_accounts.region = vehicles.region
SET vehicles.account_id = tesla_accounts.id
WHERE vehicles.account_id IS NULL;

SET @idx_region_category_exists = (
    SELECT COUNT(*)
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tesla_tokens'
      AND INDEX_NAME = 'region_category'
);
SET @sql = IF(
    @idx_region_category_exists > 0,
    'ALTER TABLE tesla_tokens DROP INDEX region_category',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_region_exists = (
    SELECT COUNT(*)
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tesla_tokens'
      AND INDEX_NAME = 'region'
);
SET @sql = IF(
    @idx_region_exists > 0,
    'ALTER TABLE tesla_tokens DROP INDEX region',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE tesla_tokens MODIFY account_id INT NOT NULL;

SET @fk_tesla_tokens_account_exists = (
    SELECT COUNT(*)
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tesla_tokens'
      AND CONSTRAINT_NAME = 'fk_tesla_tokens_account'
);
SET @sql = IF(
    @fk_tesla_tokens_account_exists = 0,
    'ALTER TABLE tesla_tokens ADD CONSTRAINT fk_tesla_tokens_account FOREIGN KEY (account_id) REFERENCES tesla_accounts(id) ON DELETE CASCADE',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @uniq_account_category_exists = (
    SELECT COUNT(*)
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tesla_tokens'
      AND INDEX_NAME = 'uniq_tesla_tokens_account_category'
);
SET @sql = IF(
    @uniq_account_category_exists = 0,
    'ALTER TABLE tesla_tokens ADD UNIQUE KEY uniq_tesla_tokens_account_category (account_id, token_category)',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_vehicles_account_id_exists = (
    SELECT COUNT(*)
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'vehicles'
      AND INDEX_NAME = 'idx_vehicles_account_id'
);
SET @sql = IF(
    @idx_vehicles_account_id_exists = 0,
    'CREATE INDEX idx_vehicles_account_id ON vehicles(account_id)',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_tesla_tokens_account_id_exists = (
    SELECT COUNT(*)
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tesla_tokens'
      AND INDEX_NAME = 'idx_tesla_tokens_account_id'
);
SET @sql = IF(
    @idx_tesla_tokens_account_id_exists = 0,
    'CREATE INDEX idx_tesla_tokens_account_id ON tesla_tokens(account_id)',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;