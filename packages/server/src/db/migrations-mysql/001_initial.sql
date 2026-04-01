CREATE TABLE IF NOT EXISTS users (
    id            INT NOT NULL AUTO_INCREMENT,
    username      VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT,
    oidc_sub      VARCHAR(255) UNIQUE,
    display_name  VARCHAR(255),
    role          VARCHAR(50) NOT NULL DEFAULT 'user',
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS vehicles (
    id          INT NOT NULL AUTO_INCREMENT,
    vin         VARCHAR(17) NOT NULL UNIQUE,
    name        VARCHAR(255),
    region      VARCHAR(10) NOT NULL DEFAULT 'NA',
    tesla_id    VARCHAR(255),
    enabled     TINYINT NOT NULL DEFAULT 1,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS tesla_tokens (
    id              INT NOT NULL AUTO_INCREMENT,
    vehicle_id      INT,
    region          VARCHAR(10) NOT NULL,
    token_category  VARCHAR(50) NOT NULL DEFAULT 'fleet',
    access_token    TEXT NOT NULL,
    refresh_token   TEXT NOT NULL,
    token_type      VARCHAR(50) NOT NULL DEFAULT 'bearer',
    expires_at      VARCHAR(50) NOT NULL,
    scopes          TEXT,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY region_category (region, token_category),
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS invoices (
    id              INT NOT NULL AUTO_INCREMENT,
    external_id     VARCHAR(255) NOT NULL,
    vin             VARCHAR(17) NOT NULL,
    vehicle_id      INT,
    invoice_type    VARCHAR(50) NOT NULL,
    invoice_date    VARCHAR(50) NOT NULL,
    amount_cents    INT,
    currency        VARCHAR(10) DEFAULT 'USD',
    site_name       VARCHAR(255),
    energy_kwh      DECIMAL(15,5),
    file_path       TEXT NOT NULL,
    file_hash       VARCHAR(64) NOT NULL,
    file_size       INT,
    original_name   VARCHAR(255),
    renamed         TINYINT NOT NULL DEFAULT 0,
    emailed         TINYINT NOT NULL DEFAULT 0,
    metadata        TEXT,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY external_type (external_id, invoice_type),
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL
);

CREATE INDEX idx_invoices_vin ON invoices(vin);
CREATE INDEX idx_invoices_date ON invoices(invoice_date);
CREATE INDEX idx_invoices_hash ON invoices(file_hash);

CREATE TABLE IF NOT EXISTS fetch_runs (
    id               INT NOT NULL AUTO_INCREMENT,
    started_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at      DATETIME,
    status           VARCHAR(20) NOT NULL DEFAULT 'running',
    dry_run          TINYINT NOT NULL DEFAULT 0,
    invoices_found   INT DEFAULT 0,
    invoices_new     INT DEFAULT 0,
    invoices_skipped INT DEFAULT 0,
    error_message    TEXT,
    log              LONGTEXT,
    PRIMARY KEY (id)
);
