#!/usr/bin/env node
/**
 * link-workspace-packages.cjs
 *
 * Creates node_modules/@gsd/* and node_modules/@opengsd/* symlinks pointing
 * to shipped packages/* directories.
 *
 * During development, pnpm workspaces creates these automatically. But in the
 * published tarball, workspace packages are shipped under packages/ (via the
 * "files" field) and the @gsd/* imports in compiled code need node_modules/@gsd/*
 * to resolve. This script bridges the gap.
 *
 * Runs as part of postinstall (before any ESM code that imports @gsd/*).
 *
 * On Windows without Developer Mode or administrator rights, creating symlinks
 * (even NTFS junctions) can fail with EPERM. In that case we fall back to
 * cpSync (directory copy) which works universally.
 */
const { existsSync, mkdirSync, symlinkSync, cpSync, lstatSync, readlinkSync, unlinkSync } = require('fs')
const { resolve, join } = require('path')
const { getLinkablePackages, REPO_ROOT } = require('./lib/workspace-manifest.cjs')

// NOTE: undici is a real root dependency (package.json "dependencies") and is
// materialized at install time by repairPackageDependencies() in
// scripts/install/deps.js. A previous helper here tried to seed root undici from
// packages/pi-coding-agent/node_modules/undici, but node_modules is never shipped
// in the tarball (the "files" glob excludes it, and validate-pack forbids it), so
// that path was always inert and has been removed.

const scopeDirs = {
  '@gsd': join(REPO_ROOT, 'node_modules', '@gsd'),
  '@opengsd': join(REPO_ROOT, 'node_modules', '@opengsd'),
}

for (const scopeDir of Object.values(scopeDirs)) {
  if (!existsSync(scopeDir)) {
    mkdirSync(scopeDir, { recursive: true })
  }
}

let linked = 0
let copied = 0
for (const pkg of getLinkablePackages()) {
  const source = pkg.path
  const scopeDir = scopeDirs[pkg.scope]
  const target = join(scopeDir, pkg.name)

  if (!existsSync(source)) continue

  // Skip if already correctly linked or is a real directory (bundled)
  if (existsSync(target)) {
    try {
      const stat = lstatSync(target)
      if (stat.isSymbolicLink()) {
        const linkTarget = readlinkSync(target)
        if (resolve(join(scopeDir, linkTarget)) === source || linkTarget === source) {
          continue // Already correct
        }
        unlinkSync(target) // Wrong target, relink
      } else {
        continue // Real directory (e.g., copied or from bundleDependencies), don't touch
      }
    } catch {
      continue
    }
  }

  let symlinkOk = false
  try {
    symlinkSync(source, target, 'junction') // junction works on Windows too
    symlinkOk = true
    linked++
  } catch {
    // Symlink failed — common on Windows without Developer Mode or admin rights.
    // Fall back to a directory copy so the package is still resolvable.
  }

  if (!symlinkOk) {
    try {
      cpSync(source, target, { recursive: true })
      copied++
    } catch {
      // Non-fatal — loader.ts will emit a clearer error if resolution still fails
    }
  }
}

// Vendored pi-coding-agent still resolves @earendil-works/* at runtime.
const earendilDir = join(REPO_ROOT, 'node_modules', '@earendil-works')
if (!existsSync(earendilDir)) {
  mkdirSync(earendilDir, { recursive: true })
}
for (const name of ['pi-agent-core', 'pi-ai', 'pi-tui', 'pi-coding-agent']) {
  const target = join(earendilDir, name)
  const source = join(scopeDirs['@gsd'], name)
  if (!existsSync(source) || existsSync(target)) continue
  try {
    symlinkSync(source, target, 'junction')
    linked++
  } catch {
    try {
      cpSync(source, target, { recursive: true })
      copied++
    } catch {
      // non-fatal
    }
  }
}

if (linked > 0) process.stderr.write(`  Linked ${linked} workspace package${linked !== 1 ? 's' : ''}\n`)
if (copied > 0) process.stderr.write(`  Copied ${copied} workspace package${copied !== 1 ? 's' : ''} (symlinks unavailable)\n`)
