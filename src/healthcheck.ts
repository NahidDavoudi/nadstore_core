/**
 * Docker healthcheck probe (dist/healthcheck.js), referenced by
 * docker-compose.yml: `node dist/healthcheck.js [port]`.
 * Exits 0 only when GET /health answers 200 on the public port.
 */
const port = process.argv[2] ?? '3000';

try {
  const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) {
    process.stderr.write(`healthcheck failed: /health answered ${String(res.status)}\n`);
    process.exit(1);
  }
  process.exit(0);
} catch (err) {
  process.stderr.write(`healthcheck failed: ${err instanceof Error ? err.message : 'unknown error'}\n`);
  process.exit(1);
}
