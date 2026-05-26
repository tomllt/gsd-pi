#!/usr/bin/env node
'use strict'

const { readFileSync, existsSync } = require('fs')
const { join } = require('path')
const { execFileSync } = require('child_process')

const ROOT = join(__dirname, '..')
const MANIFEST = join(ROOT, 'scripts/pi-upstream.json')

function readAllowlist() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  const list = manifest.patchAllowlist
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('scripts/pi-upstream.json must define a non-empty patchAllowlist array')
  }
  return list
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

function resolveDiffBase() {
  if (process.env.VERIFY_PI_PATCHES_BASE) return process.env.VERIFY_PI_PATCHES_BASE
  const originMain = git(['rev-parse', '--verify', 'origin/main'])
  if (originMain) return originMain
  const main = git(['rev-parse', '--verify', 'main'])
  if (main) return main
  return 'HEAD~1'
}

const PI_PATHSPEC = ['packages/pi-agent-core/', 'packages/pi-ai/', 'packages/pi-tui/', 'packages/pi-coding-agent/']

function isPiSourceOrTest(file) {
  return PI_PATHSPEC.some((prefix) => file.startsWith(prefix)) && /(^|\/)(src|test)\//.test(file)
}

function listChangedPiFiles(base) {
  const names = new Set()
  const includeBranchRange = process.env.VERIFY_PI_PATCHES_BRANCH === '1'

  if (includeBranchRange) {
    for (const prefix of PI_PATHSPEC) {
      const rangeOut = git(['diff', '--name-only', `${base}...HEAD`, '--', prefix])
      for (const file of rangeOut.split('\n').filter(Boolean)) {
        if (isPiSourceOrTest(file)) names.add(file)
      }
    }
  }

  for (const prefix of PI_PATHSPEC) {
    for (const file of git(['diff', '--name-only', '--', prefix]).split('\n').filter(Boolean)) {
      if (isPiSourceOrTest(file)) names.add(file)
    }

    for (const file of git(['diff', '--name-only', '--cached', '--', prefix]).split('\n').filter(Boolean)) {
      if (isPiSourceOrTest(file)) names.add(file)
    }
  }

  return [...names].sort()
}

function globToRegExp(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§/g, '.*')
  return new RegExp(`^${escaped}$`)
}

function isAllowlisted(file, allowlist) {
  return allowlist.some((pattern) => {
    if (pattern.includes('*')) {
      return globToRegExp(pattern).test(file)
    }
    return pattern === file
  })
}

function main() {
  if (!existsSync(MANIFEST)) {
    process.stderr.write('Missing scripts/pi-upstream.json\n')
    process.exit(1)
  }

  const allowlist = readAllowlist()
  const base = resolveDiffBase()
  const includeBranchRange = process.env.VERIFY_PI_PATCHES_BRANCH === '1'
  const changed = listChangedPiFiles(base)
  const undocumented = changed.filter((file) => !isAllowlisted(file, allowlist))

  if (undocumented.length) {
    process.stderr.write('Undocumented pi-* changes (add to patchAllowlist + pi-upstream.md):\n')
    for (const file of undocumented) process.stderr.write(`  - ${file}\n`)
    process.stderr.write(`\nDiff base: ${base}\n`)
    process.stderr.write('See docs/dev/pi-upstream.md and docs/dev/pi-overlay-execution-plan.md\n')
    process.exit(1)
  }

  process.stderr.write(
    `Pi patch inventory check passed (${changed.length} changed file(s) under packages/pi-*/src|test${includeBranchRange ? ` vs ${base}` : ' in working tree'}).\n`,
  )
}

main()
