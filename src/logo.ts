/**
 * Shared GSD-Pi block-letter ASCII logo.
 *
 * Single source of truth — imported by:
 *   - scripts/install (via dist/logo.js / scripts/lib/logo.cjs)
 *   - src/loader.ts, src/onboarding.ts
 */

/** Project website — shown in installer, loader, and onboarding surfaces. */
export const GSD_WEBSITE = 'https://opengsd.net'

/** Raw GSD-Pi wordmark lines — no ANSI codes, no leading newline. */
export const GSD_PI_LOGO: readonly string[] = [
  '  ██████╗ ███████╗██████╗   ██████╗ ██╗',
  ' ██╔════╝ ██╔════╝██╔══██╗  ██╔══██╗██║',
  ' ██║  ███╗███████╗██║  ██║  ██████╔╝██║',
  ' ██║   ██║╚════██║██║  ██║  ██╔═══╝ ██║',
  ' ╚██████╔╝███████║██████╔╝  ██║     ██║',
  '  ╚═════╝ ╚══════╝╚═════╝   ╚═╝     ╚═╝',
]

/** @deprecated Use GSD_PI_LOGO */
export const GSD_LOGO: readonly string[] = GSD_PI_LOGO

/**
 * Render the GSD-Pi wordmark with a color function applied to each line.
 */
export function renderGsdPiLogo(color: (s: string) => string): string {
  return '\n' + GSD_PI_LOGO.map(color).join('\n') + '\n'
}

/** @deprecated Use renderGsdPiLogo */
export function renderLogo(color: (s: string) => string): string {
  return renderGsdPiLogo(color)
}
