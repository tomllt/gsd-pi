import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('runConfigHandoff suppresses duplicate logo in gsd config subprocess', () => {
  const source = readFileSync(
    join(projectRoot, 'scripts', 'install', 'handoff.js'),
    'utf-8',
  )
  assert.match(source, /GSD_SUPPRESS_LOGO/)
  assert.match(source, /spawnSync\(bin, \['config'\], \{[\s\S]*env: \{ \.\.\.process\.env, \[GSD_SUPPRESS_LOGO_ENV\]: '1' \}/)
})

test('promptLaunch does not time out the interactive agent session', () => {
  const source = readFileSync(
    join(projectRoot, 'scripts', 'install', 'handoff.js'),
    'utf-8',
  )
  const start = source.indexOf('export async function promptLaunch')
  const end = source.indexOf('\n\nexport function verifyInstall', start)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.doesNotMatch(source.slice(start, end), /timeout\s*:/)
})

test('npm package installs do not leak npm output over installer UI', async () => {
  const binDir = await mkdtemp(join(tmpdir(), 'gsd-npm-bin-'))
  const prefixDir = await mkdtemp(join(tmpdir(), 'gsd-npm-prefix-'))
  const rootDir = await mkdtemp(join(tmpdir(), 'gsd-npm-root-'))
  const localDir = await mkdtemp(join(tmpdir(), 'gsd-npm-local-'))
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const npmPath = join(binDir, npmBin)
  const script = process.platform === 'win32'
    ? [
      '@echo off',
      'if "%1"=="install" (',
      '  "%GSD_NODE%" -e "process.stdout.write(\'NPM_INSTALL_STDOUT_MARKER\\\\n\'); process.stdout.write(\'x\'.repeat(11 * 1024 * 1024)); process.stderr.write(\'NPM_INSTALL_STDERR_MARKER\\\\n\')"',
      '  exit /b 0',
      ')',
      'if "%1"=="prefix" (echo %GSD_FAKE_PREFIX%& exit /b 0)',
      'if "%1"=="root" (echo %GSD_FAKE_ROOT%& exit /b 0)',
      'exit /b 2',
    ].join('\r\n')
    : [
      '#!/usr/bin/env sh',
      'if [ "$1" = "install" ]; then',
      '  "$GSD_NODE" -e "process.stdout.write(\'NPM_INSTALL_STDOUT_MARKER\\\\n\'); process.stdout.write(\'x\'.repeat(11 * 1024 * 1024)); process.stderr.write(\'NPM_INSTALL_STDERR_MARKER\\\\n\')"',
      '  exit 0',
      'fi',
      'if [ "$1" = "prefix" ]; then',
      '  printf "%s\\n" "$GSD_FAKE_PREFIX"',
      '  exit 0',
      'fi',
      'if [ "$1" = "root" ]; then',
      '  printf "%s\\n" "$GSD_FAKE_ROOT"',
      '  exit 0',
      'fi',
      'exit 2',
    ].join('\n')

  try {
    await writeFile(npmPath, script, { mode: 0o755 })
    if (process.platform !== 'win32') await chmod(npmPath, 0o755)

    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
          import { installGlobalPackage, installLocalPackage } from './scripts/install/npm-global.js'

          const globalRoot = await installGlobalPackage('9.9.9')
          const localRoot = await installLocalPackage('9.9.9', process.env.GSD_FAKE_LOCAL)

          process.stdout.write(JSON.stringify({ globalRoot, localRoot }))
        `,
      ],
      {
        cwd: projectRoot,
        encoding: 'utf-8',
        env: {
          ...process.env,
          GSD_FAKE_LOCAL: localDir,
          GSD_FAKE_PREFIX: prefixDir,
          GSD_FAKE_ROOT: rootDir,
          GSD_NODE: process.execPath,
          npm_config_user_agent: 'npm/10 node/v24.0.0',
          npm_execpath: npmPath,
          PATH: [binDir, process.env.PATH].filter(Boolean).join(delimiter),
        },
      },
    )

    assert.equal(result.status, 0, result.stderr)
    assert.doesNotMatch(result.stdout, /NPM_INSTALL_STDOUT_MARKER/)
    assert.doesNotMatch(result.stderr, /NPM_INSTALL_STDERR_MARKER/)
    assert.deepEqual(JSON.parse(result.stdout), {
      globalRoot: join(rootDir, '@opengsd', 'gsd-pi'),
      localRoot: join(localDir, 'node_modules', '@opengsd', 'gsd-pi'),
    })
  } finally {
    await rm(binDir, { recursive: true, force: true })
    await rm(prefixDir, { recursive: true, force: true })
    await rm(rootDir, { recursive: true, force: true })
    await rm(localDir, { recursive: true, force: true })
  }
})

test('pnpm package installs use pnpm commands and global paths', async () => {
  const binDir = await mkdtemp(join(tmpdir(), 'gsd-pnpm-bin-'))
  const rootDir = await mkdtemp(join(tmpdir(), 'gsd-pnpm-root-'))
  const localDir = await mkdtemp(join(tmpdir(), 'gsd-pnpm-local-'))
  const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const pnpmPath = join(binDir, pnpmBin)
  const script = process.platform === 'win32'
    ? [
      '@echo off',
      'if "%1"=="add" (',
      '  "%GSD_NODE%" -e "process.stdout.write(\'PNPM_ADD_STDOUT_MARKER\\\\n\'); process.stderr.write(\'PNPM_ADD_STDERR_MARKER\\\\n\')"',
      '  exit /b 0',
      ')',
      'if "%1"=="root" (echo %GSD_FAKE_ROOT%& exit /b 0)',
      'if "%1"=="bin" (echo %GSD_FAKE_BIN%& exit /b 0)',
      'exit /b 2',
    ].join('\r\n')
    : [
      '#!/usr/bin/env sh',
      'if [ "$1" = "add" ]; then',
      '  "$GSD_NODE" -e "process.stdout.write(\'PNPM_ADD_STDOUT_MARKER\\\\n\'); process.stderr.write(\'PNPM_ADD_STDERR_MARKER\\\\n\')"',
      '  exit 0',
      'fi',
      'if [ "$1" = "root" ]; then',
      '  printf "%s\\n" "$GSD_FAKE_ROOT"',
      '  exit 0',
      'fi',
      'if [ "$1" = "bin" ]; then',
      '  printf "%s\\n" "$GSD_FAKE_BIN"',
      '  exit 0',
      'fi',
      'exit 2',
    ].join('\n')

  try {
    await writeFile(pnpmPath, script, { mode: 0o755 })
    if (process.platform !== 'win32') await chmod(pnpmPath, 0o755)

    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
          import { detectPackageManager, getGlobalPaths, installGlobalPackage, installLocalPackage } from './scripts/install/npm-global.js'

          const detected = detectPackageManager({ npm_config_user_agent: 'pnpm/10.12.1 npm/? node/v24.0.0' }, '')
          const globalRoot = await installGlobalPackage('9.9.9', { packageManager: 'pnpm' })
          const localRoot = await installLocalPackage('9.9.9', process.env.GSD_FAKE_LOCAL, { packageManager: 'pnpm' })
          const paths = getGlobalPaths({ packageManager: 'pnpm' })

          process.stdout.write(JSON.stringify({ detected, globalRoot, localRoot, paths }))
        `,
      ],
      {
        cwd: projectRoot,
        encoding: 'utf-8',
        env: {
          ...process.env,
          GSD_FAKE_BIN: binDir,
          GSD_FAKE_LOCAL: localDir,
          GSD_FAKE_ROOT: rootDir,
          GSD_NODE: process.execPath,
          PATH: [binDir, process.env.PATH].filter(Boolean).join(delimiter),
        },
      },
    )

    assert.equal(result.status, 0, result.stderr)
    assert.doesNotMatch(result.stdout, /PNPM_ADD_STDOUT_MARKER/)
    assert.doesNotMatch(result.stderr, /PNPM_ADD_STDERR_MARKER/)

    const parsed = JSON.parse(result.stdout)
    assert.deepEqual(parsed, {
      detected: 'pnpm',
      globalRoot: join(rootDir, '@opengsd', 'gsd-pi'),
      localRoot: join(localDir, 'node_modules', '@opengsd', 'gsd-pi'),
      paths: {
        prefix: binDir,
        root: rootDir,
        binDir,
        packageRoot: join(rootDir, '@opengsd', 'gsd-pi'),
        packageManager: 'pnpm',
      },
    })
  } finally {
    await rm(binDir, { recursive: true, force: true })
    await rm(rootDir, { recursive: true, force: true })
    await rm(localDir, { recursive: true, force: true })
  }
})

test('pnpm install failures omit pnpm warnings from error messages', async () => {
  const binDir = await mkdtemp(join(tmpdir(), 'gsd-pnpm-bin-'))
  const localDir = await mkdtemp(join(tmpdir(), 'gsd-pnpm-local-'))
  const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const pnpmPath = join(binDir, pnpmBin)
  const script = process.platform === 'win32'
    ? [
      '@echo off',
      'if "%1"=="add" (',
      '  "%GSD_NODE%" -e "process.stderr.write(\' WARN deprecated one\\\\n WARN deprecated two\\\\n WARN deprecated three\\\\nERR_PNPM_FETCH_404 missing package\\\\n\')"',
      '  exit /b 1',
      ')',
      'exit /b 2',
    ].join('\r\n')
    : [
      '#!/usr/bin/env sh',
      'if [ "$1" = "add" ]; then',
      '  "$GSD_NODE" -e "process.stderr.write(\' WARN deprecated one\\\\n WARN deprecated two\\\\n WARN deprecated three\\\\nERR_PNPM_FETCH_404 missing package\\\\n\')"',
      '  exit 1',
      'fi',
      'exit 2',
    ].join('\n')

  try {
    await writeFile(pnpmPath, script, { mode: 0o755 })
    if (process.platform !== 'win32') await chmod(pnpmPath, 0o755)

    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
          import { installLocalPackage } from './scripts/install/npm-global.js'

          try {
            await installLocalPackage('9.9.9', process.env.GSD_FAKE_LOCAL, { packageManager: 'pnpm' })
          } catch (error) {
            process.stdout.write(error.message)
            process.exit(0)
          }

          process.exit(1)
        `,
      ],
      {
        cwd: projectRoot,
        encoding: 'utf-8',
        env: {
          ...process.env,
          GSD_FAKE_LOCAL: localDir,
          GSD_NODE: process.execPath,
          PATH: [binDir, process.env.PATH].filter(Boolean).join(delimiter),
        },
      },
    )

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /ERR_PNPM_FETCH_404 missing package/)
    assert.doesNotMatch(result.stdout, /\bWARN\b/)
  } finally {
    await rm(binDir, { recursive: true, force: true })
    await rm(localDir, { recursive: true, force: true })
  }
})
