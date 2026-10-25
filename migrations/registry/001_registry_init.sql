-- 001_registry_init.sql
-- Initial schema of the NadStore Core registry (MySQL 8).
--
-- RECONSTRUCTED: the original file was not attached to the architecture
-- document. This DDL was rebuilt from sections 5, 6, 7, 10, 11, 12, 13 and 14
-- of "NadStore Core — سند معماری و پیاده‌سازی". Diff it against the owner's
-- original before production use — see QUESTIONS.md Q1.
--
-- Rules honored here (architecture document, section 5):
--   * charset utf8mb4, collation utf8mb4_0900_ai_ci, engine InnoDB
--   * every timestamp is UTC (sessions run with time_zone '+00:00')
--   * no ON DELETE CASCADE anywhere — FKs stay RESTRICT
--   * soft delete via status columns; audit_logs is insert-only
--   * no shop user data (customers, shop admins, orders, chat ids) lives here

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- Migration bookkeeping (created by this same file so a fresh database runs
-- everything as pending).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INT UNSIGNED NOT NULL,
  name VARCHAR(191) NOT NULL,
  applied_at DATETIME(3) NOT NULL,
  PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- tenancy: plans, tenants, tenant_domains, api_keys
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS plans (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(32) NOT NULL COMMENT 'stable code like basic; referenced by plan_code',
  name VARCHAR(64) NOT NULL,
  limits JSON NOT NULL COMMENT 'rate_per_min, sms_monthly, media_max_mb, media_total_mb, ...',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_plans_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS tenants (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(27) NOT NULL COMMENT '^[a-z][a-z0-9_]{1,26}$; immutable after creation',
  name VARCHAR(128) NOT NULL,
  plan_id INT UNSIGNED NOT NULL,
  status ENUM('provisioning','active','suspended','archived') NOT NULL DEFAULT 'provisioning',
  db_password_enc VARBINARY(1024) NOT NULL COMMENT 'AES-256-GCM: iv||tag||ciphertext',
  enc_key_version INT UNSIGNED NOT NULL,
  schema_version INT UNSIGNED NULL COMMENT 'max applied shop migration version',
  allowed_origins JSON NULL COMMENT 'CORS origins allowed for publishable keys',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenants_slug (slug),
  KEY ix_tenants_plan (plan_id),
  CONSTRAINT fk_tenants_plan FOREIGN KEY (plan_id) REFERENCES plans (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS tenant_domains (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  domain VARCHAR(253) NOT NULL COMMENT 'lowercase, no port, unique registry-wide',
  kind VARCHAR(32) NOT NULL DEFAULT 'store' COMMENT 'values to be confirmed by owner (QUESTIONS.md Q2)',
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  verified_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenant_domains_domain (domain),
  KEY ix_tenant_domains_tenant (tenant_id),
  CONSTRAINT fk_tenant_domains_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS api_keys (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  prefix VARCHAR(15) NOT NULL COMMENT 'first 15 chars shown in panel and logs',
  key_hash BINARY(32) NOT NULL COMMENT 'SHA-256 of the full raw key; raw key is never stored',
  type ENUM('publishable','secret') NOT NULL,
  label VARCHAR(64) NULL,
  scopes JSON NOT NULL,
  last_used_at DATETIME(3) NULL COMMENT 'batched from memory every 60s',
  expires_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_api_keys_hash (key_hash),
  KEY ix_api_keys_prefix (prefix),
  KEY ix_api_keys_tenant (tenant_id),
  CONSTRAINT fk_api_keys_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- services: tenant_services, usage_counters
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenant_services (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  service VARCHAR(32) NOT NULL COMMENT 'sms | telegram | media',
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  config_enc VARBINARY(8192) NULL COMMENT 'AES-256-GCM encrypted JSON config per service',
  enc_key_version INT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenant_services (tenant_id, service),
  CONSTRAINT fk_tenant_services_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS usage_counters (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  service VARCHAR(32) NOT NULL,
  period CHAR(7) NOT NULL COMMENT 'YYYY-MM built from UTC on the server',
  used INT UNSIGNED NOT NULL DEFAULT 0,
  limit_snapshot INT UNSIGNED NULL COMMENT 'plan limit captured at increment time; NULL = unlimited',
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usage_counters (tenant_id, service, period),
  CONSTRAINT fk_usage_counters_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- queue: jobs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  type VARCHAR(64) NOT NULL COMMENT 'sms.send, telegram.send, telegram.forward, ...',
  payload JSON NOT NULL COMMENT 'never contains secrets; body hash for idempotency',
  status ENUM('pending','running','done','failed') NOT NULL DEFAULT 'pending',
  run_at DATETIME(3) NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts INT UNSIGNED NOT NULL DEFAULT 5,
  locked_by VARCHAR(64) NULL,
  locked_until DATETIME(3) NULL,
  last_error VARCHAR(2000) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY ix_jobs_poll (status, run_at, id),
  KEY ix_jobs_tenant (tenant_id),
  CONSTRAINT fk_jobs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- platform management: admin_users, admin_sessions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS admin_users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL COMMENT 'argon2id string form',
  totp_secret_enc VARBINARY(512) NOT NULL COMMENT 'AES-256-GCM encrypted TOTP secret',
  enc_key_version INT UNSIGNED NOT NULL,
  role ENUM('owner','operator') NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS admin_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_id INT UNSIGNED NOT NULL,
  family_id BINARY(16) NOT NULL COMMENT 'refresh token family for reuse detection',
  token_hash BINARY(32) NOT NULL COMMENT 'SHA-256 of the refresh token; raw token only in cookie',
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  last_used_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_sessions_hash (token_hash),
  KEY ix_admin_sessions_family (family_id),
  KEY ix_admin_sessions_admin (admin_id),
  CONSTRAINT fk_admin_sessions_admin FOREIGN KEY (admin_id) REFERENCES admin_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- operations: audit_logs (insert-only), migration_runs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_type ENUM('admin','api_key','system') NOT NULL,
  actor_id VARCHAR(64) NULL COMMENT 'admin id or key prefix',
  action VARCHAR(64) NOT NULL COMMENT 'e.g. tenant.provisioned, key.created',
  tenant_id INT UNSIGNED NULL,
  metadata JSON NULL COMMENT 'identifiers and non-sensitive values only',
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY ix_audit_logs_action (action, created_at),
  KEY ix_audit_logs_tenant (tenant_id, created_at),
  CONSTRAINT fk_audit_logs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS migration_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  version INT UNSIGNED NOT NULL,
  name VARCHAR(191) NOT NULL,
  status ENUM('ok','failed') NOT NULL,
  error VARCHAR(2000) NULL,
  executed_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY ix_migration_runs_tenant (tenant_id, version),
  CONSTRAINT fk_migration_runs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
