#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const binDir = dirname(fileURLToPath(import.meta.url));
const target = join(binDir, '..', 'dist', 'mcp-cli.js');

if (!existsSync(target)) {
  process.stderr.write('gsd-mcp: build output missing. Run `pnpm --filter @opengsd/daemon run build`.\n');
  process.exit(1);
}

await import('../dist/mcp-cli.js');
