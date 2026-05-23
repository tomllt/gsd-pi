/**
 * Minimal Node.js import hook for running tests from dist-test/.
 *
 * esbuild with bundle:false preserves import specifiers verbatim, so compiled
 * .js files still import '../foo.ts'. This hook redirects those to '.js' so
 * Node can find the compiled output.
 *
 * Also redirects @gsd bare imports to their compiled counterparts in dist-test.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const GIT_TEST_ENV_DIR = join(tmpdir(), `gsd-test-git-env-${process.pid}`);
mkdirSync(GIT_TEST_ENV_DIR, { recursive: true });
process.env.GIT_CONFIG_GLOBAL = join(GIT_TEST_ENV_DIR, 'global.gitconfig');
process.env.GIT_CONFIG_SYSTEM = join(GIT_TEST_ENV_DIR, 'system.gitconfig');
const gitTemplateDir = join(GIT_TEST_ENV_DIR, 'templates');
mkdirSync(join(gitTemplateDir, 'hooks'), { recursive: true });
mkdirSync(join(gitTemplateDir, 'info'), { recursive: true });
writeFileSync(join(gitTemplateDir, 'info', 'exclude'), '');
process.env.GIT_TEMPLATE_DIR = gitTemplateDir;

// dist-test root — everything compiled lands here
const DIST_TEST = new URL('../dist-test/', import.meta.url).href;

// Absolute paths to compiled @gsd/* entry points
const GSD_ALIASES = {
  '@gsd/pi-coding-agent': new URL('../dist-test/packages/pi-coding-agent/src/index.js', import.meta.url).href,
  '@gsd/pi-ai/oauth':     new URL('../dist-test/packages/pi-ai/src/utils/oauth/index.js', import.meta.url).href,
  '@gsd/pi-ai':           new URL('../dist-test/packages/pi-ai/src/index.js', import.meta.url).href,
  '@gsd/pi-agent-core':   new URL('../dist-test/packages/pi-agent-core/src/index.js', import.meta.url).href,
  '@gsd/pi-tui':          new URL('../dist-test/packages/pi-tui/src/index.js', import.meta.url).href,
  '@gsd/native':          new URL('../dist-test/packages/native/dist/index.js', import.meta.url).href,
};

export function resolve(specifier, context, nextResolve) {
  // 1. @gsd/* bare imports → compiled dist-test counterpart
  if (specifier in GSD_ALIASES) {
    return nextResolve(GSD_ALIASES[specifier], context);
  }

  // 2. .ts imports inside dist-test → .js, preserving query/hash
  // cache busters used by dynamic import tests.
  if (specifier.startsWith('file:') && specifier.startsWith(DIST_TEST) && isTsSpecifier(specifier)) {
    return nextResolve(rewriteTsSpecifierToJs(specifier), context);
  }

  if (
    isTsSpecifier(specifier) &&
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    context.parentURL &&
    context.parentURL.startsWith(DIST_TEST)
  ) {
    const jsSpecifier = rewriteTsSpecifierToJs(specifier);
    return nextResolve(jsSpecifier, context);
  }

  return nextResolve(specifier, context);
}

function isTsSpecifier(specifier) {
  const pathPart = specifier.split(/[?#]/, 1)[0];
  return pathPart.endsWith('.ts');
}

function rewriteTsSpecifierToJs(specifier) {
  return specifier.replace(/\.ts(?=([?#]|$))/, '.js');
}

registerHooks({ resolve });
