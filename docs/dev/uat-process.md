# UAT Process

This document names the current UAT contract so prompt, dispatch, browser tooling, and milestone validation do not drift apart.

## Pipeline Order

1. `complete-slice` persists the slice summary and UAT spec. It rejects specs that declare `artifact-driven` while requiring browser-observable checks.
2. `run-uat` runs after slice completion. It classifies the UAT spec through `src/resources/extensions/gsd/uat-policy.ts`, presents the matching tool surface, records typed evidence, and saves one `S##-ASSESSMENT.md` plus a typed attempt record through `gsd_uat_result_save`.
3. `validate-milestone` runs after all slices close. It dispatches three reviewers in parallel: requirements coverage, cross-slice integration, and assessment/acceptance evidence. It consumes UAT assessments; it is not the UAT producer.
4. `complete-milestone` runs only after validation records a passing milestone verdict.

## UAT Mode Policy

`uat-policy.ts` is the source of truth for:

- Declared and effective UAT mode classification.
- Artifact-driven specs that must be escalated to browser-backed UAT.
- Which UAT modes receive browser tools.
- Which modes may produce `PARTIAL`.
- Result-save requirements such as runtime evidence for `runtime-executable` and browser evidence for `browser-executable`.
- Dispatch-time browser tool support checks when an active tool snapshot is available.

## Browser And Playwright

GSD exposes a product-level Browser Automation Contract with canonical `browser_*` tool names. Per ADR-024, Playwright-backed browser tools are the default Pi Provider path. `gsd-browser` remains available for External MCP Clients and explicit managed-engine opt-in.

`browser-executable`, `live-runtime`, `mixed`, and `human-experience` UAT modes require browser tools when the active tool snapshot is known. If no browser tool is present, dispatch stops before burning a UAT retry attempt. A UAT that uses a Playwright command should be declared `runtime-executable` and should record runtime evidence through `gsd_uat_exec`.

## Current Guardrails

- `complete-slice` blocks browser-required specs mislabeled as `artifact-driven`.
- `run-uat` requires `gsd_uat_result_save` and rejects forbidden summary/gate write substitutes.
- `src/resources/extensions/gsd/uat-run.ts` owns `gsd_uat_result_save` lifecycle preparation, run IDs, attempt metadata, worktree capture, and assessment rendering.
- `gsd_uat_result_save` validates objective evidence, fresh UAT-owned exec evidence, canonical tool presentation, and mode-specific evidence before saving the assessment and attempt artifact.
- Manual handoff text includes the real worktree path when checks are left as `NEEDS-HUMAN`.
- Milestone validation downgrades a pass to `needs-attention` when browser-observable acceptance criteria lack persisted browser/runtime evidence.

## Next Deepening Opportunities

- Persist each milestone reviewer output separately before aggregating the final validation verdict.
- Promote file-backed UAT attempt records into DB-indexed run records if queue inspection needs SQL access.
- Bind browser PASS evidence to concrete browser tool calls, browser artifacts, or explicit runtime-executable Playwright evidence.
