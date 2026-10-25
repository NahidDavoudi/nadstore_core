#!/usr/bin/env node
// Mandatory acceptance check for phase 0 (architecture document, section 18):
// "a file that deliberately breaks the module boundary must fail lint".
// Creates a temporary violating file (config importing http), runs ESLint on
// it and expects a non-zero exit code. Cleans up afterwards.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const fixtureRel = path.join('src', 'config', 'boundary-violation.tmp.ts');
const fixtureAbs = path.join(repoRoot, fixtureRel);

const FIXTURE_SOURCE = [
  '// Temporary fixture created by scripts/check-boundaries.mjs — safe to delete.',
  "import { buildPublicApp } from '../http/index.js';",
  'export const violatingExport = buildPublicApp;',
  '',
].join('\n');

/** @returns true when eslint exited 0 (violation NOT detected). */
function runEslint(file) {
  try {
    execFileSync(
      process.execPath,
      ['node_modules/eslint/bin/eslint.js', file],
      { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return true;
  } catch (err) {
    if (err !== null && typeof err === 'object' && 'status' in err) {
      return false; // eslint exited non-zero — violation detected
    }
    throw err;
  }
}

mkdirSync(path.dirname(fixtureAbs), { recursive: true });
writeFileSync(fixtureAbs, FIXTURE_SOURCE);

let ok = false;
try {
  const passed = runEslint(fixtureAbs);
  if (passed) {
    process.stderr.write(
      `FAIL: boundary violation was NOT detected in ${fixtureRel} — the eslint boundary rules are not effective.\n`,
    );
  } else {
    process.stdout.write('OK: deliberately broken module boundary failed lint as required.\n');
    ok = true;
  }
} finally {
  rmSync(fixtureAbs, { force: true });
}

process.exit(ok ? 0 : 1);
