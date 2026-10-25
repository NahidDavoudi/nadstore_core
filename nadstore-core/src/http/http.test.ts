import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { testConfig } from '../../test/helpers/env.js';
import { buildInternalApp, buildPublicApp } from './build-app.js';
import { REQUEST_ID_HEADER } from './request-id.js';

const logger = pino({ level: 'silent' });

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertErrorShape(body: unknown, code: string, requestId: string): void {
  const shaped = body as { error?: { code?: string; message?: string; request_id?: string; details?: unknown[] } };
  expect(shaped.error).toBeDefined();
  expect(shaped.error?.code).toBe(code);
  expect(typeof shaped.error?.message).toBe('string');
  expect(shaped.error?.request_id).toBe(requestId);
  expect(Array.isArray(shaped.error?.details)).toBe(true);
}

describe('public app (phase 0 acceptance surface)', () => {
  it('GET /health answers 200 {"status":"ok"} with no key required', async () => {
    const app = buildPublicApp(testConfig(), logger);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('unknown routes answer the canonical 404 error body', async () => {
    const app = buildPublicApp(testConfig(), logger);
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    assertErrorShape(res.json(), 'not_found', res.headers[REQUEST_ID_HEADER] as string);
    await app.close();
  });

  it('echoes a well-formed X-Request-Id and generates a UUID otherwise', async () => {
    const app = buildPublicApp(testConfig(), logger);
    const echoed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { [REQUEST_ID_HEADER]: 'req-fixed-123456789' },
    });
    expect(echoed.headers[REQUEST_ID_HEADER]).toBe('req-fixed-123456789');

    const generated = await app.inject({ method: 'GET', url: '/health' });
    expect(UUID_PATTERN.test(generated.headers[REQUEST_ID_HEADER] as string)).toBe(true);

    // malformed values are replaced, never trusted blindly
    const junk = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { [REQUEST_ID_HEADER]: 'bad id with spaces!' },
    });
    expect(junk.headers[REQUEST_ID_HEADER]).not.toBe('bad id with spaces!');
    await app.close();
  });
});

describe('internal app — X-Internal-Secret enforcement', () => {
  const config = testConfig();

  it('rejects requests without the secret with a canonical 401', async () => {
    const app = buildInternalApp(config, logger);
    const res = await app.inject({ method: 'GET', url: '/internal/ready' });
    expect(res.statusCode).toBe(401);
    assertErrorShape(res.json(), 'invalid_internal_secret', res.headers[REQUEST_ID_HEADER] as string);
    await app.close();
  });

  it('rejects a wrong secret and accepts the right one', async () => {
    const app = buildInternalApp(config, logger);
    const wrong = await app.inject({
      method: 'GET',
      url: '/internal/ready',
      headers: { 'x-internal-secret': 'x'.repeat(48) },
    });
    expect(wrong.statusCode).toBe(401);

    const ok = await app.inject({
      method: 'GET',
      url: '/internal/ready',
      headers: { 'x-internal-secret': config.internalSecret },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ status: 'ok', registry: 'ok' });
    await app.close();
  });

  it('reports 503 with an injected failing readiness probe', async () => {
    const app = buildInternalApp(config, logger, {
      readiness: async () => false,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/internal/ready',
      headers: { 'x-internal-secret': config.internalSecret },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'unavailable', registry: 'error' });
    await app.close();
  });
});
