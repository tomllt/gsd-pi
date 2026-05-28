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
import { createRequire, registerHooks } from 'node:module';
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
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

// ESM import hook: compiled .js mirrors for workspace packages (jiti uses alias map instead).
const WORKSPACE_ENTRIES = {
  'pi-coding-agent': new URL('../dist-test/packages/pi-coding-agent/src/index.js', import.meta.url).href,
  'pi-ai/oauth':     new URL('../dist-test/packages/pi-ai/src/utils/oauth/index.js', import.meta.url).href,
  'pi-ai':           new URL('../dist-test/packages/pi-ai/src/index.js', import.meta.url).href,
  'pi-agent-core':   new URL('../dist-test/packages/pi-agent-core/src/index.js', import.meta.url).href,
  'pi-tui':          new URL('../dist-test/packages/pi-tui/src/index.js', import.meta.url).href,
  'native':          new URL('../dist-test/packages/native/dist/index.js', import.meta.url).href,
};

const WORKSPACE_SCOPES = ['@gsd', '@earendil-works', '@mariozechner'];

const GSD_ALIASES = Object.fromEntries(
  Object.entries(WORKSPACE_ENTRIES).flatMap(([pkg, target]) =>
    WORKSPACE_SCOPES.map((scope) => [`${scope}/${pkg}`, target]),
  ),
);

function isJitiCjsParent(context) {
  const parent = context.parentURL ?? '';
  // Only jiti's CJS require path — ESM imports from extension modules still use GSD_ALIASES.
  return parent.includes('/node_modules/@mariozechner/jiti/');
}

function resolveFromSourcePackage(parentURL, specifier) {
  if (!parentURL?.includes('/dist-test/packages/')) {
    return null;
  }
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:') || specifier.startsWith('file:')) {
    return null;
  }

  const parentPath = fileURLToPath(parentURL);
  const match = parentPath.match(/[/\\]dist-test[/\\]packages[/\\]([^/\\]+)[/\\]/);
  if (!match) {
    return null;
  }

  const pkgDir = join(REPO_ROOT, 'packages', match[1]);
  const pkgJson = join(pkgDir, 'package.json');
  if (!existsSync(pkgJson)) {
    return null;
  }

  try {
    const require = createRequire(pkgJson);
    return pathToFileURL(require.resolve(specifier)).href;
  } catch {
    return null;
  }
}

function resolveWorkspaceSubpath(specifier) {
  for (const scope of WORKSPACE_SCOPES) {
    const piCodingPrefix = `${scope}/pi-coding-agent/`;
    if (specifier.startsWith(piCodingPrefix)) {
      const subpath = specifier.slice(piCodingPrefix.length);
      return new URL(`../dist-test/packages/pi-coding-agent/src/${subpath}`, import.meta.url).href;
    }
    const nativePrefix = `${scope}/native/`;
    if (specifier.startsWith(nativePrefix)) {
      const subpath = specifier.slice(nativePrefix.length);
      return new URL(`../dist-test/packages/native/src/${subpath}/index.js`, import.meta.url).href;
    }
  }
  return null;
}

export function resolve(specifier, context, nextResolve) {
  const sourcePackageTarget = resolveFromSourcePackage(context.parentURL, specifier);
  if (sourcePackageTarget) {
    return nextResolve(sourcePackageTarget, context);
  }

  const subpathTarget = resolveWorkspaceSubpath(specifier);
  if (subpathTarget) {
    return nextResolve(subpathTarget, context);
  }

  // Bare workspace imports → compiled dist-test counterparts (skip for jiti CJS).
  if (!isJitiCjsParent(context) && specifier in GSD_ALIASES) {
    return nextResolve(GSD_ALIASES[specifier], context);
  }

  // .ts imports inside dist-test → .js, preserving query/hash cache busters.
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
