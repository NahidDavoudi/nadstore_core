import type { FastifyBaseLogger, FastifyInstance, FastifyTypeProviderDefault } from 'fastify';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

/**
 * Instance shape accepted by shared hook helpers: generic over the concrete
 * logger so both pino instances and Fastify's default logger fit. Helpers run
 * before `withTypeProvider`, so the provider parameter is the default one.
 */
export type SharedAppInstance<TLogger extends FastifyBaseLogger> = FastifyInstance<
  Server<typeof IncomingMessage, typeof ServerResponse>,
  IncomingMessage,
  ServerResponse<IncomingMessage>,
  TLogger,
  FastifyTypeProviderDefault
>;

export const REQUEST_ID_HEADER = 'x-request-id';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

export function isValidRequestId(value: string): boolean {
  return REQUEST_ID_PATTERN.test(value);
}

/**
 * X-Request-Id contract (section 8): generated as a UUID when absent (or when
 * the provided value is unusable), echoed back on every response and attached
 * to every log line. Used together with Fastify's `genReqId` factory.
 */
export function resolveRequestId(incomingHeader: unknown): string {
  if (typeof incomingHeader === 'string' && isValidRequestId(incomingHeader)) {
    return incomingHeader;
  }
  return randomUUID();
}

export function registerRequestIdHooks<TLogger extends FastifyBaseLogger>(
  app: SharedAppInstance<TLogger>,
): void {
  app.addHook('onRequest', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });
}
