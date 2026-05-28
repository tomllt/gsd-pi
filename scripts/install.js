#!/usr/bin/env node

/**
 * GSD-Pi Installer — thin entry router.
 *
 * Postinstall: silent deps on the installed package root.
 * npx / gsd-pi bin: guided install to usable agent.
 */

import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import * as p from '@clack/prompts'
import { printBanner, createColors, createPrereqLog } from './install/banner.js'
import { runPostinstallDeps, runInteractiveDeps, createClackUi } from './install/deps.js'
import { checkPrereqs } from './install/prereqs.js'
import { resolveInstallAction, detectInstalledVersion } from './install/detect-existing.js'
import { installGlobalPackage, installLocalPackage } from './install/npm-global.js'
import {
  resolveGsdBin,
  runConfigHandoff,
  promptLaunch,
  verifyInstall,
} from './install/handoff.js'
import {
  assertInteractiveOrYes,
  printNonInteractiveNextSteps,
} from './install/non-tty.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const IS_POSTINSTALL =
  process.env.npm_lifecycle_event === 'postinstall' ||
  process.env.GSD_POSTINSTALL === '1'
const packageRoot = join(__dirname, '..')

const args = process.argv.slice(2)
const HAS_HELP = args.includes('--help') || args.includes('-h')
const HAS_VERSION = args.includes('--version') || args.includes('-v')
const YES_FLAG = args.includes('--yes') || args.includes('-y')
const isLocal = args.includes('--local') || args.includes('-l')

const PLAYWRIGHT_SKIP =
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === '1' ||
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === 'true' ||
  args.includes('--skip-chromium')

const RTK_SKIP =
  process.env.GSD_SKIP_RTK_INSTALL === '1' ||
  process.env.GSD_SKIP_RTK_INSTALL === 'true' ||
  process.env.GSD_RTK_DISABLED === '1' ||
  process.env.GSD_RTK_DISABLED === 'true' ||
  args.includes('--skip-rtk')

let gsdVersion = '0.0.0'
try {
  const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8'))
  gsdVersion = pkg.version || '0.0.0'
} catch { /* ignore */ }

const colors = createColors()

if (HAS_VERSION) {
  process.stdout.write(`${gsdVersion}\n`)
  process.exit(0)
}

if (HAS_HELP) {
  process.stdout.write(`
  ${colors.bold}GSD-Pi Installer${colors.reset} ${colors.dim}v${gsdVersion}${colors.reset}
  ${colors.dim}https://opengsd.net${colors.reset}

  ${colors.yellow}Usage:${colors.reset}
    npx @opengsd/gsd-pi@latest              Install GSD-Pi globally (recommended)
    npx @opengsd/gsd-pi@latest --local      Install to current project (advanced)

  ${colors.yellow}Options:${colors.reset}
    ${colors.cyan}--yes, -y${colors.reset}           Non-interactive install (required without TTY)
    ${colors.cyan}--local, -l${colors.reset}         Install to current directory instead of globally
    ${colors.cyan}--skip-chromium${colors.reset}      Skip Chromium browser download
    ${colors.cyan}--skip-rtk${colors.reset}          Skip RTK shell compression binary
    ${colors.cyan}-h, --help${colors.reset}          Show this help
    ${colors.cyan}-v, --version${colors.reset}       Show version

  ${colors.yellow}Environment:${colors.reset}
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1  Skip Chromium
    GSD_SKIP_RTK_INSTALL=1              Skip RTK
    GSD_RTK_DISABLED=1                  Disable RTK integration

`)
  process.exit(0)
}

async function runNpxInstaller() {
  const nonInteractive = YES_FLAG || !process.stdin.isTTY
  assertInteractiveOrYes({ isTTY: process.stdin.isTTY, yesFlag: YES_FLAG })

  if (!nonInteractive) {
    printBanner({ version: gsdVersion, colors })
  }

  const ui = createClackUi(p)
  const prereqLog = nonInteractive
    ? { step() {}, warn(label, detail) { p.log.warn(detail || label) }, fail() {} }
    : createPrereqLog(colors)

  checkPrereqs({ isLocal, log: prereqLog })

  let action = 'fresh'
  if (nonInteractive) {
    const installedVersion = await detectInstalledVersion()
    action = installedVersion ? 'upgrade' : 'fresh'
  } else {
    const resolved = await resolveInstallAction({
      targetVersion: gsdVersion,
      yesMode: YES_FLAG,
      clack: p,
    })
    action = resolved.action
  }

  if (action === 'cancel') {
    p.outro('Cancelled.')
    process.exit(0)
  }

  if (action === 'reconfigure') {
    const bin = resolveGsdBin({ isLocal })
    runConfigHandoff({ bin, nonInteractive: false })
    await promptLaunch({ bin, clack: p, nonInteractive: false })
    p.outro('Ready.')
    return
  }

  let targetPackageRoot = packageRoot
  const verifyOnly = action === 'upgrade'

  if (action === 'fresh' || action === 'upgrade') {
    const spinner = p.spinner()
    try {
      spinner.start(
        isLocal
          ? 'Installing @opengsd/gsd-pi locally...'
          : 'Installing @opengsd/gsd-pi globally...',
      )
      targetPackageRoot = isLocal
        ? await installLocalPackage(gsdVersion)
        : await installGlobalPackage(gsdVersion)
      spinner.stop(isLocal ? 'Installed locally' : 'Installed globally')
    } catch (err) {
      spinner.stop('Install failed')
      p.log.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  }

  await runInteractiveDeps(targetPackageRoot, {
    skipChromium: PLAYWRIGHT_SKIP,
    skipRtk: RTK_SKIP,
    ui,
    verifyOnly,
    promptChromium: nonInteractive || PLAYWRIGHT_SKIP
      ? null
      : async () => {
        const answer = await p.confirm({
          message: 'Install Chromium for browser automation?',
          initialValue: true,
        })
        return !p.isCancel(answer) && answer
      },
    promptRtk: nonInteractive || RTK_SKIP
      ? null
      : async () => {
        const answer = await p.confirm({
          message: 'Install RTK for shell output compression?',
          initialValue: true,
        })
        return !p.isCancel(answer) && answer
      },
  })

  const bin = resolveGsdBin({ isLocal })
  const verified = verifyInstall(bin)
  if (verified) {
    p.log.success(`Verified gsd v${verified}`)
  }

  if (nonInteractive) {
    printNonInteractiveNextSteps()
    return
  }

  runConfigHandoff({ bin, nonInteractive: false })
  await promptLaunch({ bin, clack: p, nonInteractive: false })
  p.outro(`Ready. Run: gsd`)
}

if (IS_POSTINSTALL) {
  await runPostinstallDeps(packageRoot, {
    skipChromium: PLAYWRIGHT_SKIP,
    skipRtk: RTK_SKIP,
    quiet: true,
  })
} else {
  await runNpxInstaller()
}
