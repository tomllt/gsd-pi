import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { getGlobalPaths } from './npm-global.js'

export function resolveGsdBin({ isLocal, cwd = process.cwd() }) {
  if (isLocal) {
    const localBin = join(cwd, 'node_modules', '.bin', 'gsd')
    if (existsSync(localBin)) return localBin
    if (process.platform === 'win32' && existsSync(`${localBin}.cmd`)) {
      return `${localBin}.cmd`
    }
    return localBin
  }

  const { binDir } = getGlobalPaths()
  const globalBin = join(binDir, process.platform === 'win32' ? 'gsd.cmd' : 'gsd')
  if (existsSync(globalBin)) return globalBin
  return join(binDir, 'gsd')
}

export function runConfigHandoff({ bin, nonInteractive }) {
  if (nonInteractive) return { skipped: true }

  const result = spawnSync(bin, ['config'], {
    stdio: 'inherit',
    timeout: 600_000,
  })

  if (result.error || (result.status != null && result.status !== 0)) {
    process.stderr.write(
      `\nFailed to run provider setup.\n` +
      `Run manually: ${bin} config\n\n`,
    )
    process.exit(1)
  }

  return { skipped: false }
}

export async function promptLaunch({ bin, clack: p, nonInteractive }) {
  if (nonInteractive) return false

  const launch = await p.confirm({
    message: 'Launch GSD now?',
    initialValue: true,
  })

  if (p.isCancel(launch) || !launch) return false

  const result = spawnSync(bin, [], {
    stdio: 'inherit',
    timeout: 600_000,
  })

  if (result.error || (result.status != null && result.status !== 0)) {
    process.exit(result.status ?? 1)
  }

  return true
}

export function verifyInstall(bin) {
  const result = spawnSync(bin, ['--version'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
  })

  if (!result.error && result.status === 0 && result.stdout.trim()) {
    return result.stdout.trim()
  }
  return null
}
