import { Value } from '@sinclair/typebox/value';
import { EnvSchema, type EnvRaw } from './env-schema.js';

export class ConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export type EnvName = 'development' | 'test' | 'production';
export type Role = 'all' | 'api' | 'worker';
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface AppConfig {
  readonly env: EnvName;
  readonly role: Role;
  readonly logLevel: LogLevel;
  readonly ports: { readonly public: number; readonly internal: number };
  readonly apiPublicHost: string;
  readonly trustProxyCidrs: readonly string[];
  readonly registry: {
    readonly host: string;
    readonly port: number;
    readonly name: string;
    readonly user: string;
    readonly password: string;
  };
  readonly provisioner: { readonly user: string; readonly password: string };
  readonly shopDb: { readonly host: string; readonly port: number };
  readonly crypto: {
    readonly masterKeys: ReadonlyMap<number, Buffer>;
    readonly currentVersion: number;
  };
  readonly internalSecret: string;
  readonly admin: { readonly jwtSecret: string; readonly origin: string };
  readonly shopMigrationsDir: string;
  readonly media: { readonly dir: string; readonly baseUrl: string };
  readonly workerConcurrency: number;
}

const CIDR_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;

/** Validates and converts the MASTER_KEYS / MASTER_KEY_CURRENT pair. Never leaks key material into error messages. */
function parseMasterKeys(raw: string, currentRaw: string): {
  masterKeys: ReadonlyMap<number, Buffer>;
  currentVersion: number;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new ConfigError(
      'MASTER_KEYS: must be a JSON object mapping numeric versions to base64-encoded 32-byte keys',
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError('MASTER_KEYS: must be a JSON object mapping numeric versions to base64 keys');
  }

  const masterKeys = new Map<number, Buffer>();
  for (const [version, value] of Object.entries(parsed)) {
    if (!/^\d+$/.test(version)) {
      throw new ConfigError('MASTER_KEYS: version keys must be plain numeric strings');
    }
    if (typeof value !== 'string') {
      throw new ConfigError(`MASTER_KEYS: entry for version ${version} must be a base64 string`);
    }
    const key = Buffer.from(value, 'base64');
    if (key.length !== 32) {
      throw new ConfigError(`MASTER_KEYS: entry for version ${version} must decode to exactly 32 bytes`);
    }
    masterKeys.set(Number(version), key);
  }
  if (masterKeys.size === 0) {
    throw new ConfigError('MASTER_KEYS: must contain at least one key version');
  }

  if (!/^\d+$/.test(currentRaw)) {
    throw new ConfigError('MASTER_KEY_CURRENT: must be a numeric version string');
  }
  const currentVersion = Number(currentRaw);
  if (!masterKeys.has(currentVersion)) {
    throw new ConfigError('MASTER_KEY_CURRENT: does not match any version present in MASTER_KEYS');
  }

  return { masterKeys, currentVersion };
}

function parseTrustProxyCidrs(raw: string): string[] {
  const cidrs = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (cidrs.length === 0) {
    throw new ConfigError('TRUST_PROXY_CIDR: at least one CIDR is required');
  }
  for (const cidr of cidrs) {
    if (!CIDR_PATTERN.test(cidr)) {
      throw new ConfigError(`TRUST_PROXY_CIDR: value is not a valid IPv4 CIDR (got "${cidr}")`);
    }
  }
  return cidrs;
}

function validateSecretByteLength(name: string, value: string): void {
  if (Buffer.byteLength(value, 'utf8') < 32) {
    throw new ConfigError(`${name}: must be at least 32 bytes long`);
  }
}

/**
 * Loads and validates the environment into a typed AppConfig.
 * This module is the single place in the whole codebase allowed to touch
 * process.env (architecture document, section 3 code rules).
 * Error messages describe what is wrong — they never echo secret values.
 */
export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const picked: Record<string, string | undefined> = {};
  for (const key of Object.keys(EnvSchema.properties)) {
    picked[key] = source[key];
  }

  const withDefaults = Value.Default(EnvSchema, picked as Partial<EnvRaw>);
  const converted = Value.Convert(EnvSchema, withDefaults) as unknown;

  if (!Value.Check(EnvSchema, converted)) {
    const problems = [...Value.Errors(EnvSchema, converted)]
      .map((err) => {
        const path = err.path.replace(/^\//, '');
        return `- ${path}: ${err.message}`;
      })
      .join('\n');
    throw new ConfigError(`invalid environment:\n${problems}`);
  }

  const env = converted as EnvRaw;

  validateSecretByteLength('INTERNAL_SECRET', env.INTERNAL_SECRET);
  validateSecretByteLength('ADMIN_JWT_SECRET', env.ADMIN_JWT_SECRET);

  const { masterKeys, currentVersion } = parseMasterKeys(env.MASTER_KEYS, env.MASTER_KEY_CURRENT);
  const trustProxyCidrs = parseTrustProxyCidrs(env.TRUST_PROXY_CIDR);

  return Object.freeze({
    env: env.NODE_ENV,
    role: env.ROLE,
    logLevel: env.LOG_LEVEL,
    ports: Object.freeze({ public: env.PORT_PUBLIC, internal: env.PORT_INTERNAL }),
    apiPublicHost: env.API_PUBLIC_HOST,
    trustProxyCidrs: Object.freeze(trustProxyCidrs),
    registry: Object.freeze({
      host: env.REGISTRY_DB_HOST,
      port: env.REGISTRY_DB_PORT,
      name: env.REGISTRY_DB_NAME,
      user: env.REGISTRY_DB_USER,
      password: env.REGISTRY_DB_PASSWORD,
    }),
    provisioner: Object.freeze({
      user: env.PROV_DB_USER,
      password: env.PROV_DB_PASSWORD,
    }),
    shopDb: Object.freeze({ host: env.SHOP_DB_HOST, port: env.SHOP_DB_PORT }),
    crypto: Object.freeze({ masterKeys, currentVersion }),
    internalSecret: env.INTERNAL_SECRET,
    admin: Object.freeze({ jwtSecret: env.ADMIN_JWT_SECRET, origin: env.ADMIN_ORIGIN }),
    shopMigrationsDir: env.SHOP_MIGRATIONS_DIR,
    media: Object.freeze({ dir: env.MEDIA_DIR, baseUrl: env.MEDIA_BASE_URL }),
    workerConcurrency: env.WORKER_CONCURRENCY,
  });
}
