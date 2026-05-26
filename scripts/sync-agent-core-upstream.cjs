#!/usr/bin/env node
/** sync-agent-core-upstream.cjs — refresh gsd-agent-core session layer from upstream v0.75.5. */
'use strict'

const { cpSync, existsSync, readFileSync, writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')

const ROOT = join(__dirname, '..')
const UP = join(ROOT, '.cache/pi-upstream/packages/coding-agent/src/core')
const DEST = join(ROOT, 'packages/gsd-agent-core/src')

const FILES = [
  'agent-session.ts',
  'agent-session-services.ts',
  'agent-session-runtime.ts',
  'sdk.ts',
  'compaction-orchestrator.ts',
  'bash-executor.ts',
  'contextual-tips.ts',
  'image-overflow-recovery.ts',
  'system-prompt.ts',
]

const DIRS = ['compaction', 'export-html']

function normalize(content) {
  let c = content
  c = c.replaceAll('@earendil-works/pi-agent-core', '@gsd/pi-agent-core')
  c = c.replaceAll('@earendil-works/pi-ai', '@gsd/pi-ai')
  c = c.replaceAll('@earendil-works/pi-tui', '@gsd/pi-tui')
  c = c.replaceAll('@earendil-works/pi-coding-agent', '@gsd/pi-coding-agent')
  c = c.replaceAll('@mariozechner/pi-agent-core', '@gsd/pi-agent-core')
  c = c.replaceAll('@mariozechner/pi-ai', '@gsd/pi-ai')
  c = c.replaceAll('@mariozechner/pi-tui', '@gsd/pi-tui')
  c = c.replaceAll('@mariozechner/pi-coding-agent', '@gsd/pi-coding-agent')
  c = c.replace(/from "(\.{1,2}\/[^"]+)\.ts"/g, 'from "$1.js"')
  c = c.replace(/from '(\.{1,2}\/[^']+)\.ts'/g, "from '$1.js'")
  c = c.replace(
    'from "../modes/interactive/theme/theme.js"',
    'from "@gsd/pi-coding-agent/theme/theme.js"',
  )
  c = c.replace(
    'from "../../modes/interactive/theme/theme.js"',
    'from "@gsd/pi-coding-agent/theme/theme.js"',
  )
  return c
}

for (const file of FILES) {
  const src = join(UP, file)
  if (!existsSync(src)) {
    process.stderr.write(`skip missing ${file}\n`)
    continue
  }
  const dest = join(DEST, file)
  writeFileSync(dest, normalize(readFileSync(src, 'utf8')))
  process.stderr.write(`synced ${file}\n`)
}

for (const dir of DIRS) {
  const srcDir = join(UP, dir)
  const destDir = join(DEST, dir)
  if (!existsSync(srcDir)) continue
  cpSync(srcDir, destDir, { recursive: true })
  const { readdirSync } = require('fs')
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.ts')) writeFileSync(p, normalize(readFileSync(p, 'utf8')))
    }
  }
  walk(destDir)
  process.stderr.write(`synced ${dir}/\n`)
}

process.stderr.write('sync-agent-core-upstream: done\n')
