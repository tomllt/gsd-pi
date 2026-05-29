#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BACKUP_DIR = path.join(ROOT, '.prepack-backup');

const {
  INTERNAL_PACKAGE_NAMES,
  RELEASE_WORKSPACE_PACKAGE_DIRS,
} = require('./lib/version-sync.cjs');

const ROOT_PACKAGE_JSON = path.join(ROOT, 'package.json');
const TARGET_PACKAGE_JSONS = [
  ROOT_PACKAGE_JSON,
  ...RELEASE_WORKSPACE_PACKAGE_DIRS.map((dir) => path.join(ROOT, dir, 'package.json')),
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function usesWorkspaceProtocol(pkg) {
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (!pkg[field]) continue;
    for (const [dep, range] of Object.entries(pkg[field])) {
      if (!INTERNAL_PACKAGE_NAMES.has(dep)) continue;
      if (range === 'workspace:*' || range === '*') return true;
    }
  }
  return false;
}

function resolvePackageJson(filePath) {
  if (!fs.existsSync(filePath)) return false;

  const pkg = readJson(filePath);
  if (!usesWorkspaceProtocol(pkg)) return false;

  const version = pkg.version;
  const isRoot = filePath === ROOT_PACKAGE_JSON;
  const relPath = path.relative(ROOT, filePath);
  const backupPath = path.join(BACKUP_DIR, relPath);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(filePath, backupPath);

  let changed = false;
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (!pkg[field]) continue;
    for (const [dep, range] of Object.entries(pkg[field])) {
      if (!INTERNAL_PACKAGE_NAMES.has(dep)) continue;
      if (range !== 'workspace:*' && range !== '*') continue;
      if (isRoot) {
        // The published root no longer bundles workspace packages. Internal @gsd/@opengsd
        // packages are NOT on the public registry — they ship inside this tarball under
        // packages/*/dist and are symlinked into node_modules at postinstall by
        // link-workspace-packages.cjs. Leaving them in `dependencies` would make
        // `npm install` (and the installer's repair step) try to fetch them from the
        // registry and fail. Drop them; runtime resolution goes through the symlinks.
        delete pkg[field][dep];
        changed = true;
      } else {
        // Workspace package manifests ship as files (never npm-installed), so their
        // internal ranges are informational only. Pin to ^version for a clean tarball.
        const resolved = `^${version}`;
        if (pkg[field][dep] !== resolved) {
          pkg[field][dep] = resolved;
          changed = true;
        }
      }
    }
  }

  if (changed) {
    writeJson(filePath, pkg);
    console.log(
      isRoot
        ? `[prepack] Removed internal workspace deps from ${relPath} (shipped via files + postinstall link)`
        : `[prepack] Resolved workspace:* internal deps in ${relPath} to ^${version}`,
    );
  }
  return changed;
}

let resolvedAny = false;
for (const filePath of TARGET_PACKAGE_JSONS) {
  if (resolvePackageJson(filePath)) {
    resolvedAny = true;
  }
}

if (!resolvedAny && fs.existsSync(BACKUP_DIR)) {
  fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
}
