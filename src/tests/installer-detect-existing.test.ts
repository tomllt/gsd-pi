import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseInstalledVersion,
  compareActions,
} from '../../scripts/install/detect-existing.js'

test('parseInstalledVersion reads direct dependency entry', () => {
  const version = parseInstalledVersion({
    dependencies: {
      '@opengsd/gsd-pi': { version: '2.14.0' },
    },
  })
  assert.equal(version, '2.14.0')
})

test('parseInstalledVersion walks nested dependency tree', () => {
  const version = parseInstalledVersion({
    dependencies: {
      foo: {
        dependencies: {
          '@opengsd/gsd-pi': { version: '2.10.1' },
        },
      },
    },
  })
  assert.equal(version, '2.10.1')
})

test('compareActions returns upgrade in yes mode when installed', () => {
  assert.equal(
    compareActions({ installed: '2.12.0', yesMode: true }),
    'upgrade',
  )
})

test('compareActions returns prompt when installed and interactive', () => {
  assert.equal(
    compareActions({ installed: '2.12.0', yesMode: false }),
    'prompt',
  )
})

test('compareActions returns fresh when not installed', () => {
  assert.equal(
    compareActions({ installed: null, yesMode: false }),
    'fresh',
  )
})
