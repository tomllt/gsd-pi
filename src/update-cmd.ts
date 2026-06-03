import { execSync } from 'node:child_process'
import { agentDir as defaultAgentDir } from './app-paths.js'
import { initResources } from './resource-loader.js'
import {
  compareSemver,
  fetchLatestVersionFromRegistry,
  GSD_BROWSER_PACKAGE_NAME,
  GSD_BROWSER_REGISTRY_URL,
  GSD_PI_PACKAGE_NAME,
  resolveInstallCommand,
  resolveInstalledPackageVersion,
} from './update-check.js'

const NPM_PACKAGE = GSD_PI_PACKAGE_NAME

interface RunUpdateOptions {
  agentDir?: string
  skillsDir?: string
  target?: string
}

function formatCurrentVersion(version: string | null): string {
  return version ? `v${version}` : 'unknown'
}

async function runBrowserUpdate(): Promise<void> {
  const current = resolveInstalledPackageVersion(GSD_BROWSER_PACKAGE_NAME)
  const bold = '\x1b[1m'
  const dim = '\x1b[2m'
  const green = '\x1b[32m'
  const yellow = '\x1b[33m'
  const reset = '\x1b[0m'

  process.stdout.write(`${dim}Current gsd-browser version:${reset} ${formatCurrentVersion(current)}\n`)
  process.stdout.write(`${dim}Checking npm registry...${reset}\n`)

  const latest = await fetchLatestVersionFromRegistry(GSD_BROWSER_REGISTRY_URL)
  if (!latest) {
    process.stderr.write(`${yellow}Failed to reach npm registry.${reset}\n`)
    process.exit(1)
  }

  process.stdout.write(`${dim}Latest gsd-browser version:${reset}  v${latest}\n`)

  if (current && compareSemver(latest, current) <= 0) {
    process.stdout.write(`${green}gsd-browser is already up to date.${reset}\n`)
    return
  }

  process.stdout.write(`${dim}Updating gsd-browser:${reset} ${formatCurrentVersion(current)} → ${bold}v${latest}${reset}\n`)

  const installCmd = resolveInstallCommand(`${GSD_BROWSER_PACKAGE_NAME}@latest`)
  try {
    execSync(installCmd, {
      stdio: 'inherit',
    })
    process.stdout.write(`\n${green}${bold}Updated gsd-browser to v${latest}${reset}\n`)
  } catch {
    process.stderr.write(`\n${yellow}gsd-browser update failed. Try manually: ${installCmd}${reset}\n`)
    process.exit(1)
  }
}

export async function runUpdate(options: RunUpdateOptions = {}): Promise<void> {
  if (options.target === 'browser' || options.target === 'gsd-browser') {
    await runBrowserUpdate()
    return
  }
  if (options.target) {
    process.stderr.write(`Unknown update target: ${options.target}\n`)
    process.stderr.write('Usage: gsd update [browser]\n')
    process.exit(1)
  }

  const current = process.env.GSD_VERSION || '0.0.0'
  const bold = '\x1b[1m'
  const dim = '\x1b[2m'
  const green = '\x1b[32m'
  const yellow = '\x1b[33m'
  const reset = '\x1b[0m'

  process.stdout.write(`${dim}Current version:${reset} v${current}\n`)
  process.stdout.write(`${dim}Checking npm registry...${reset}\n`)

  const latest = await fetchLatestVersionFromRegistry()
  if (!latest) {
    process.stderr.write(`${yellow}Failed to reach npm registry.${reset}\n`)
    process.exit(1)
  }

  process.stdout.write(`${dim}Latest version:${reset}  v${latest}\n`)

  if (compareSemver(latest, current) <= 0) {
    process.stdout.write(`${green}Already up to date.${reset}\n`)
    initResources(options.agentDir ?? defaultAgentDir, options.skillsDir)
    return
  }

  process.stdout.write(`${dim}Updating:${reset} v${current} → ${bold}v${latest}${reset}\n`)

  const installCmd = resolveInstallCommand(`${NPM_PACKAGE}@latest`)
  try {
    execSync(installCmd, {
      stdio: 'inherit',
    })
    process.stdout.write(`\n${green}${bold}Updated to v${latest}${reset}\n`)
  } catch {
    process.stderr.write(`\n${yellow}Update failed. Try manually: ${installCmd}${reset}\n`)
    process.exit(1)
  }
}
