import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { beforeAll, describe, expect, it } from 'vitest';
import { aadForColumn, createCryptoService } from '../../src/crypto/index.js';
import { createRegistryDb, createAuditRepo, createTenantRepo, type RegistryDb } from '../../src/registry/index.js';
import { runRegistryMigrations } from '../../src/migrations/index.js';
import { testConfig } from '../helpers/env.js';
import { probeMysql, recreateDatabase, type MysqlTestEnv } from '../helpers/mysql.js';

const logger = pino({ level: 'silent' });
const mysqlEnv = await probeMysql();

describe.skipIf(mysqlEnv === null)('registry — tenant insert/read with encrypted secret (phase 1 acceptance)', () => {
  let env: MysqlTestEnv;
  let db: RegistryDb;

  beforeAll(async () => {
    env = mysqlEnv as MysqlTestEnv;
    const dbName = 'nad_registry_test';
    await recreateDatabase(env, dbName);
    const config = testConfig({
      REGISTRY_DB_NAME: dbName,
      REGISTRY_DB_USER: env.user,
      REGISTRY_DB_PASSWORD: env.password,
      PROV_DB_USER: env.user,
      PROV_DB_PASSWORD: env.password,
    });
    await runRegistryMigrations(config, logger, {});
    db = createRegistryDb(config, { connectionLimit: 5 });
  });

  it('pooled sessions run in UTC (time_zone +00:00)', async () => {
    const [rows] = await db.pool.query('SELECT @@session.time_zone AS tz');
    const tz = (rows as Array<{ tz: string }>)[0]?.tz;
    expect(tz).toBe('+00:00');
  });

  it('inserts a tenant with an encrypted database password and reads it back', async () => {
    const config = testConfig();
    const crypto = createCryptoService(config.crypto);
    const password = 'shop-db-password-نمونه';

    const tenants = createTenantRepo(db.db);
    const plans = db.db;
    const planResult = await plans
      .insertInto('plans')
      .values({
        code: 'basic',
        name: 'Basic',
        limits: { rate_per_min: 120, sms_monthly: 1000 },
        created_at: new Date(),
      })
      .executeTakeFirstOrThrow();

    const encrypted = crypto.encrypt(password, aadForColumn('tenants.db_password'));
    const tenantId = await tenants.insert({
      slug: 'ghulbazar',
      name: 'غول‌بازار',
      plan_id: Number(planResult.insertId),
      status: 'active',
      db_password_enc: encrypted.blob,
      enc_key_version: encrypted.keyVersion,
      allowed_origins: ['https://ghulbazar.example'],
      created_at: new Date(),
    });
    expect(tenantId).toBeGreaterThan(0);

    const byId = await tenants.findById(tenantId);
    expect(byId).not.toBeNull();
    expect(byId?.slug).toBe('ghulbazar');
    expect(byId?.status).toBe('active');
    const decrypted = crypto.decryptText(byId?.db_password_enc as Buffer, byId?.enc_key_version as number, aadForColumn('tenants.db_password'));
    expect(decrypted).toBe(password);

    const bySlug = await tenants.findBySlug('ghulbazar');
    expect(bySlug?.id).toBe(tenantId);
    expect(await tenants.findBySlug('missing')).toBeNull();
    expect(await tenants.findById(999_999)).toBeNull();
  });

  it('stores plan limits as structured JSON', async () => {
    const row = await db.db.selectFrom('plans').selectAll().where('code', '=', 'basic').executeTakeFirstOrThrow();
    expect(row.limits).toEqual({ rate_per_min: 120, sms_monthly: 1000 });
  });

  it('writes and lists audit entries', async () => {
    const audit = createAuditRepo(db.db);
    const tenants = createTenantRepo(db.db);
    const tenant = await tenants.findBySlug('ghulbazar');

    await audit.insert({
      actor_type: 'system',
      actor_id: null,
      action: 'tenant.provisioned',
      tenant_id: tenant?.id ?? null,
      metadata: { slug: 'ghulbazar', note: 'integration test' },
      created_at: new Date(),
    });
    await audit.insert({
      actor_type: 'system',
      action: 'tenant.provisioning_started',
      metadata: null,
      created_at: new Date(),
    });

    const all = await audit.list({ limit: 10 });
    expect(all.length).toBe(2);
    expect(all[0]?.action).toBe('tenant.provisioning_started'); // newest first

    const filtered = await audit.list({ action: 'tenant.provisioned', tenantId: tenant?.id });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.metadata).toEqual({ slug: 'ghulbazar', note: 'integration test' });
  });

  it('audit repo is insert-only: its source contains no update/delete Kysely calls (mandatory test row 13 foundation)', async () => {
    const repoPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'src',
      'registry',
      'repos',
      'audit.ts',
    );
    const source = await readFile(repoPath, 'utf8');
    expect(source).not.toMatch(/\.updateTable\(/);
    expect(source).not.toMatch(/\.deleteFrom\(/);
    expect(source).not.toMatch(/\.delete\(/);
    expect(source).not.toMatch(/\.update\(/);
  });

  it('closes the pool cleanly', async () => {
    await db.close();
  });
});
