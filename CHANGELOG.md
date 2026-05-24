<!-- GSD Pi - Project changelog -->

# Changelog

All notable changes to GSD Pi are documented in this file.

This changelog starts from the `open-gsd/gsd-pi` ownership baseline. Earlier project history is intentionally excluded from the active changelog and documented in [Legacy Release History](./docs/archive/legacy-release-history.md).

## [Unreleased]

## [1.0.2] - 2026-05-24

### Fixed
- **issue**: [Bug]: verification-gate splits task-plan verify on && — cd loses cwd, causing false failure + 5× re-dispatch loop
- **bug-3**: Upgrade docs omit uninstalling old global gsd-pi package updated upgrade troubleshooting to uninstall the old global `gsd-pi` package before installing `@opengsd/gsd-pi`.
- **bug-2**: TUI crashes instead of handling missing native visibleWidth added a TUI-side JS visible-width fallback so render paths do not propagate native proxy throws.
- **bug-1**: Linux x64 native addon is unavailable after npm install pinned native engine optional dependencies to the package version and made publish/prepublish require matching engine packages.
- **ci**: allow build-native to publish engine packages at a target semver
- **bug-2**: Worker-lock self-collision / lock leak across orchestrator iterations milestone leases now tolerate same-process re-entry and pause cleanup releases the held lease.
- **bug-1**: Milestone lifecycle desync: `status` stays `planned` after all slices complete final slice completion now promotes planned milestones to active before validation.
- **issue**: [Bug]: error on windows update from gsd-2
- **issue**: gsd update no-ops on stale higher-versioned manifest → version-mismatch gate dead-locks (incomplete fix for #14)
- **bug-2**: Wrong `unitType` string in estimate-based timeout scaling (`auto-timers.js`) changed estimate DB lookup to match the real `execute-task` unit type.
- **bug-1**: Cross-session recovery counter unconditionally reset at dispatch (`auto/phases.js`) preserved on-disk recovery attempts across fresh cross-session dispatches unless recovery ran in the current session.
- **ci**: harden native engine bootstrap and npm publish verification
- **ci**: native fallbacks for e2e and omit web from CI artifacts
- **ci**: always build web host before validate-pack
- replace leaked absolute developer paths in docs and test fixtures
- **auto**: wire ScheduleWakeup continuation

### Changed
- **ci**: extract composite actions for artifact restore and Next.js cache
- **ci**: bump cache and artifact actions to v5 for Node 24
- remove legacy GSD-2 codename across the repo

## [1.0.0] - 2026-05-22

### Changed

- Started the `open-gsd/gsd-pi` development baseline.
- Reset first-party package versions to `1.0.0`.
- Cleaned public README and changelog history for the new project ownership.

### Notes

- Historical release notes are archived outside the active changelog.
- New release notes should be added above this entry under `Unreleased`.
