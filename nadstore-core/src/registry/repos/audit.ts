import type { Kysely, Selectable } from 'kysely';
import type { ActorType, AuditLogRow, RegistryDatabase } from '../types.js';

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export interface NewAuditEntry {
  readonly actor_type: ActorType;
  readonly actor_id?: string | null;
  readonly action: string;
  readonly tenant_id?: number | null;
  readonly metadata?: Record<string, unknown> | null;
  readonly created_at: Date;
}

export interface AuditListFilter {
  readonly action?: string;
  readonly tenantId?: number;
  readonly limit?: number;
}

export interface AuditRepo {
  insert(entry: NewAuditEntry): Promise<void>;
  list(filter?: AuditListFilter): Promise<Selectable<AuditLogRow>[]>;
}

/**
 * Insert-only audit trail (architecture document, sections 5 and 16):
 * this repo exposes no update or delete — a dedicated test enforces it.
 */
export function createAuditRepo(db: Kysely<RegistryDatabase>): AuditRepo {
  return {
    async insert(entry) {
      await db
        .insertInto('audit_logs')
        .values({
          actor_type: entry.actor_type,
          actor_id: entry.actor_id ?? null,
          action: entry.action,
          tenant_id: entry.tenant_id ?? null,
          metadata: entry.metadata ?? null,
          created_at: entry.created_at,
        })
        .execute();
    },

    async list(filter = {}) {
      const limit = Math.min(filter.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
      let query = db
        .selectFrom('audit_logs')
        .selectAll()
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(limit);
      if (filter.action !== undefined) {
        query = query.where('action', '=', filter.action);
      }
      if (filter.tenantId !== undefined) {
        query = query.where('tenant_id', '=', filter.tenantId);
      }
      return query.execute();
    },
  };
}
