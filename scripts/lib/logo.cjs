'use strict'

const { existsSync } = require('fs')
const { join } = require('path')

const distLogo = join(__dirname, '..', '..', 'dist', 'logo.js')

if (!existsSync(distLogo)) {
  throw new Error(
    'dist/logo.js not found — run npm run build before using scripts/lib/logo.cjs',
  )
}

module.exports = require(distLogo)
