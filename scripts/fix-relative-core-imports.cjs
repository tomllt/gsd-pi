#!/usr/bin/env node
'use strict'

const { readFileSync, writeFileSync, readdirSync } = require('fs')
const { join, relative, dirname } = require('path')

const ROOT = join(__dirname, '..')
const AGENT_CORE = join(ROOT, 'packages/gsd-agent-core/src')
const PI = join(ROOT, 'packages/pi-coding-agent/src')

const AGENT_CORE_FILES = new Set([
  'agent-session', 'keybindings', 'contextual-tips', 'sdk', 'compaction-orchestrator',
  'blob-store', 'artifact-manager', 'bash-executor', 'fallback-resolver', 'lifecycle-hooks',
  'image-overflow-recovery', 'system-prompt',
])

function walk(dir, fn) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, fn)
    else if (e.name.endsWith('.ts')) fn(p)
  }
}

function rel(fromFile, absTarget) {
  let r = relative(dirname(fromFile), absTarget).replace(/\\/g, '/')
  if (!r.startsWith('.')) r = './' + r
  return r
}

function fixFile(file) {
  let c = readFileSync(file, 'utf8')
  const orig = c

  // toolspath-utils typo
  c = c.replace(/tools\/path-utils\.js/g, 'tools/path-utils.js')

  // Replace any relative core/ import
  c = c.replace(/from "(?:\.\.\/)+core\/([^"]+)"/g, (m, subpath) => {
    const base = subpath.replace(/\.js$/, '').split('/')[0]
    if (AGENT_CORE_FILES.has(base) || subpath.startsWith('export-html/')) {
      const target = join(AGENT_CORE, subpath.endsWith('.js') ? subpath : subpath)
      return `from "${rel(file, target)}"`
    }
    const target = join(PI, 'core', subpath)
    return `from "${rel(file, target)}"`
  })

  if (c !== orig) writeFileSync(file, c)
}

walk(join(ROOT, 'packages/gsd-agent-modes/src'), fixFile)
walk(join(ROOT, 'packages/gsd-agent-core/src'), fixFile)

console.log('Relative core imports fixed')
