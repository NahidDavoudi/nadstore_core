import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { Type, type Static } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify from 'fastify';
import type { AppConfig } from '../config/index.js';
import { safeEqual } from '../crypto/index.js';
import type { Logger } from '../logger/index.js';
import { AppError } from './app-error.js';
import { registerErrorHandler } from './error-handler.js';
import { registerRequestIdHooks, resolveRequestId } from './request-id.js';

const BODY_LIMIT_BYTES = 1024 * 1024; // 1 MB for every route (section 16)

const HealthResponse = Type.Object({ status: Type.Literal('ok') }, { additionalProperties: false });
type HealthResponse = Static<typeof HealthResponse>;

const ReadyResponse = Type.Object(
  { status: Type.Union([Type.Literal('ok'), Type.Literal('unavailable')]), registry: Type.String() },
  { additionalProperties: false },
);

export interface AppDeps {
  /** Registry connectivity probe used by GET /internal/ready; defaults to healthy. */
  readonly readiness?: () => Promise<boolean>;
}

interface RawRequestLike {
  headers: Record<string, unknown>;
}

function baseFastifyOptions(config: AppConfig, logger: Logger, trustProxyEnabled: boolean) {
  // trustProxy must be a mutable string[] (or false); Nginx sits in front of the
  // public surface, so X-Forwarded-For is only trusted from the Docker subnet.
  const trustProxy: string[] | false = trustProxyEnabled ? [...config.trustProxyCidrs] : false;
  return {
    loggerInstance: logger,
    bodyLimit: BODY_LIMIT_BYTES,
    trustProxy,
    genReqId: (req: RawRequestLike) => resolveRequestId(req.headers['x-request-id']),
  };
}

/**
 * Public surface on PORT_PUBLIC: /health, /v1/*, /hooks/* and /admin/*.
 * Nginx terminates TLS in front of it; trustProxy is limited to the Docker
 * network subnet so X-Forwarded-For cannot be spoofed from outside.
 */
export function buildPublicApp(config: AppConfig, logger: Logger, _deps: AppDeps = {}) {
  const app = Fastify(baseFastifyOptions(config, logger, true));

  app.register(helmet);
  app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });

  registerRequestIdHooks(app);
  registerErrorHandler(app, logger);

  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  typed.get(
    '/health',
    { schema: { response: { 200: HealthResponse } } },
    async (): Promise<HealthResponse> => ({ status: 'ok' }),
  );

  return app;
}

/**
 * Internal surface on PORT_INTERNAL — reachable only inside the Docker
 * network; every route requires X-Internal-Secret compared in constant time
 * (architecture document, section 7).
 */
export function buildInternalApp(config: AppConfig, logger: Logger, deps: AppDeps = {}) {
  const readiness = deps.readiness ?? (async () => true);
  const app = Fastify(baseFastifyOptions(config, logger, false));

  // Request-id hooks must run before any hook that can fail the request,
  // so the response always carries X-Request-Id (section 8).
  registerRequestIdHooks(app);

  app.addHook('onRequest', async (request, _reply) => {
    const provided = request.headers['x-internal-secret'];
    if (typeof provided !== 'string' || !safeEqual(provided, config.internalSecret)) {
      throw new AppError('invalid_internal_secret', 'missing or invalid internal secret');
    }
  });

  registerErrorHandler(app, logger);

  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  typed.get(
    '/internal/ready',
    { schema: { response: { 200: ReadyResponse, 503: ReadyResponse } } },
    async (_request, reply): Promise<Static<typeof ReadyResponse>> => {
      const healthy = await readiness();
      if (!healthy) {
        reply.status(503);
        return { status: 'unavailable', registry: 'error' };
      }
      return { status: 'ok', registry: 'ok' };
    },
  );

  return app;
}
