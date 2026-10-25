/**
 * Error codes of the public error contract (architecture document, section 8)
 * plus internal-surface extensions (see DECISIONS.md D6).
 */
export const ERROR_CODES = [
  'validation_failed',
  'invalid_key',
  'tenant_suspended',
  'forbidden_scope',
  'origin_not_allowed',
  'service_disabled',
  'not_found',
  'conflict',
  'rate_limited',
  'quota_exceeded',
  'provider_error',
  'internal_error',
  'invalid_internal_secret',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  validation_failed: 400,
  invalid_key: 401,
  tenant_suspended: 403,
  forbidden_scope: 403,
  origin_not_allowed: 403,
  service_disabled: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  quota_exceeded: 429,
  provider_error: 502,
  internal_error: 500,
  invalid_internal_secret: 401,
};

/** Base class for every expected error (architecture document, section 20). */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly details: readonly unknown[];

  public constructor(code: ErrorCode, message: string, details: readonly unknown[] = []) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = HTTP_STATUS[code];
    this.details = details;
  }

  public static notFound(): AppError {
    // Owned-by-other-tenant and missing resources share exactly one response.
    return new AppError('not_found', 'resource not found');
  }

  public static validation(details: readonly unknown[]): AppError {
    return new AppError('validation_failed', 'request validation failed', details);
  }

  public static internal(message = 'internal error'): AppError {
    return new AppError('internal_error', message);
  }
}

export interface ErrorBody {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly request_id: string;
    readonly details: readonly unknown[];
  };
}

export function buildErrorBody(
  code: ErrorCode,
  message: string,
  requestId: string,
  details: readonly unknown[] = [],
): ErrorBody {
  return { error: { code, message, request_id: requestId, details } };
}
