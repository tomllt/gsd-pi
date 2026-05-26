#!/usr/bin/env node
/**
 * vendor-pi.cjs — sync vendored @gsd/pi-* packages from earendil-works/pi.
 *
 * Usage:
 *   node scripts/vendor-pi.cjs [--ref v0.75.5] [--dry-run]
 *
 * Prerequisites:
 *   - git available on PATH
 *   - ADR-010 clean seam complete (GSD code in gsd-agent-core / gsd-agent-modes)
 *
 * The script clones or updates a shallow checkout under .cache/pi-upstream, copies
 * the four upstream package directories into packages/pi-*, and preserves GSD
 * package.json name/scope fields.
 */
'use strict'

const { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync } = require('fs')
const { join, resolve, dirname } = require('path')
const { execFileSync } = require('child_process')

const REPO_ROOT = resolve(__dirname, '..')
const UPSTREAM_CONFIG_PATH = join(__dirname, 'pi-upstream.json')
const CACHE_DIR = join(REPO_ROOT, '.cache', 'pi-upstream')

function loadConfig() {
  return JSON.parse(readFileSync(UPSTREAM_CONFIG_PATH, 'utf8'))
}

function parseArgs(argv) {
  const opts = { dryRun: false, ref: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') opts.dryRun = true
    else if (argv[i] === '--ref' && argv[i + 1]) opts.ref = argv[++i]
  }
  return opts
}

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

function runCapture(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8' }).trim()
}

function ensureUpstreamCheckout(repoUrl, ref) {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(dirname(CACHE_DIR), { recursive: true })
    run('git', ['clone', '--depth', '1', '--branch', ref, '--', repoUrl, CACHE_DIR], REPO_ROOT)
    return
  }

  run('git', ['fetch', '--depth', '1', 'origin'], CACHE_DIR)
  run('git', ['checkout', ref], CACHE_DIR)
  run('git', ['pull', '--depth', '1', 'origin'], CACHE_DIR)
}

function preserveGsdPackageJson(targetDir, upstreamPkgJson) {
  const gsdPkgPath = join(targetDir, 'package.json')
  let gsdFields = {}
  if (existsSync(gsdPkgPath)) {
    const existing = JSON.parse(readFileSync(gsdPkgPath, 'utf8'))
    gsdFields = {
      name: existing.name,
      version: existing.version,
      description: existing.description,
      gsd: existing.gsd,
      piConfig: existing.piConfig,
    }
  }

  const merged = { ...upstreamPkgJson, ...gsdFields }
  // Drop upstream-only publish fields that would confuse GSD packaging
  delete merged.publishConfig
  return merged
}

function copyPackage(upstreamSubdir, targetSubdir, gsdPackageName, dryRun) {
  const src = join(CACHE_DIR, upstreamSubdir)
  const dest = join(REPO_ROOT, targetSubdir)

  if (!existsSync(src)) {
    throw new Error(`Upstream package not found: ${src}`)
  }

  process.stderr.write(`${dryRun ? '[dry-run] ' : ''}Copy ${upstreamSubdir} → ${targetSubdir}\n`)

  if (dryRun) return

  rmSync(dest, { recursive: true, force: true })
  cpSync(src, dest, { recursive: true })

  const upstreamPkg = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8'))
  const merged = preserveGsdPackageJson(dest, upstreamPkg)
  if (gsdPackageName) merged.name = gsdPackageName
  writeFileSync(join(dest, 'package.json'), JSON.stringify(merged, null, 2) + '\n')
}

function main() {
  const config = loadConfig()
  const opts = parseArgs(process.argv.slice(2))
  const ref = opts.ref || config.pinnedRef

  if (!ref) {
    process.stderr.write('ERROR: No upstream ref. Set pinnedRef in scripts/pi-upstream.json or pass --ref\n')
    process.exit(1)
  }

  for (const protectedPath of config.protectedPaths || []) {
    const full = join(REPO_ROOT, protectedPath)
    if (!existsSync(full)) continue
    // protected paths must exist and not be overwritten — they live outside pi-* vendor dirs
  }

  process.stderr.write(`Vendoring earendil-works/pi @ ${ref}\n`)
  if (!opts.dryRun) {
    ensureUpstreamCheckout(config.repository, ref)
  }

  for (const [upstreamPath, targetPath] of Object.entries(config.packageMap)) {
    const gsdName = config.gsdPackageNames?.[upstreamPath]
    copyPackage(upstreamPath, targetPath, gsdName, opts.dryRun)
  }

  process.stderr.write('Done. Run npm run build and fix errors in @gsd/agent-core and @gsd/agent-modes only.\n')
}

main()
