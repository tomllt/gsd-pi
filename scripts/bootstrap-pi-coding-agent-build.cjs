#!/usr/bin/env node
/**
 * Bootstrap pi-coding-agent build before agent-core dist exists.
 * Temporarily copies GSD module implementations into pi-coding-agent shims,
 * builds pi-coding-agent, then restores thin re-export shims.
 */
'use strict'

const { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('fs')
const { join } = require('path')
const { execSync } = require('child_process')

const ROOT = join(__dirname, '..')
const PI_CORE = join(ROOT, 'packages/pi-coding-agent/src/core')
const AGENT_CORE = join(ROOT, 'packages/gsd-agent-core/src')
const BACKUP = join(ROOT, '.cache/pi-shim-backup')

const SHIMS = [
  'keybindings.ts',
  'fallback-resolver.ts',
  'blob-store.ts',
  'artifact-manager.ts',
  'lifecycle-hooks.ts',
  'system-prompt.ts',
  'extension-session-types.ts',
]

function restoreImports(content, file) {
  let c = content
  if (file === 'keybindings.ts') {
    c = c.replace(
      'import { getAgentDir } from "@gsd/pi-coding-agent/config.js";',
      'import { getAgentDir } from "../config.js";',
    )
  }
  if (file === 'fallback-resolver.ts') {
    c = c.replaceAll('@gsd/pi-coding-agent/core/', './')
  }
  if (file === 'lifecycle-hooks.ts') {
    c = c.replaceAll('@gsd/pi-coding-agent/core/', './')
      .replace('@gsd/pi-coding-agent/utils/git.js', '../utils/git.js')
  }
  if (file === 'system-prompt.ts') {
    c = c.replaceAll('@gsd/pi-coding-agent/', '../')
  }
  if (file === 'extension-session-types.ts') {
    return readFileSync(join(PI_CORE, file), 'utf8')
  }
  return c
}

if (existsSync(BACKUP)) rmSync(BACKUP, { recursive: true, force: true })
mkdirSync(BACKUP, { recursive: true })

for (const file of SHIMS) {
  const shimPath = join(PI_CORE, file)
  writeFileSync(join(BACKUP, file), readFileSync(shimPath, 'utf8'))
  if (file === 'extension-session-types.ts') {
    writeFileSync(
      shimPath,
      `/** bootstrap stub */\nexport class AgentSession {}\nexport type AgentSessionEvent = { type: string };\nexport function parseSkillBlock() { return null; }\n`,
    )
    continue
  }
  const srcPath = join(AGENT_CORE, file)
  if (!existsSync(srcPath)) continue
  const content = restoreImports(readFileSync(srcPath, 'utf8'), file)
  writeFileSync(shimPath, content)
}

try {
  execSync('pnpm --filter @gsd/pi-coding-agent run build', { cwd: ROOT, stdio: 'inherit' })
} finally {
  for (const file of SHIMS) {
    writeFileSync(join(PI_CORE, file), readFileSync(join(BACKUP, file), 'utf8'))
  }
  rmSync(BACKUP, { recursive: true, force: true })
}

process.stderr.write('bootstrap-pi-coding-agent-build: done\n')
