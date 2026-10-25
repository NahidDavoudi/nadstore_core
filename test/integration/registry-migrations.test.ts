import { createConnection, type RowDataPacket } from 'mysql2/promise';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runRegistryMigrations } from '../../src/migrations/index.js';
import { testConfig } from '../helpers/env.js';
import { probeMysql, recreateDatabase, type MysqlTestEnv } from '../helpers/mysql.js';

const logger = pino({ level: 'silent' });
const mysqlEnv = await probeMysql();

describe.skipIf(mysqlEnv === null)('registry migrations (mandatory test row 6 foundation)', () => {
  let env: MysqlTestEnv;

  beforeAll(() => {
    env = mysqlEnv as MysqlTestEnv;
  });

  it('applies 001 on a fresh database and creates all 12 tables', async () => {
    const dbName = 'nad_registry_test';
    await recreateDatabase(env, dbName);
    const config = testConfig({
      REGISTRY_DB_NAME: dbName,
      REGISTRY_DB_USER: env.user,
      REGISTRY_DB_PASSWORD: env.password,
      PROV_DB_USER: env.user,
      PROV_DB_PASSWORD: env.password,
    });

    const result = await runRegistryMigrations(config, logger, {});
    expect(result.applied.map((file) => file.version)).toEqual([1]);
    expect(result.pending).toHaveLength(0);

    const conn = await createConnection({ host: env.host, port: env.port, user: env.user, password: env.password, database: dbName });
    try {
      const [tables] = await conn.query<RowDataPacket[]>('SHOW TABLES');
      const names = tables.map((row) => Object.values(row)[0] as string).sort();
      expect(names).toEqual(
        [
          'admin_sessions',
          'admin_users',
          'api_keys',
          'audit_logs',
          'jobs',
          'migration_runs',
          'plans',
          'schema_migrations',
          'tenant_domains',
          'tenant_services',
          'tenants',
          'usage_counters',
        ].sort(),
      );
    } finally {
      await conn.end();
    }
  });

  it('is idempotent: a second run applies nothing', async () => {
    const dbName = 'nad_registry_test';
    const config = testConfig({
      REGISTRY_DB_NAME: dbName,
      REGISTRY_DB_USER: env.user,
      REGISTRY_DB_PASSWORD: env.password,
      PROV_DB_USER: env.user,
      PROV_DB_PASSWORD: env.password,
    });

    const second = await runRegistryMigrations(config, logger, {});
    expect(second.applied).toHaveLength(0);
    expect(second.pending).toHaveLength(0);
  });

  it('dry-run lists pending files without applying them', async () => {
    const dbName = 'nad_registry_dryrun_test';
    await recreateDatabase(env, dbName);
    const config = testConfig({
      REGISTRY_DB_NAME: dbName,
      REGISTRY_DB_USER: env.user,
      REGISTRY_DB_PASSWORD: env.password,
      PROV_DB_USER: env.user,
      PROV_DB_PASSWORD: env.password,
    });

    const dry = await runRegistryMigrations(config, logger, { dryRun: true });
    expect(dry.applied).toHaveLength(0);
    expect(dry.pending.map((file) => file.version)).toEqual([1]);

    const conn = await createConnection({ host: env.host, port: env.port, user: env.user, password: env.password, database: dbName });
    try {
      const [tables] = await conn.query<RowDataPacket[]>('SHOW TABLES');
      expect(tables).toHaveLength(0); // nothing was applied
    } finally {
      await conn.end();
    }
  });
});

afterAll(async () => {
  // placeholder hook keeps vitest lifecycle explicit
});
