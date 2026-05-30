import { execFileSync, spawn } from 'child_process'
import { join } from 'path'

const PACKAGE_MANAGERS = new Set(['npm', 'pnpm'])

function normalizePackageManager(value) {
  return PACKAGE_MANAGERS.has(value) ? value : 'npm'
}

function hasPnpmPath(value = '') {
  const normalized = value.replace(/\\/g, '/').toLowerCase()
  return (
    normalized.includes('/.pnpm/') ||
    normalized.includes('/pnpm/') ||
    normalized.includes('/library/pnpm/') ||
    normalized.endsWith('/pnpm') ||
    normalized.endsWith('/pnpm.cjs') ||
    normalized.endsWith('/pnpm.js')
  )
}

export function detectPackageManager(env = process.env, argv1 = process.argv[1]) {
  const userAgent = env.npm_config_user_agent || ''
  if (userAgent.startsWith('pnpm/')) return 'pnpm'
  if (userAgent.startsWith('npm/')) return 'npm'

  if (hasPnpmPath(env.npm_execpath || '')) return 'pnpm'
  if (hasPnpmPath(argv1 || '')) return 'pnpm'

  return 'npm'
}

function getPackageManagerBin(packageManager) {
  const bin = normalizePackageManager(packageManager)
  return process.platform === 'win32' ? `${bin}.cmd` : bin
}

const PM_OUTPUT_LIMIT = 64 * 1024

function runPackageManager(packageManager, args) {
  return execFileSync(getPackageManagerBin(packageManager), args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
    shell: process.platform === 'win32',
  }).trim()
}

function formatPackageManagerFailure(packageManager, result) {
  const output = `${result.stderr}\n${result.stdout}`.trim()
  const meaningful = output
    .split('\n')
    .filter((line) => line.trim() && !/^(?:npm\s+warn|warn)\b/i.test(line.trim()))
    .slice(-3)
    .join('; ')
  return meaningful || result.error?.message || `${packageManager} install failed`
}

function appendLimited(value, chunk) {
  if (value.length >= PM_OUTPUT_LIMIT) return value
  return value + chunk.slice(0, PM_OUTPUT_LIMIT - value.length)
}

function runPackageManagerAsync(packageManager, args, {
  captureStdout = false,
  cwd,
  timeout = 300_000,
} = {}) {
  const bin = getPackageManagerBin(packageManager)

  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd,
      shell: process.platform === 'win32',
      stdio: ['ignore', captureStdout ? 'pipe' : 'ignore', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeout)

    const finishError = (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: false, stdout, stderr, error: err })
    }

    if (captureStdout) {
      child.stdout.setEncoding('utf-8')
      child.stdout.on('data', (chunk) => {
        stdout = appendLimited(stdout, chunk)
      })
    }

    child.stderr.setEncoding('utf-8')
    child.stderr.on('data', (chunk) => {
      stderr = appendLimited(stderr, chunk)
    })

    child.on('error', finishError)
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)

      if (timedOut) {
        resolve({
          ok: false,
          stdout,
          stderr,
          error: new Error(`${packageManager} ${args.join(' ')} timed out after ${timeout}ms`),
        })
        return
      }

      if (code === 0) {
        resolve({ ok: true, stdout, stderr })
        return
      }

      const reason = signal ? `signal ${signal}` : `exit code ${code}`
      resolve({
        ok: false,
        stdout,
        stderr,
        error: new Error(`${packageManager} ${args.join(' ')} failed with ${reason}`),
      })
    })
  })
}

export function getGlobalPaths(options = {}) {
  const packageManager = normalizePackageManager(options.packageManager ?? detectPackageManager())

  if (packageManager === 'pnpm') {
    const binDir = runPackageManager(packageManager, ['bin', '-g'])
    const root = runPackageManager(packageManager, ['root', '-g'])
    return {
      prefix: binDir,
      root,
      binDir,
      packageRoot: join(root, '@opengsd', 'gsd-pi'),
      packageManager,
    }
  }

  const prefix = runPackageManager(packageManager, ['prefix', '-g'])
  const root = runPackageManager(packageManager, ['root', '-g'])
  return {
    prefix,
    root,
    binDir: process.platform === 'win32' ? prefix : join(prefix, 'bin'),
    packageRoot: join(root, '@opengsd', 'gsd-pi'),
    packageManager,
  }
}

export function getLocalPackageRoot(cwd = process.cwd()) {
  return join(cwd, 'node_modules', '@opengsd', 'gsd-pi')
}

export async function installGlobalPackage(version, options = {}) {
  const packageManager = normalizePackageManager(options.packageManager ?? detectPackageManager())
  const packageSpec = `@opengsd/gsd-pi@${version}`
  const installArgs = packageManager === 'pnpm'
    ? ['add', '-g', '--ignore-scripts', packageSpec]
    : ['install', '-g', '--ignore-scripts', packageSpec]

  const result = await runPackageManagerAsync(packageManager, installArgs)
  if (!result.ok) {
    throw new Error(formatPackageManagerFailure(packageManager, result))
  }
  const rootResult = await runPackageManagerAsync(packageManager, ['root', '-g'], {
    captureStdout: true,
    timeout: 120_000,
  })
  if (!rootResult.ok) {
    throw new Error(formatPackageManagerFailure(packageManager, rootResult))
  }
  return join(rootResult.stdout.trim(), '@opengsd', 'gsd-pi')
}

export async function installLocalPackage(version, cwd = process.cwd(), options = {}) {
  const packageManager = normalizePackageManager(options.packageManager ?? detectPackageManager())
  const packageSpec = `@opengsd/gsd-pi@${version}`
  const installArgs = packageManager === 'pnpm'
    ? ['add', '--ignore-scripts', packageSpec]
    : ['install', '--ignore-scripts', packageSpec]

  const result = await runPackageManagerAsync(
    packageManager,
    installArgs,
    { cwd },
  )
  if (!result.ok) {
    throw new Error(formatPackageManagerFailure(packageManager, result))
  }
  return getLocalPackageRoot(cwd)
}
