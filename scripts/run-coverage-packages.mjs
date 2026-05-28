#!/usr/bin/env node
/**
 * Run package tests under c8 and write coverage/packages/lcov.info
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getLinkablePackages } = require('./lib/workspace-manifest.cjs');
const { findDistTestFiles } = require('./run-package-tests.cjs');

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const REPORT_DIR = join(ROOT, 'coverage/packages');

function main() {
  const compile = spawnSync('pnpm', ['run', 'test:compile'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if ((compile.status ?? 1) !== 0) process.exit(compile.status ?? 1);

  const testFiles = [];
  for (const pkg of getLinkablePackages()) {
    if (pkg.packageName === '@gsd/native') continue;
    testFiles.push(...findDistTestFiles(pkg.path));
  }

  if (testFiles.length === 0) {
    process.stderr.write('No package test files found.\n');
    process.exit(1);
  }

  mkdirSync(REPORT_DIR, { recursive: true });
  const c8Bin = join(ROOT, 'node_modules/c8/bin/c8.js');
  const result = spawnSync(
    process.execPath,
    [
      c8Bin,
      '--reporter=lcovonly',
      `--report-dir=${REPORT_DIR}`,
      '--temp-directory', join(ROOT, 'coverage/.tmp-packages'),
      '--exclude=**/*.test.*',
      '--exclude=**/tests/**',
      '--exclude=**/test/**',
      '--all',
      '--',
      process.execPath,
      '--test',
      ...testFiles,
    ],
    { cwd: ROOT, stdio: 'inherit' },
  );

  process.exit(result.status ?? 1);
}

main();
