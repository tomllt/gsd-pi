import test from 'node:test'
import assert from 'node:assert/strict'
import { isPathConfigured } from '../../scripts/install/prereqs.js'

test('isPathConfigured matches exact bin directory on PATH', () => {
  assert.equal(
    isPathConfigured('/usr/local/bin', '/usr/local/bin:/usr/bin'),
    true,
  )
  assert.equal(
    isPathConfigured('/usr/local/bin', '/usr/bin:/bin'),
    false,
  )
})

test('isPathConfigured is case-insensitive on Windows', { skip: process.platform !== 'win32' }, () => {
  assert.equal(
    isPathConfigured('C:\\Users\\me\\AppData\\Roaming\\npm', 'C:\\Users\\me\\AppData\\Roaming\\npm;C:\\Windows'),
    true,
  )
  assert.equal(
    isPathConfigured('C:\\Users\\me\\AppData\\Roaming\\npm', 'c:\\users\\me\\appdata\\roaming\\npm'),
    true,
  )
})
