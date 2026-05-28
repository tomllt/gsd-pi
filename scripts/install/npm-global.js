import { execFileSync } from 'child_process'
import { join } from 'path'

function runNpm(args) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  return execFileSync(npm, args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
    shell: process.platform === 'win32',
  }).trim()
}

export function getGlobalPaths() {
  const prefix = runNpm(['prefix', '-g'])
  const root = runNpm(['root', '-g'])
  return {
    prefix,
    root,
    binDir: join(prefix, 'bin'),
    packageRoot: join(root, '@opengsd', 'gsd-pi'),
  }
}

export function getLocalPackageRoot(cwd = process.cwd()) {
  return join(cwd, 'node_modules', '@opengsd', 'gsd-pi')
}

export async function installGlobalPackage(version) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  execFileSync(
    npm,
    ['install', '-g', '--ignore-scripts', `@opengsd/gsd-pi@${version}`],
    {
      stdio: 'inherit',
      timeout: 300_000,
      shell: process.platform === 'win32',
    },
  )
  return getGlobalPaths().packageRoot
}

export async function installLocalPackage(version, cwd = process.cwd()) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  execFileSync(
    npm,
    ['install', '--ignore-scripts', `@opengsd/gsd-pi@${version}`],
    {
      cwd,
      stdio: 'inherit',
      timeout: 300_000,
      shell: process.platform === 'win32',
    },
  )
  return getLocalPackageRoot(cwd)
}
