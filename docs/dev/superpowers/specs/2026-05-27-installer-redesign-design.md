# GSD-Pi Installer Redesign

**Date:** 2026-05-27  
**Status:** Approved (design review)

## Overview

Redesign the GSD-Pi install experience so a new user can go from zero to a **usable agent** in one guided flow. The primary entry point becomes `npx @opengsd/gsd-pi@latest`; direct `npm install -g` remains supported for power users, Docker, and CI.

## Goals

1. **Usable agent as success criteria** — install is complete when the binary works, runtime deps are handled, and an LLM provider is configured.
2. **Unified guided flow via npx** — prerequisites, package install, optional deps, provider setup, and optional launch in one session.
3. **Fix npx orchestration bugs** — stop re-running postinstall steps against the transient npx cache copy.
4. **Rebrand install surface** — new `GSD-PI` ASCII wordmark shared across installer, onboarding, and loader.
5. **Proactive PATH guidance** — warn during install before users hit `command not found: gsd`.
6. **Modular, testable installer code** — split monolithic `scripts/install.js` into focused modules.

## Non-Goals

- Project init (`.gsd/` bootstrap) as part of install — remains first use in a repo via init wizard.
- Replacing npm as the underlying distribution mechanism.
- curl/Homebrew/winget bootstrap scripts (future phase).
- Renaming `gsd config` to `gsd setup` (v1 keeps `gsd config`).
- Changing Docker/CI install commands (`npm install -g @opengsd/gsd-pi`).

## Success Criteria

| Criterion | Measurement |
|-----------|-------------|
| Primary path reaches usable agent | `npx @opengsd/gsd-pi@latest` completes package install + provider config without requiring a second command |
| Fallback path works | `npm install -g` + first `gsd` run completes onboarding if provider missing |
| No npx cache duplication | npx path does not run workspace link against npx cache after global install |
| Branding consistent | Installer, onboarding, and loader render `GSD-PI` wordmark from `src/logo.ts` |
| Automation supported | `npx ... --yes` works non-interactively; no TTY without `--yes` exits with instructions |
| Tests updated | `postinstall.test.ts`, `pack-install.test.ts` cover new orchestration |

## Install Paths

### Path comparison

| Path | Audience | Interactive | Reaches usable agent |
|------|----------|-------------|----------------------|
| `npx @opengsd/gsd-pi@latest` | New users (primary) | Yes (clack) | Yes — handoff to `gsd config` |
| `npm install -g @opengsd/gsd-pi` | Power users, Docker, CI | No | On first `gsd` via `shouldRunOnboarding()` |
| `npx ... --local` | Advanced (undocumented) | Yes | Yes — local bin handoff |
| `npx ... --yes` | Automation / non-TTY | No | No — prints `gsd config` then `gsd` |

## Architecture

### Mental model

Two orchestration modes share the same dep-install functions:

1. **Postinstall mode** — triggered by `npm install -g` lifecycle hook. Silent (or minimal output). Always runs: workspace link, Chromium, RTK (unless skip env/flags).
2. **Npx installer mode** — triggered by `gsd-pi` bin without postinstall context. Full clack UI, prerequisite checks, re-run detection, orchestrated global install.

```
                    ┌─────────────────────┐
                    │   scripts/install.js │
                    │   (thin entry)       │
                    └──────────┬──────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                 │
     IS_POSTINSTALL=true              IS_POSTINSTALL=false
              │                                 │
              ▼                                 ▼
     link + chromium + rtk            npx installer flow
     (silent)                         (clack UI)
                                              │
                                              ├─ prereqs (Node, git, PATH warn)
                                              ├─ detect existing → menu
                                              ├─ npm install -g --ignore-scripts
                                              ├─ deps on GLOBAL packageRoot
                                              ├─ spawn gsd config
                                              └─ launch prompt [Y/n]
```

### Npx happy-path flow

```
┌─────────────────────────────────────────────────────────┐
│  GSD-PI wordmark + "Git Ship Done v2.x"                 │
├─────────────────────────────────────────────────────────┤
│  1. Prereqs: Node ≥22 ✓  git ✓  PATH warn (non-block)  │
│  2. Existing install? → Upgrade / Reconfigure / Cancel  │
│  3. npm install -g --ignore-scripts @opengsd/gsd-pi     │
│  4. Orchestrate deps on global packageRoot:             │
│     • workspace link                                    │
│     • prompt → Chromium (flags bypass)                  │
│     • prompt → RTK (flags bypass)                       │
│  5. Handoff → $(npm prefix -g)/bin/gsd config           │
│  6. "Launch GSD now? [Y/n]" → spawn gsd if yes          │
└─────────────────────────────────────────────────────────┘
```

### Direct `npm install -g` flow

```
npm install -g @opengsd/gsd-pi
  → postinstall: link + Chromium + RTK
  → first `gsd`:
      shouldRunOnboarding() → runOnboarding() → TUI
```

`loader.ts` continues to re-run workspace linking if postinstall was skipped entirely (`--ignore-scripts` without npx orchestration).

## Design Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Success definition | **Usable agent** — binary + deps + LLM provider |
| 2 | Primary entry | **`npx @opengsd/gsd-pi@latest`**; `npm install -g` is fallback |
| 3 | Provider onboarding | **Handoff** to `$(npm prefix -g)/bin/gsd config` after package install |
| 4 | Postinstall scope | **Full deps** (link, Chromium, RTK) for direct npm install |
| 5 | Npx dep orchestration | **`npm install -g --ignore-scripts`**, then run dep steps on **global** `packageRoot` with live spinners |
| 6 | After config | **Prompt launch** — "Launch GSD now? [Y/n]", default yes |
| 7 | Prerequisites | **Hard gate** Node ≥22 + git; **warn** if global npm bin not in PATH |
| 8 | Branding | **Full `GSD-PI` wordmark** in `src/logo.ts`, shared everywhere |
| 9 | Tagline | **`Git Ship Done`** + dim version under wordmark |
| 10 | Re-run npx | **Detect existing** → Upgrade / Reconfigure / Cancel |
| 11 | `--local` | **Keep undocumented** advanced flag |
| 12 | Optional deps | **Clack prompts** for Chromium/RTK (default yes); flags bypass; upgrade verifies existing |
| 13 | Non-TTY | **Require `--yes`**; otherwise exit 1 with instructions |
| 14 | UI library | **`@clack/prompts`** in npx installer (postinstall stays non-interactive) |
| 15 | Code structure | **Modular** `scripts/install/` with thin `install.js` entry |

## Branding

### Wordmark

Replace the current GSD-only block letters with a new **`GSD-PI`** block-letter ASCII wordmark.

- **Source of truth:** `src/logo.ts` — export `GSD_PI_LOGO` and `renderGsdPiLogo()` (or update existing exports).
- **Consumers:** `scripts/install.js` (via `scripts/lib/logo.cjs` or `dist/logo.js`), `src/onboarding.ts`, `src/loader.ts`.
- **Remove:** inline duplicate ASCII in `scripts/install.js`.
- **Constraint:** design for 80-column terminals minimum; degrade gracefully at 60 cols.

### Tagline

```
  [GSD-PI wordmark in cyan]

  Git Ship Done  v2.14.0
```

Product name stays "Git Ship Done"; "Pi" identifies the npm distribution (`@opengsd/gsd-pi`).

## Component Design

### File layout

```
scripts/
  install.js                 # entry: route postinstall vs npx
  install/
    prereqs.js               # Node ≥22, git, PATH warning
    detect-existing.js       # re-run menu (Upgrade / Reconfigure / Cancel)
    npm-global.js            # npm install -g --ignore-scripts, resolve global prefix
    deps.js                  # workspace link, chromium, rtk orchestration
    handoff.js               # spawn gsd config, launch prompt
  lib/
    logo.cjs                 # re-export GSD_PI_LOGO from dist/logo.js

src/
  logo.ts                    # GSD_PI_LOGO + render helpers
  onboarding.ts              # use new logo
  loader.ts                    # use new logo (if applicable)
```

### `prereqs.js`

- Check Node ≥22 (hard fail with actionable message).
- Check `git` on PATH (hard fail).
- Resolve `$(npm prefix -g)/bin`; if not in `PATH`, print warning with copy-paste `export PATH=...` fix. **Non-blocking.**

### `detect-existing.js`

- Detect globally installed `@opengsd/gsd-pi` version via `npm list -g --json` or `gsd --version`.
- If found, clack select:
  - **Upgrade** — full install flow to npx-specified version
  - **Reconfigure only** — skip package install, jump to `gsd config`
  - **Cancel** — exit 0
- On **Upgrade**, skip Chromium/RTK prompts if binaries already present; verify only.

### `npm-global.js`

- Run `npm install -g --ignore-scripts @opengsd/gsd-pi@<version>`.
- Resolve global package root: `$(npm root -g)/@opengsd/gsd-pi`.
- Return path for dep orchestration.

### `deps.js`

Shared functions used by both postinstall and npx modes:

| Step | Postinstall | Npx installer |
|------|-------------|---------------|
| Workspace link | Always | Always |
| Chromium | Always (unless skip) | Prompt unless `--skip-chromium` / skip env |
| RTK | Always (unless skip) | Prompt unless `--skip-rtk` / skip env |

Use clack `spinner` for long-running steps in npx mode.

### `handoff.js`

- Resolve global bin: `join(npmPrefix, 'bin', 'gsd')` (`.cmd` on Windows).
- Spawn `gsd config` with inherited stdio; wait for exit.
- Clack confirm: "Launch GSD now?" default `true`.
- If yes, spawn `gsd` with inherited stdio.

### `--local` path (advanced)

When `--local` flag is set:

- Run `npm install @opengsd/gsd-pi` in cwd (not global).
- Orchestrate deps on `cwd/node_modules/@opengsd/gsd-pi`.
- Handoff to `./node_modules/.bin/gsd config`.
- Skip global PATH check.

## Flags and Environment

### CLI flags (npx installer)

| Flag | Effect |
|------|--------|
| `--yes` / `-y` | Non-interactive mode (required without TTY) |
| `--skip-chromium` | Skip Chromium install; bypass prompt |
| `--skip-rtk` | Skip RTK install; bypass prompt |
| `--local` / `-l` | Project-local install (undocumented) |
| `--help` | Show help |
| `--version` | Show version |

### Environment variables (unchanged)

| Variable | Effect |
|----------|--------|
| `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` | Skip Chromium |
| `GSD_SKIP_RTK_INSTALL=1` | Skip RTK |
| `GSD_RTK_DISABLED=1` | Skip RTK + disable integration |
| `NO_COLOR` | Disable ANSI colors |

### Non-TTY behavior

Without TTY and without `--yes`:

```
Error: Interactive installer requires a terminal.

For automated installs:
  npx @opengsd/gsd-pi@latest --yes

Or install directly:
  npm install -g @opengsd/gsd-pi
```

With `--yes`: install package + all deps (respecting skip flags), skip config handoff and launch prompt, print:

```
Installed. Run:
  gsd config   # configure LLM provider
  gsd          # start agent
```

## Error Handling

| Failure | Behavior |
|---------|----------|
| Node <22 or missing git | Hard fail before install work |
| `npm install -g` fails | Hard fail, exit 1 |
| Chromium install fails | Warn, continue (current behavior) |
| RTK install fails | Warn, continue (current behavior) |
| Workspace link fails | Log in postinstall; loader.ts retries on first `gsd` |
| `gsd config` spawn fails | Print manual instruction, exit 1 |
| PATH not configured | Warn only |

## Testing

### Unit tests

- `prereqs.js` — Node version gate, git detection, PATH warning logic
- `detect-existing.js` — version comparison, menu routing
- `npm-global.js` — global prefix resolution (mocked)
- Logo rendering — `GSD_PI_LOGO` fits 80 cols

### Integration tests

- Update `src/tests/postinstall.test.ts` for modular structure
- Update `src/tests/integration/pack-install.test.ts` for npx orchestration path
- Add test: npx path does not link workspace packages in npx cache after global install

### Manual smoke

```bash
# Primary path (interactive)
npx @opengsd/gsd-pi@latest

# Non-interactive
npx @opengsd/gsd-pi@latest --yes --skip-chromium

# Fallback
npm install -g @opengsd/gsd-pi@latest && gsd

# Re-run
npx @opengsd/gsd-pi@latest  # should show Upgrade menu
```

## Documentation Updates

| File | Change |
|------|--------|
| `gitbook/getting-started/installation.md` | npx as primary install command |
| `docs/user-docs/getting-started.md` | Same |
| `README.md` | Update install section and branding |
| `docs/user-docs/troubleshooting.md` | Note proactive PATH warning during install |

## Migration / Compatibility

- **Existing installs:** Re-run via npx shows Upgrade menu; no breaking changes to `~/.gsd/` layout.
- **Old unscoped `gsd-pi`:** Troubleshooting docs unchanged; installer does not auto-uninstall old package.
- **Pi clean seam refactor PRD** stated "install experience unchanged" — this redesign intentionally updates user-facing install UX. Update that PRD non-goal or add note that installer redesign supersedes it.
- **`validate-pack.js`:** Update smoke test to exercise new npx orchestration expectations.

## Out of Scope (Future)

- curl `| bash` bootstrap script
- Homebrew / winget packages
- In-installer project init (`.gsd/` wizard)
- Lazy/on-demand Chromium and RTK download
- `gsd setup` command alias
