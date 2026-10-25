import { createConnection, type RowDataPacket } from 'mysql2/promise';
import type { AppConfig } from '../config/index.js';
import type { Logger } from '../logger/index.js';
import { bundledRegistryMigrationsDir, listMigrationFiles, readMigrationFile } from './files.js';

const LOCK_NAME = 'nad_migrate_registry';
const LOCK_TIMEOUT_SECONDS = 10;

export interface RegistryMigrationFileRef {
  readonly version: number;
  readonly name: string;
}

export interface RegistryMigrationResult {
  readonly applied: readonly RegistryMigrationFileRef[];
  readonly pending: readonly RegistryMigrationFileRef[];
}

/**
 * Registry migration runner (architecture document, section 15):
 *  1. acquire GET_LOCK('nad_migrate_registry', 10) — fail if not acquired
 *  2. list SQL files, diff against schema_migrations (missing table = fresh db)
 *  3. run each pending file on a dedicated multipleStatements connection
 *  4. record the version after success; on failure stop this scope
 * Runs with the provisioner user, only from the CLI — never from the api process.
 */
export async function runRegistryMigrations(
  config: AppConfig,
  logger: Logger,
  options: { dryRun?: boolean } = {},
): Promise<RegistryMigrationResult> {
  const dir = bundledRegistryMigrationsDir(import.meta.url);
  const files = await listMigrationFiles(dir);

  const connection = await createConnection({
    host: config.registry.host,
    port: config.registry.port,
    user: config.provisioner.user,
    password: config.provisioner.password,
    database: config.registry.name,
    multipleStatements: true,
    charset: 'utf8mb4',
    timezone: 'Z',
  });

  try {
    if (!(await acquireLock(connection))) {
      throw new Error(
        `could not acquire registry migration lock '${LOCK_NAME}' within ${LOCK_TIMEOUT_SECONDS}s`,
      );
    }

    try {
      const appliedVersions = await readAppliedVersions(connection);
      const pending = files.filter((file) => !appliedVersions.has(file.version));

      if (options.dryRun === true) {
        return { applied: [], pending: pending.map(toRef) };
      }

      const applied: RegistryMigrationFileRef[] = [];
      for (const file of pending) {
        const sql = await readMigrationFile(file);
        // DDL is not transactional in MySQL — each file must stay small and
        // as idempotent as possible (section 15).
        await connection.query(sql);
        await connection.query(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, UTC_TIMESTAMP(3))',
          [file.version, file.name],
        );
        logger.info(
          { version: file.version, name: file.name, scope: 'registry' },
          'registry migration applied',
        );
        applied.push(toRef(file));
      }

      return { applied, pending: [] };
    } finally {
      await connection.query(`SELECT RELEASE_LOCK('${LOCK_NAME}')`);
    }
  } finally {
    await connection.end();
  }
}

function toRef(file: { version: number; name: string }): RegistryMigrationFileRef {
  return { version: file.version, name: file.name };
}

async function acquireLock(connection: Awaited<ReturnType<typeof createConnection>>): Promise<boolean> {
  const [rows] = await connection.query<RowDataPacket[]>(`SELECT GET_LOCK('${LOCK_NAME}', ${LOCK_TIMEOUT_SECONDS}) AS acquired`);
  const first = rows[0] as { acquired?: number } | undefined;
  return first !== undefined && Number(first.acquired) === 1;
}

async function readAppliedVersions(connection: Awaited<ReturnType<typeof createConnection>>): Promise<Set<number>> {
  try {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT version FROM schema_migrations');
    return new Set(rows.map((row) => Number((row as { version: number }).version)));
  } catch (err) {
    if (isNoSuchTableError(err)) {
      // Fresh database: schema_migrations does not exist yet — every file is pending.
      return new Set();
    }
    throw err;
  }
}

function isNoSuchTableError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'ER_NO_SUCH_TABLE'
  );
}
