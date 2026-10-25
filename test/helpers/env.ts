import { randomBytes } from 'node:crypto';
import { loadConfig, type AppConfig } from '../../src/config/index.js';

/**
 * Builds a fully valid environment map for tests. All secrets are generated
 * at runtime — no real secret ever appears in code or fixtures (section 20,
 * rule 6). Override any variable through `overrides`.
 */
export function buildTestEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const masterKeys = { '1': randomBytes(32).toString('base64') };
  return {
    NODE_ENV: 'test',
    ROLE: 'all',
    LOG_LEVEL: 'error',
    PORT_PUBLIC: '3000',
    PORT_INTERNAL: '3001',
    API_PUBLIC_HOST: 'api.nadstore.test',
    TRUST_PROXY_CIDR: '172.16.0.0/12',

    REGISTRY_DB_HOST: '127.0.0.1',
    REGISTRY_DB_PORT: '3306',
    REGISTRY_DB_NAME: 'nad_registry_test',
    REGISTRY_DB_USER: 'nad_core_app',
    REGISTRY_DB_PASSWORD: 'test-registry-password',

    PROV_DB_USER: 'nad_core_app',
    PROV_DB_PASSWORD: 'test-registry-password',

    SHOP_DB_HOST: '127.0.0.1',
    SHOP_DB_PORT: '3306',

    MASTER_KEYS: JSON.stringify(masterKeys),
    MASTER_KEY_CURRENT: '1',

    INTERNAL_SECRET: randomBytes(32).toString('base64url'),
    ADMIN_JWT_SECRET: randomBytes(32).toString('base64url'),
    ADMIN_ORIGIN: 'https://admin.nadstore.test',

    SHOP_MIGRATIONS_DIR: '/tmp/nadstore-test-shop-migrations',
    MEDIA_DIR: '/tmp/nadstore-test-media',
    MEDIA_BASE_URL: 'https://media.nadstore.test',

    WORKER_CONCURRENCY: '2',
    ...overrides,
  };
}

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig(buildTestEnv(overrides));
}
