import pino from 'pino';
import type { AppConfig } from '../config/index.js';

/**
 * Redaction list from the architecture document (section 14). Anything under
 * these paths is replaced with "[redacted]" before it reaches the log stream.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-api-key"]',
  'req.headers["x-internal-secret"]',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  'token',
  'secret',
  'botToken',
  'apiKey',
  '*.password',
  '*.token',
  '*.secret',
  '*.botToken',
  '*.apiKey',
  'err.password',
  'err.token',
  'err.secret',
  'err.botToken',
  'err.apiKey',
];

export type Logger = pino.Logger;

export function buildLogger(config: AppConfig): Logger {
  return pino({
    level: config.logLevel,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    base: { service: 'nadstore-core', role: config.role, env: config.env },
    // pino-pretty is a dev-only dependency and must never load in production.
    ...(config.env === 'development'
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' } } }
      : {}),
  });
}
