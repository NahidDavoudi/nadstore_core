import type { Generated } from 'kysely';

/**
 * Hand-written row types, one per registry table — kept in exact sync with
 * migrations/registry/001_registry_init.sql (architecture document, section 5):
 * BINARY -> Buffer, DATETIME -> Date (UTC), JSON -> concrete TS types.
 * Property names intentionally use snake_case so they mirror the SQL columns
 * (see DECISIONS.md D5).
 */

export type TenantStatus = 'provisioning' | 'active' | 'suspended' | 'archived';
export type ApiKeyType = 'publishable' | 'secret';
export type JobStatus = 'pending' | 'running' | 'done' | 'failed';
export type AdminRole = 'owner' | 'operator';
export type ActorType = 'admin' | 'api_key' | 'system';
export type MigrationRunStatus = 'ok' | 'failed';

export interface PlanRow {
  id: Generated<number>;
  code: string;
  name: string;
  limits: Record<string, number>;
  created_at: Date;
  updated_at: Date | null;
}

export interface TenantRow {
  id: Generated<number>;
  slug: string;
  name: string;
  plan_id: number;
  status: TenantStatus;
  db_password_enc: Buffer;
  enc_key_version: number;
  schema_version: number | null;
  allowed_origins: string[] | null;
  created_at: Date;
  updated_at: Date | null;
}

export interface TenantDomainRow {
  id: Generated<number>;
  tenant_id: number;
  domain: string;
  kind: string;
  is_primary: 0 | 1;
  verified_at: Date | null;
  created_at: Date;
}

export interface ApiKeyRow {
  id: Generated<number>;
  tenant_id: number;
  prefix: string;
  key_hash: Buffer;
  type: ApiKeyType;
  label: string | null;
  scopes: string[];
  last_used_at: Date | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

export interface TenantServiceRow {
  id: Generated<number>;
  tenant_id: number;
  service: string;
  enabled: 0 | 1;
  config_enc: Buffer | null;
  enc_key_version: number | null;
  created_at: Date;
  updated_at: Date | null;
}

export interface UsageCounterRow {
  id: Generated<number>;
  tenant_id: number;
  service: string;
  period: string;
  used: number;
  limit_snapshot: number | null;
  updated_at: Date | null;
}

export interface JobRow {
  id: Generated<number>;
  tenant_id: number;
  type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  run_at: Date;
  attempts: number;
  max_attempts: number;
  locked_by: string | null;
  locked_until: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date | null;
}

export interface AdminUserRow {
  id: Generated<number>;
  email: string;
  password_hash: string;
  totp_secret_enc: Buffer;
  enc_key_version: number;
  role: AdminRole;
  created_at: Date;
  updated_at: Date | null;
}

export interface AdminSessionRow {
  id: Generated<number>;
  admin_id: number;
  family_id: Buffer;
  token_hash: Buffer;
  expires_at: Date;
  revoked_at: Date | null;
  last_used_at: Date | null;
  created_at: Date;
}

export interface AuditLogRow {
  id: Generated<number>;
  actor_type: ActorType;
  actor_id: string | null;
  action: string;
  tenant_id: number | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export interface MigrationRunRow {
  id: Generated<number>;
  tenant_id: number;
  version: number;
  name: string;
  status: MigrationRunStatus;
  error: string | null;
  executed_at: Date;
}

export interface RegistryDatabase {
  plans: PlanRow;
  tenants: TenantRow;
  tenant_domains: TenantDomainRow;
  api_keys: ApiKeyRow;
  tenant_services: TenantServiceRow;
  usage_counters: UsageCounterRow;
  jobs: JobRow;
  admin_users: AdminUserRow;
  admin_sessions: AdminSessionRow;
  audit_logs: AuditLogRow;
  migration_runs: MigrationRunRow;
  schema_migrations: {
    version: number;
    name: string;
    applied_at: Date;
  };
}
