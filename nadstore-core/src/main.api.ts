import { createRegistryDb } from './registry/index.js';
import { loadConfig, ConfigError } from './config/index.js';
import { buildLogger } from './logger/index.js';
import { buildInternalApp, buildPublicApp } from './http/index.js';

const SHUTDOWN_GRACE_MS = 10_000;

/**
 * API entry (dist/main.api.js). ROLE=api|all both serve the HTTP surfaces;
 * the inline worker loop of ROLE=all is wired in phase 5 together with the
 * jobs module. Fail-fast on invalid environment with exit code 1 and no
 * secret values in the message (section 17).
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
  const registry = createRegistryDb(config, { connectionLimit: 10 });

  const readiness = async (): Promise<boolean> => {
    try {
      await registry.pool.query('SELECT 1');
      return true;
    } catch (err) {
      logger.debug({ err }, 'registry readiness probe failed');
      return false;
    }
  };

  const publicApp = buildPublicApp(config, logger);
  const internalApp = buildInternalApp(config, logger, { readiness });

  await publicApp.listen({ port: config.ports.public, host: '0.0.0.0' });
  await internalApp.listen({ port: config.ports.internal, host: '0.0.0.0' });
  logger.info(
    { public_port: config.ports.public, internal_port: config.ports.internal, role: config.role },
    'core api started',
  );

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    const forceExit = setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS);
    void Promise.allSettled([publicApp.close(), internalApp.close(), registry.close()])
      .then(() => {
        clearTimeout(forceExit);
        process.exitCode = 0;
      })
      .finally(() => {
        /* event loop drains via pool.end() */
      });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void main();
