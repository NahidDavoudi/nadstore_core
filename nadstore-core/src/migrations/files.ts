import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export interface MigrationFile {
  readonly version: number;
  readonly name: string;
  readonly path: string;
}

const FILE_PATTERN = /^(\d{3})_([a-z0-9_]+)\.sql$/;

/**
 * Lists `NNN_snake_case_name.sql` files sorted by version (section 15).
 * Duplicate or non-conforming names fail fast — the runner never guesses.
 */
export async function listMigrationFiles(dir: string): Promise<MigrationFile[]> {
  const entries = await readdir(dir);
  const files: MigrationFile[] = [];
  for (const entry of entries) {
    const match = FILE_PATTERN.exec(entry);
    if (match === null) {
      throw new Error(`migration file name does not match NNN_snake_case_name.sql: ${entry}`);
    }
    const version = Number(match[1]);
    const name = `${match[1]}_${match[2]}`;
    if (files.some((existing) => existing.version === version)) {
      throw new Error(`duplicate migration version ${version}`);
    }
    files.push({ version, name, path: path.join(dir, entry) });
  }
  files.sort((a, b) => a.version - b.version);
  return files;
}

export async function readMigrationFile(file: MigrationFile): Promise<string> {
  return readFile(file.path, 'utf8');
}

/**
 * Resolves the bundled migrations directory relative to this module, so it
 * works identically under tsx (src/) and from the compiled dist/ in Docker.
 */
export function bundledRegistryMigrationsDir(moduleUrl: string): string {
  return fileURLToPath(new URL('../../migrations/registry/', moduleUrl));
}
