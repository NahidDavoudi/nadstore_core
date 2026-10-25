import { runRegistryMigrations } from './migrations/index.js';
import { loadConfig, ConfigError } from './config/index.js';
import { buildLogger } from './logger/index.js';

const USAGE = `nadstore-core CLI

Usage: node dist/main.cli.js <command> [options]

Commands:
  migrate:registry [--dry-run]   Apply pending registry migrations (provisioner user)
`;

function printUsage(): void {
  process.stdout.write(USAGE);
}

interface CliResult {
  readonly ok: boolean;
}

async function run(args: readonly string[]): Promise<CliResult> {
  const command = args[0];

  if (command === undefined || command === '--help' || command === '-h') {
    printUsage();
    return { ok: true };
  }

  if (command === 'migrate:registry') {
    const dryRun = args.includes('--dry-run');
    const config = loadConfig();
    const logger = buildLogger(config);
    const result = await runRegistryMigrations(config, logger, { dryRun });
    for (const file of result.pending) {
      process.stdout.write(`pending  ${file.version} ${file.name}\n`);
    }
    if (dryRun) {
      process.stdout.write(`dry-run: ${result.pending.length} pending migration(s), nothing applied\n`);
    } else {
      for (const file of result.applied) {
        process.stdout.write(`applied  ${file.version} ${file.name}\n`);
      }
      process.stdout.write(`done: ${result.applied.length} applied, ${result.pending.length} already up to date\n`);
    }
    return { ok: true };
  }

  process.stderr.write(`unknown command: ${command}\n\n`);
  printUsage();
  return { ok: false };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  try {
    const result = await run(args);
    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`startup failed: ${err.message}\n`);
    } else if (err instanceof Error) {
      process.stderr.write(`command failed: ${err.message}\n`);
    } else {
      process.stderr.write('command failed with an unknown error\n');
    }
    process.exitCode = 1;
  }
}

void main();
