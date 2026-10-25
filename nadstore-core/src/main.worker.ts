import { loadConfig, ConfigError } from './config/index.js';
import { buildLogger } from './logger/index.js';

/**
 * Worker entry (dist/main.worker.js). The MySQL-backed job loop (claim with
 * FOR UPDATE SKIP LOCKED, backoff, reaper) lands in phase 5 together with the
 * jobs module; until then the process stays alive, consumes no work and
 * exits cleanly on SIGTERM.
 */
async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    process.stderr.write(
      err instanceof ConfigError
        ? `startup failed: ${err.message}\n`
        : 'startup failed: could not load configuration\n',
    );
    process.exitCode = 1;
    return;
  }

  const logger = buildLogger(config);
  logger.info({ role: config.role, concurrency: config.workerConcurrency }, 'worker started (idle: job loop arrives in phase 5)');

  const heartbeat = setInterval(() => {
    logger.debug('worker heartbeat');
  }, 60_000);

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'worker shutting down');
    clearInterval(heartbeat);
    process.exitCode = 0;
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void main();
