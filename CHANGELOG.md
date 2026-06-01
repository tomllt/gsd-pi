<!-- GSD Pi - Project changelog -->

# Changelog

All notable changes to GSD Pi are documented in this file.

This changelog starts from the `open-gsd/gsd-pi` ownership baseline. Earlier project history is intentionally excluded from the active changelog and documented in [Legacy Release History](./docs/archive/legacy-release-history.md).

## [Unreleased]

## [1.1.1] - 2026-05-31

### Fixed
- sync engine package lockfile entries
- wait for npm release tarball propagation

## [1.1.0] - 2026-05-31

### Added
- add Claude Opus 4.8 model support
- **gsd**: add /gsd usage and /gsd context observability commands
- **gsd**: wire unit-context-manifest skills policy into scoping
- **gsd**: scope skill catalog and trim duplicate prompt surfaces
- **installer**: redesign npx-primary guided install flow
- **gsd**: enhance requirements backlog handling and completion summaries
- **gsd**: implement quick branch inference and cleanup logic
- **github-sync**: enhance milestone closing logic and error handling
- enhance tool execution handling and improve component registration
- enhance transcript rendering with connected user support
- **pi**: gap closure, test confidence stack, verify:pi-boundary in CI
- **pi**: ADR-010 seam remediation phases A–F
- **pi**: ADR-010 clean seam and vendor earendil-works/pi v0.75.5 (Phase 0–2)
- **models**: add dedicated uat model slot in preferences
- add gsd-mcp runtime binary
- persist cloud gateway auth state
- add cloud MCP gateway local runtime

### Fixed
- stabilize pack install integration test
- publish prod native packages inline
- project root artifacts into worktrees
- avoid root auto-commit during milestone recovery
- avoid root auto-commit during milestone recovery
- project root artifacts into worktrees
- **mcp**: recover missing status and gate args
- preserve aliases in full tools mode
- **gsd**: sync marker after state recovery
- preserve marker identity with repo metadata
- ignore stale gsd identity markers
- **gsd**: log repo identity remote failures
- **gsd**: retry missing complete-slice replan artifact
- **gsd**: ignore nested SvelteKit types imports
- **bug-2**: Verification pause message hides actual failing check auto-mode post-exec pause message now surfaces the actual failing check category/target/message.
- **bug-1**: SvelteKit './$types' imports falsely fail post-exec checks import-resolution post-exec checks now skip SvelteKit `./$types` generated modules.
- **gsd**: refresh reconciliation blocker snapshot
- fail closed on mixed persistent drift blockers
- **gsd**: preserve drift blockers and orchestration retries
- clear verification retry after closed dispatch skip
- add slice drift repair guidance
- **gsd**: prioritize reconciliation blockers
- **issue**: Auto-mode stuck-loop re-dispatches already-completed execute-task units
- preserve discovered skill prompt fallback
- surface new skills when catalog reload fails
- pause on orchestration drift errors
- await extension sendMessage turns
- **issue**: [Bug]: Discord invite expired in readme and via bot
- report terminal drift as blockers
- **gsd**: resolve worktree registry root from checkout
- **bug-2**: Pytest command runs from wrong cwd in monorepo subproject setup corrected repository root resolution so verification executes in the intended subproject cwd.
- **auto**: avoid provider false positives from zero-tool prose
- **pi-ai**: remove duplicate response id normalization
- **issue**: complete-slice retries forever when gsd_replan_slice is the correct outcome
- **gsd**: align drift checks for reopened artifacts
- **gsd**: allow hook retries after finalization
- **issue**: fix(pi-ai): ensure unique OpenAI Responses message ids after cross-model thinking downgrade
- **pi-ai**: keep Bedrock lifecycle test out of src
- **gsd**: align reopen drift checks
- **gsd**: clear auto skill visibility after units
- **gsd**: dedupe provider error guards
- **issue**: [Bug]: retry_on post-unit hook stops auto-mode when same execute-task is re-dispatched
- preserve hook model overrides in orchestrator path
- align GSD drift artifact resolution
- **gsd**: refresh skill discovery from disk
- suppress missing origin repo identity warning
- **issue**: chore(pi-ai): regenerate Bedrock model registry for Opus 4.8 + port lifecycle validation test
- **issue**: UOK orchestrator bypasses pre_dispatch_hooks — policy injection never fires
- **issue**: discuss-slice: gsd_summary_save not found — missing entry in AUTO_UNIT_SCOPED_TOOLS
- **issue**: Project with configured remote falls into first-time-init: getRemoteUrl() swallows transient git failures, flipping the identity hash
- **issue**: discardMilestone silently skips DB cleanup when MCP server holds WAL connection
- avoid mocked timer in rate limit test
- guard gsd drift recovery
- **bug-1**: Zero-tool-call retries spin on provider error messages zero-tool-call completions with transient provider/rate-limit assistant messages now pause with backoff/auto-resume instead of immediate retry.
- **gsd**: reserve dialog frame rows in overlays
- add scrolling to GSD dialogs
- **gsd**: unify slash dialog borders
- remove TUI assistant background
- ignore CLI auth sentinels in doctor routes
- enforce CLI readiness for external providers
- check Google CLI provider binaries in doctor
- gate all stranded work during auto bootstrap
- honor stranded work recovery gates
- block closeout resolution when git status is unavailable
- **gsd**: allow setup flows outside git repos
- **extensions**: harden native tool edge cases
- align pnpm execpath detection
- tighten pnpm install detection
- tighten pnpm install path detection
- collapse interactive tool output by default
- preserve hook preference file precedence
- **web**: avoid phantom SSE shutdown on beforeExit
- **ci**: repair dist-test node_modules for coverage
- **publish**: remove @gsd/* from root dependencies to fix EUNSUPPORTEDPROTOCOL on install
- align shell pack validation daemon checks
- validate opengsd external deps
- harden npm pack validation
- **publish**: drop bundledDependencies to resolve E415 (537MB/85k files → 41MB/8.5k)
- **bootstrap**: exit on EPIPE storm instead of swallowing in a tight loop
- cap R3b recovery retries
- prevent false-positive approval gate re-trigger after depth verification
- use pnpm camelCase package import setting
- set package-import-method=copy to prevent hard-link E415 on npm publish
- **tests**: only redirect relative .js to .ts when the .ts source exists
- dereference pnpm symlinks when seeding global validate-pack deps
- seed all missing root externals in validate-pack global smoke
- seed bundled transitive deps in validate-pack global smoke
- drop MCP SDK runtime import from validate-pack global smoke
- resolve hoisted openai path in validate-pack global smoke
- avoid OOM when seeding openai in validate-pack global smoke
- unlink pnpm symlinks before materializing bundled deps
- restore workspace:* root deps after prepack regression
- resolve bundled deps on global install in validate-pack
- preserve pnpm CI verification coverage
- make validate-pack pass with pnpm workspace protocol
- restore green unit tests and validate-pack under pnpm
- remove redundant publish workflow cache setting
- use pnpm cache in prerelease verify
- align dist-test resolution and package manifest with pnpm workspaces
- **installer**: materialize deps after global --ignore-scripts install
- use pnpm optional install flag
- **pi-ai**: unblock build by removing @smithy/types import
- account for context overhead in donut chart
- satisfy SessionEntry types in context/usage extension tests
- write context reports under project root
- **install**: bundle extension-critical deps for clean global installs
- **installer**: show GSD-Pi wordmark only once during guided install
- **ci**: use GitHub-hosted runners for build-native npm publish
- resolve Windows npm global bin path
- **packaging**: merge global node_modules and refresh --help branding
- **bug-2**: doctor-checks misses DB-present/filesystem-missing orphan state doctor runtime checks now report DB-row-present/filesystem-missing milestone drift as `orphan_milestone_db`.
- **bug-1**: discardMilestone skips DB cleanup when milestone dir is missing `discardMilestone` now cleans DB state even when milestone directory is already missing.
- **packaging**: resolve undici after npm global install
- **ci**: treat already-tagged npm versions as successful publish re-runs
- resolve npm global root in validate pack
- **gsd**: avoid swallowing network ECONNRESET
- **branding**: render block P and i in GSD-Pi wordmark
- **installer**: prevent handoff timeout and spinner corruption
- **installer**: allow postinstall before dist/logo.js is built
- **branding**: narrow GSD-Pi wordmark for 80-column welcome layout
- **installer**: preserve clack spinner during npm install
- **packaging**: resolve @gsd/agent-core imports in pi-coding-agent re-exports
- **ci**: use GitHub-hosted runners for npm publish provenance
- **ci**: pin dev publishes to stable engine packages on npm
- **test**: satisfy strict null check in agent-shim test
- block direct workflow dispatch during validation
- **test**: satisfy strict null check in agent-shim test
- **test**: unblock coverage-report package test failures
- **test**: unblock coverage-report package test failures
- **gsd**: keep diagnostics available during validation blocks
- **test**: unblock test-coverage job failures
- **auto**: complete-slice reopen handoff when DB is unavailable
- **ci**: keep workspace links during dev version stamping
- **ci**: stop integration tests from hanging on orphaned gsd subprocesses
- **worktree**: restore JSONL marker cleanup in stash collision path
- **gsd**: list /gsd memory in full help menu
- **worktree**: dedupe stash-restore locals after main merge
- **gsd**: remove unreachable empty-string blocklist entry
- block workflow starters during unmerged milestones
- **e2e**: clear deferred depth gate after ask_user_questions confirms
- block unmerged milestone dispatch aliases
- clear auto model override after stop
- avoid orphaning stale UAT renders
- **gsd**: block new-project with unmerged milestones
- **gsd**: include memory in command description
- **bug-2**: Stale `full_uat_md` in DB is not cleared when UAT files are deleted stale-render reconciliation now clears `full_uat_md` in DB when `UAT.md` is deleted from disk.
- **bug-1**: Browser evidence gate scans UAT docs and misflags CLI milestones browser requirement detection no longer scans `slice.full_uat_md`, preventing UAT planning text from triggering the gate.
- **issue**: /gsd auto can ignore selected/persisted non-Claude model and reroute to Claude-family model
- **issue**: unmerged-milestone-guard blocks all /gsd commands including read-only diagnostics (forensics, capture, knowledge, prefs)
- **issue**: /gsd memory missing from autocomplete catalog
- **issue**: Crash/hang at question & save gates: `ProcessTransport is not ready for writing` falls through guard to process.exit(1)
- keep distinct discuss follow-up questions
- **issue**: Plan-slice prompt lacks scope deliverable coverage audit — documents listed in CONTEXT.md Scope table get dropped
- **ci**: allow-source-grep for generated-models catalog formatting test
- preserve chat turn bridges across tool rows
- **ci**: run pi-ai vitest against packages/pi-ai/dist on Windows
- **ci**: invoke vitest via node on Windows package tests
- **ci**: recognize pi-ai vitest paths on Windows runners
- **ci**: split pi-ai node:test and vitest; fix smart-entry notification assert
- **ci**: align tests with git preflight, discuss routing, and pi-ai vitest
- **tests**: satisfy extension typecheck for CI build
- **discuss**: route new milestones to guided interview and suppress duplicate asks
- **issue**: complete-slice retry loop silently drops a reopened task via empty replan
- **gsd**: preserve crash exit cleanup semantics
- **bug-2**: Uncaught exception guards exit without releasing auto-mode locks unrecoverable guards now terminate via SIGTERM cleanup path and cleanup signal coverage now includes SIGBREAK.
- **bug-1**: Windows pipe-closure errors not treated as recoverable broadened recoverable pipe-closure detection to include Windows EOF/connection-reset variants so they are swallowed like EPIPE.
- **gsd**: keep grep/find/ls available during guided discuss dispatches
- handle empty read args only for read tool
- **gsd**: map requirements backlog when starting new milestone
- address chat turn and shim review findings
- address PR bug detection findings
- **pi-ai**: use assert in normalize-tool-arguments test for tsc build
- restore project artifact fallback
- **gsd**: resolve milestone artifacts from worktree projections
- **bug-2**: Missing uninstall instructions in README added README uninstall steps for global package removal and local state cleanup.
- **bug-1**: Fresh install is non-functional fixed install-mode detection so only real postinstall contexts use postinstall flow.
- **bug-2**: Projection doesn't filter superseeded rows KNOWLEDGE projection now filters out superseded memory rows.
- **bug-1**: `capture_thought` never supersedes old rows capture path now supersedes prior active same-category memory rows with the same `structuredFields.sourceKnowledgeId`.
- install deps for fast verification
- **agent-loop**: restore consecutive tool validation failure cap
- **ci**: restore e2e fake LLM and truncateForSummary export
- **issue**: verification-gate: pipes (|) in task-plan Verify commands are rejected as unsafe, causing false 'no-host-checks' pause
- **build**: resolve pi bootstrap and agent-modes theme imports
- **models**: drop stale kimi-k2.5 metadata override in generator
- share tool argument normalization
- retry MCP smoke install failures
- preserve connected tool turn rendering
- **pi**: unblock workspace install and pi boundary verification
- stabilize tool invocation matching
- **gsd**: merge completed milestones when ROADMAP projection is missing
- **pi-coding-agent**: keep identical parallel tool calls separate
- **pi-ai**: restore Google provider switch reports
- **pi-ai**: derive Mistral stream message type from request shape
- **pi-ai**: use singular Mistral stream message type export
- external worktree state routing and tool argument normalization
- **gsd**: report effective verdict after gate downgrade
- **ci**: avoid actor-scoped checkout token
- **pi-ai**: restore Gemini 3 tool call signatures
- keep MCP and complex-schema tools available on Google providers
- **pi-ai**: correct Mistral stream message type import
- harden pi overlay for Cloud Code Assist Claude tool schemas
- **ci**: make coverage report non-blocking
- **ci**: install web deps for coverage report
- wait for workspace packages after publish
- **pi**: export BuildSystemPromptOptions from system-prompt seam
- **pi**: import bridge session types from @gsd/agent-core
- **issue**: pre_dispatch_hooks and post_unit_hooks silently ignored in worktree isolation mode — resolvePreDispatchHooks/resolvePostUnitHooks drop basePath
- **issue**: checkoutBranchWithStashGuard fails when stash contains untracked files tracked on target branch
- **gsd**: restore complete-slice isolation cues
- **issue**: checkoutBranchWithStashGuard fails when stash contains untracked files tracked on target branch
- **issue**: worktree isolation: agent writes code to project root instead of worktree (missing path-rewriting instruction in prompts)
- **issue**: [Bug]: Unusuable, unresponsive, fresh install
- repair descriptor roadmap renders
- detect stale worktree roadmaps in projection
- resolve projected roadmap paths
- **issue**: Artifact renderers use inconsistent gsdRoot vs gsdProjectionRoot when running inside a worktree causing stale-mirror verification failures
- inline bridge session event shim
- avoid agent-core build-order dependency
- narrow codeql-pr surfaced alerts
- restore bridge service search handling
- drop noisy codeql path hardening
- tighten project path allowlist
- clear remaining codeql blockers
- harden codeql hotspots
- unstick unit and portability CI
- stop repeated all-error tool loops
- restore test runtime compatibility across prompt and e2e paths
- bundle internal workspace packages for publish
- repair extension CI compatibility
- narrow pi-tui secret scan ignore
- filter discovered models by provider readiness
- **agent-core**: preserve compaction truncation tails
- restore legacy session switch hooks
- **pi**: restore GSD root-app shims for build:core (Phase 2b)
- **issue**: [Bug] execute-task re-dispatched after task is complete when verification gate fails with pre-existing errors
- **issue**: [Bug]: verification-gate treats 'bash: <cmd>' prefix as command name — exit 127 triggers 5× re-dispatch loop
- **gsd**: allow safe verify metacharacters
- **gsd**: preserve codebase cache timestamp
- answer headless approval gates
- detect opengsd pnpm workspace scope
- **issue**: ModelPolicyDispatchBlockedError: cross_provider:false blocks explicit unit model configs when previous unit ran on different provider
- **compaction**: preserve history on empty summaries
- clean up remaining opengsd package references
- **bug-2**: Generated files ignore .gitignore rules smart staging now honors `.gitignore` for `.gsd` even when files were already tracked.
- **bug-1**: GitOps disabled still creates commits disabled GitOps now skips commit closeout paths instead of converting to commit mode.
- dereference symlinks in findWorkflowCliFromAncestorPath
- **pi-ai**: normalize Claude tool schemas for Cloud Code Assist
- **bug-2**: Crash logs use unbounded per-call filenames crash logs now append to one per-PID file instead of creating timestamped files per call.
- **bug-1**: Recoverable EPIPE events write crash logs EPIPE is handled as recoverable without writing crash artifacts.
- **ollama**: trust /api/show context, sync num_ctx, and fix KNOWN_MODELS drift
- **ollama**: detect thinking capability from /api/show.capabilities
- **bug-2**: Command error reporting omits stack traces extension command errors now include stack traces when available.
- **bug-1**: fileFingerprint crashes on dirty files over 2 GiB oversized dirty tracked files now avoid Node's readFileSync Buffer limit.
- **bug-3**: Pre-dispatch break leaves ghost iterations open pre-dispatch break now finishes the open journal iteration.
- **bug-2**: Unhandled-phase warnings pause instead of retrying fresh state unhandled-phase warnings now retry dispatch once with freshly derived state before pausing.
- **bug-1**: pauseAuto aborts in-flight units after dispatch pre-dispatch health-gate pause is guarded against active units and covered by regression.
- **test**: stabilize CI coverage and implementation artifact detection (#84)
- **release**: keep package-lock in sync with engine optionalDependencies

### Changed
- **tokens**: dedupe always-on prompt rules, tool guidelines, and subagent prose
- **tokens**: trim the 16 longest always-on skill descriptions
- **tokens**: gate the browser tool surface behind opt-in in interactive mode
- **tokens**: scope plain interactive chat to the minimal GSD tool surface
- **tokens**: drop 14 workflow alias tools from advertised surface
- **tokens**: dedupe always-on prompt rules, tool guidelines, and subagent prose
- **tokens**: trim the 16 longest always-on skill descriptions
- **tokens**: gate the browser tool surface behind opt-in in interactive mode
- **tokens**: scope plain interactive chat to the minimal GSD tool surface
- **tokens**: drop 14 workflow alias tools from advertised surface
- **pi-ai**: refresh generated model catalog
- **gsd**: unify skill loading and wire skillFilter
- drop accidental artifacts and unrelated model registry churn

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
