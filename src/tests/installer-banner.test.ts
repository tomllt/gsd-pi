import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('printBanner renders the GSD-Pi wordmark once', async () => {
  const { printBanner, createColors } = await import('../../scripts/install/banner.js')

  const chunks: string[] = []
  const orig = process.stdout.write.bind(process.stdout)
  ;(process.stdout as NodeJS.WriteStream).write = ((chunk: string) => {
    chunks.push(String(chunk))
    return true
  }) as typeof process.stdout.write

  try {
    printBanner({ version: '9.9.9', colors: createColors() })
  } finally {
    ;(process.stdout as NodeJS.WriteStream).write = orig
  }

  const out = chunks.join('')
  const strip = out.replace(/\x1b\[[0-9;]*m/g, '')
  assert.equal(
    strip.split('\n').filter((line) => line.includes('██████╗ ███████╗██████╗ ─ ██████╗ ██╗')).length,
    1,
    'expected a single GSD-Pi wordmark',
  )
  assert.match(strip, /Git Ship Done · v9\.9\.9/)
  assert.doesNotMatch(strip, /\n\s+GSD-Pi\s+Git Ship Done/)
})
