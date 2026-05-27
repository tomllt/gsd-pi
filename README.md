<!-- GSD Pi - Project overview and setup guide -->

# GSD Pi

[![npm version](https://img.shields.io/npm/v/@opengsd/gsd-pi?label=npm&logo=npm)](https://www.npmjs.com/package/@opengsd/gsd-pi)
[![npm downloads](https://img.shields.io/npm/dm/@opengsd/gsd-pi?label=downloads&logo=npm&color=red)](https://www.npmjs.com/package/@opengsd/gsd-pi)
[![CI](https://img.shields.io/github/actions/workflow/status/open-gsd/gsd-pi/ci.yml?branch=main&label=tests&logo=github)](https://github.com/open-gsd/gsd-pi/actions/workflows/ci.yml)
[![Discord](https://img.shields.io/badge/discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/8NnkKuepmQ)
[![GitHub stars](https://img.shields.io/github/stars/open-gsd/gsd-pi?label=stars&logo=github)](https://github.com/open-gsd/gsd-pi/stargazers)
[![License: MIT](https://img.shields.io/github/license/open-gsd/gsd-pi?label=license)](https://github.com/open-gsd/gsd-pi/blob/main/LICENSE)

GSD Pi is a local-first coding agent for planning, implementing, verifying, and tracking project work from the command line.

It combines a terminal agent, project workflow tools, worktree-aware Git automation, and optional UI integrations so a project can move from idea to reviewed implementation with less manual coordination.

## Status

This repository is starting a new development baseline at version `1.0.0` under the `open-gsd/gsd-pi` project.

Older release history has been archived outside the active changelog so new work can be reviewed from a clean project surface.

## Install

Install from npm (not by cloning this repo):

```bash
npm install -g @opengsd/gsd-pi@latest
```

Source: [`open-gsd/gsd-pi`](https://github.com/open-gsd/gsd-pi).

## Migrate From Older Installs

GSD Pi now installs from the scoped npm package `@opengsd/gsd-pi`. If you previously installed the older unscoped `gsd-pi` package, remove it first so the old global binary does not shadow the new package.

macOS / Linux:

```bash
npm uninstall -g gsd-pi
rm -f ~/.gsd/.update-check ~/.gsd/agent/managed-resources.json
npm install -g @opengsd/gsd-pi@latest
which gsd
gsd --version
```

Windows PowerShell:

```powershell
npm uninstall -g gsd-pi
Remove-Item "$env:USERPROFILE\.gsd\.update-check" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:USERPROFILE\.gsd\agent\managed-resources.json" -Force -ErrorAction SilentlyContinue
npm install -g @opengsd/gsd-pi@latest
where.exe gsd
gsd --version
```

After migration, routine upgrades use:

```bash
gsd upgrade
```

You can also run `npx @opengsd/gsd-pi@latest` to launch the installer from the new package. For deeper recovery steps, see [Upgrade GSD Pi](./docs/user-docs/getting-started.md#upgrade-gsd-pi) and [Upgrade from older gsd-pi installs](./docs/user-docs/troubleshooting.md#upgrade-from-older-gsd-pi-installs).

## Uninstall

Remove the global package and optional local GSD state files.

macOS / Linux:

```bash
npm uninstall -g @opengsd/gsd-pi gsd-pi
rm -rf ~/.gsd
```

Windows PowerShell:

```powershell
npm uninstall -g @opengsd/gsd-pi gsd-pi
Remove-Item "$env:USERPROFILE\.gsd" -Recurse -Force -ErrorAction SilentlyContinue
```

## Quick Start

Need help choosing settings? Use the [GSD Pi web configurator](https://pi.opengsd.net/) to build a configuration in your browser.

```bash
gsd
```

Run the setup flow, choose your preferred model provider, and open a project directory. GSD stores project planning and runtime state in `.gsd/`.

For a full first-run walkthrough, see [Getting Started With gsd-pi](./docs/user-docs/getting-started.md).

## Common Session Commands

Start GSD from your shell:

```bash
gsd
```

Then use slash commands inside the GSD session:

```text
/gsd config
/gsd auto
/gsd quick "Describe the task"
/gsd status
```

## What GSD Pi Does

- Plans work into milestones, slices, and tasks.
- Runs coding sessions with project context and verification steps.
- Uses Git worktrees to isolate implementation work.
- Tracks project state in a local database with markdown projections for review.
- Supports extension-based tools and provider integrations.
- Produces artifacts such as plans, summaries, validation notes, and reports.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `src/` | Core runtime resources and bundled extensions |
| `packages/` | Workspace packages used by the CLI, agent, TUI, RPC, and native bridge |
| `native/` | Native engine packaging and platform binaries |
| `studio/` | Desktop studio app |
| `web/` | Web UI and API surface |
| `vscode-extension/` | VS Code integration |
| `docs/` | User and developer documentation |
| `scripts/` | Build, release, migration, and maintenance scripts |

## Development

```bash
npm ci
npm run build
npm test
```

Before opening a pull request, run:

```bash
npm run verify:fast    # CI fast-gates locally (scans + policy)
npm run verify:pr      # Fast loop: build + typecheck + unit tests
npm run verify:merge   # Before PR review: full CI blocking parity
```

## Versioning

The active public baseline starts at `1.0.0`.

Historical tags and archived refs may exist for traceability, but active release notes should be written from this baseline forward.

## Community

Join the [GSD Discord community](https://discord.gg/8NnkKuepmQ).

## Star History

<a href="https://www.star-history.com/?repos=open-gsd%2Fgsd-pi&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=open-gsd/gsd-pi&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=open-gsd/gsd-pi&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=open-gsd/gsd-pi&type=date&legend=top-left" />
 </picture>
</a>

## License

MIT
