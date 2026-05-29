#!/usr/bin/env node
'use strict'

const { rmSync } = require('fs')
const { join } = require('path')

rmSync(join(process.cwd(), 'dist'), { recursive: true, force: true })
