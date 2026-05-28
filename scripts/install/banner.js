import { createRequire } from 'module'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

function loadLogo() {
  try {
    return require(join(__dirname, '..', 'lib', 'logo.cjs'))
  } catch {
    return null
  }
}

export function printBanner({ version, colors }) {
  const logoModule = loadLogo()
  const c = colors

  if (logoModule?.renderGsdPiLogo) {
    process.stdout.write(logoModule.renderGsdPiLogo((s) => `${c.cyan}${s}${c.reset}`))
  }

  process.stdout.write(
    `\n  ${c.bold}Git Ship Done${c.reset}  ${c.dim}v${version}${c.reset}\n` +
    `  ${c.dim}${logoModule?.GSD_WEBSITE ?? 'https://opengsd.net'}${c.reset}\n\n`,
  )
}

export function createColors() {
  const supportsColor = process.stdout.isTTY && !process.env.NO_COLOR
  return supportsColor
    ? {
      cyan: '\x1b[36m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      red: '\x1b[31m',
      dim: '\x1b[2m',
      bold: '\x1b[1m',
      reset: '\x1b[0m',
    }
    : {
      cyan: '',
      green: '',
      yellow: '',
      red: '',
      dim: '',
      bold: '',
      reset: '',
    }
}

export function createPrereqLog(colors) {
  const c = colors
  return {
    step(label, detail) {
      const detailStr = detail ? ` ${c.dim}${detail}${c.reset}` : ''
      process.stdout.write(`  ${c.green}✓${c.reset} ${label}${detailStr}\n`)
    },
    warn(label, detail) {
      process.stdout.write(`  ${c.yellow}⚠${c.reset} ${label}\n`)
      if (detail) {
        for (const line of detail.split('\n')) {
          process.stdout.write(`    ${line}\n`)
        }
      }
    },
    fail(label, detail) {
      process.stdout.write(`  ${c.red}✗${c.reset} ${label}: ${detail}\n`)
    },
  }
}
