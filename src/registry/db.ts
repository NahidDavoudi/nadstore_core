import { Kysely, MysqlDialect } from 'kysely';
import { createPool, type Pool } from 'mysql2/promise';
import type { AppConfig } from '../config/index.js';
import type { RegistryDatabase } from './types.js';

export interface RegistryDb {
  readonly db: Kysely<RegistryDatabase>;
  readonly pool: Pool;
  close(): Promise<void>;
}

export interface RegistryDbOptions {
  /** 10 for api, 5 for worker (architecture document, section 5). */
  readonly connectionLimit?: number;
}

/**
 * Registry pool + Kysely instance. Only the registry, provisioning and
 * migrations modules are allowed to import kysely/mysql2 — every other module
 * reaches the registry through this one (section 4 boundary rules).
 */
export function createRegistryDb(config: AppConfig, options: RegistryDbOptions = {}): RegistryDb {
  const pool = createPool({
    host: config.registry.host,
    port: config.registry.port,
    user: config.registry.user,
    password: config.registry.password,
    database: config.registry.name,
    timezone: 'Z',
    charset: 'utf8mb4',
    supportBigNumbers: true,
    bigNumberStrings: false,
    connectionLimit: options.connectionLimit ?? 10,
  });

  // Every pooled connection pins its session clock to UTC (section 5).
  pool.on('connection', (conn) => {
    void conn.query("SET time_zone = '+00:00'");
  });

  const db = new Kysely<RegistryDatabase>({
    dialect: new MysqlDialect({ pool }),
  });

  return {
    db,
    pool,
    close: async () => {
      await db.destroy();
      await pool.end();
    },
  };
}
