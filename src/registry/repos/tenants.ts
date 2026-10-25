import type { Kysely, Selectable } from 'kysely';
import type { RegistryDatabase, TenantRow, TenantStatus } from '../types.js';

export interface NewTenantRow {
  readonly slug: string;
  readonly name: string;
  readonly plan_id: number;
  readonly status: TenantStatus;
  readonly db_password_enc: Buffer;
  readonly enc_key_version: number;
  readonly schema_version?: number | null;
  readonly allowed_origins?: string[] | null;
  readonly created_at: Date;
}

export interface TenantRepo {
  insert(tenant: NewTenantRow): Promise<number>;
  findById(id: number): Promise<Selectable<TenantRow> | null>;
  findBySlug(slug: string): Promise<Selectable<TenantRow> | null>;
}

export function createTenantRepo(db: Kysely<RegistryDatabase>): TenantRepo {
  return {
    async insert(tenant) {
      const result = await db
        .insertInto('tenants')
        .values({
          slug: tenant.slug,
          name: tenant.name,
          plan_id: tenant.plan_id,
          status: tenant.status,
          db_password_enc: tenant.db_password_enc,
          enc_key_version: tenant.enc_key_version,
          schema_version: tenant.schema_version ?? null,
          allowed_origins: tenant.allowed_origins ?? null,
          created_at: tenant.created_at,
        })
        .executeTakeFirstOrThrow();
      return Number(result.insertId);
    },

    async findById(id) {
      const row = await db.selectFrom('tenants').selectAll().where('id', '=', id).executeTakeFirst();
      return row ?? null;
    },

    async findBySlug(slug) {
      const row = await db
        .selectFrom('tenants')
        .selectAll()
        .where('slug', '=', slug)
        .executeTakeFirst();
      return row ?? null;
    },
  };
}
