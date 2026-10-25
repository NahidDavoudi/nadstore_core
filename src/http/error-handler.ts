import type { FastifyBaseLogger } from 'fastify';
import { AppError, buildErrorBody } from './app-error.js';
import type { SharedAppInstance } from './request-id.js';

interface FastifyValidationItem {
  readonly instancePath?: string;
  readonly message?: string;
}

interface FastifyErrorLike {
  readonly message?: string;
  readonly stack?: string;
  readonly name?: string;
  readonly statusCode?: number;
  readonly validation?: readonly FastifyValidationItem[];
}

/**
 * One error body shape for every route (architecture document, section 8):
 * { "error": { "code", "message", "request_id", "details" } }.
 * Unknown errors never leak stack traces, SQL or file paths in the response —
 * details go to the log only.
 */
export function registerErrorHandler<TLogger extends FastifyBaseLogger>(
  app: SharedAppInstance<TLogger>,
  logger: TLogger,
): void {
  app.setErrorHandler((rawError, request, reply) => {
    const err = rawError as FastifyErrorLike;

    if (rawError instanceof AppError) {
      reply
        .status(rawError.httpStatus)
        .send(buildErrorBody(rawError.code, rawError.message, request.id, rawError.details));
      return;
    }

    if (err.validation !== undefined) {
      const details = err.validation.map((item) => ({
        path: item.instancePath ?? '',
        message: item.message ?? 'invalid value',
      }));
      reply
        .status(400)
        .send(buildErrorBody('validation_failed', 'request validation failed', request.id, details));
      return;
    }

    const status = err.statusCode ?? 500;
    if (status === 429) {
      reply.status(429).send(buildErrorBody('rate_limited', 'rate limit exceeded', request.id));
      return;
    }
    if (status === 413) {
      reply
        .status(413)
        .send(buildErrorBody('validation_failed', 'body size limit exceeded', request.id));
      return;
    }

    logger.error(
      {
        err: {
          name: err.name ?? 'Error',
          message: err.message ?? 'unknown error',
          stack: err.stack,
        },
        request_id: request.id,
        route: request.routeOptions?.url,
      },
      'unhandled error',
    );
    reply.status(500).send(buildErrorBody('internal_error', 'internal error', request.id));
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(buildErrorBody('not_found', 'resource not found', request.id));
  });
}
