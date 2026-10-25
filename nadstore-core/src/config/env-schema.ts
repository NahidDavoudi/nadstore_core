import { Type, type Static } from '@sinclair/typebox';

/**
 * Raw environment contract (architecture document, section 17).
 * The ONLY schema allowed to describe process.env; values arrive as strings
 * and are converted/validated with TypeBox before the app can start.
 */
export const EnvSchema = Type.Object({
  NODE_ENV: Type.Union([Type.Literal('development'), Type.Literal('test'), Type.Literal('production')]),

  ROLE: Type.Union([Type.Literal('all'), Type.Literal('api'), Type.Literal('worker')], { default: 'all' }),

  LOG_LEVEL: Type.Union(
    [
      Type.Literal('trace'),
      Type.Literal('debug'),
      Type.Literal('info'),
      Type.Literal('warn'),
      Type.Literal('error'),
      Type.Literal('fatal'),
    ],
    { default: 'info' },
  ),

  PORT_PUBLIC: Type.Number({ default: 3000, minimum: 1, maximum: 65535 }),
  PORT_INTERNAL: Type.Number({ default: 3001, minimum: 1, maximum: 65535 }),

  API_PUBLIC_HOST: Type.String({ minLength: 1, pattern: '^[a-zA-Z0-9][a-zA-Z0-9.-]*$' }),

  TRUST_PROXY_CIDR: Type.String({ minLength: 1 }),

  REGISTRY_DB_HOST: Type.String({ minLength: 1 }),
  REGISTRY_DB_PORT: Type.Number({ default: 3306, minimum: 1, maximum: 65535 }),
  REGISTRY_DB_NAME: Type.String({ minLength: 1 }),
  REGISTRY_DB_USER: Type.String({ minLength: 1 }),
  REGISTRY_DB_PASSWORD: Type.String(),

  PROV_DB_USER: Type.String({ minLength: 1 }),
  PROV_DB_PASSWORD: Type.String(),

  SHOP_DB_HOST: Type.String({ minLength: 1 }),
  SHOP_DB_PORT: Type.Number({ default: 3306, minimum: 1, maximum: 65535 }),

  MASTER_KEYS: Type.String({ minLength: 1 }),
  MASTER_KEY_CURRENT: Type.String({ minLength: 1 }),

  INTERNAL_SECRET: Type.String({ minLength: 32 }),

  ADMIN_JWT_SECRET: Type.String({ minLength: 32 }),
  ADMIN_ORIGIN: Type.String({ minLength: 1, pattern: '^https?://[a-zA-Z0-9][a-zA-Z0-9.:-]*$' }),

  SHOP_MIGRATIONS_DIR: Type.String({ default: '/app/shop-migrations' }),

  MEDIA_DIR: Type.String({ default: '/data/media' }),
  MEDIA_BASE_URL: Type.String({ minLength: 1, pattern: '^https?://[a-zA-Z0-9][a-zA-Z0-9.:-]*$' }),

  WORKER_CONCURRENCY: Type.Number({ default: 5, minimum: 1, maximum: 64 }),
});

export type EnvRaw = Static<typeof EnvSchema>;
