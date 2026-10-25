import { createConnection } from 'mysql2/promise';

export interface MysqlTestEnv {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
}

/**
 * Test-infrastructure credentials come from TEST_DB_* variables (not part of
 * the app config contract). Defaults match a local developer MySQL and the
 * CI service container. When MySQL is unreachable the integration suites
 * skip themselves ("skip-if-no-db" policy); they run for real on the VPS
 * and in CI where a MySQL 8 service exists.
 */
export function readTestMysqlEnv(): MysqlTestEnv {
  return {
    host: process.env['TEST_DB_HOST'] ?? '127.0.0.1',
    port: Number(process.env['TEST_DB_PORT'] ?? '3306'),
    user: process.env['TEST_DB_USER'] ?? 'root',
    password: process.env['TEST_DB_PASSWORD'] ?? '',
  };
}

/** Returns null when MySQL cannot be reached within a short timeout. */
export async function probeMysql(env: MysqlTestEnv = readTestMysqlEnv()): Promise<MysqlTestEnv | null> {
  try {
    const conn = await createConnection({
      host: env.host,
      port: env.port,
      user: env.user,
      password: env.password,
      connectTimeout: 2000,
    });
    await conn.end();
    return env;
  } catch {
    return null;
  }
}

/** Drops and re-creates a test database so suites always start from a clean slate. */
export async function recreateDatabase(env: MysqlTestEnv, name: string): Promise<void> {
  const conn = await createConnection({
    host: env.host,
    port: env.port,
    user: env.user,
    password: env.password,
    multipleStatements: false,
  });
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${name}\``);
    await conn.query(
      `CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
  } finally {
    await conn.end();
  }
}
