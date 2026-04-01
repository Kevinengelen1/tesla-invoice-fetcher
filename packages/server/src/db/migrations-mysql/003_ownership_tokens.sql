-- Migration 003: Add token_category support for ownership tokens
-- MySQL supports ALTER TABLE ADD COLUMN and ALTER TABLE ADD UNIQUE directly.

ALTER TABLE tesla_tokens ADD COLUMN IF NOT EXISTS token_category VARCHAR(50) NOT NULL DEFAULT 'fleet';

-- Drop old unique constraint on region alone (if it exists) and add new composite one.
-- We use IF EXISTS to be safe on fresh installs where migration 001 already has the correct schema.
ALTER TABLE tesla_tokens DROP INDEX IF EXISTS region;
