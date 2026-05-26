# Pi overlay execution plan

**Status:** Approved (2026-05-26)  
**Context:** [ADR-010](./ADR-010-pi-clean-seam-architecture.md) Phase 2 shipped seam + v0.75.5 vendor + shims in one program. Undocumented `packages/pi-*` deltas and missing provider regression tests caused production failures (Cloud Code Assist tool schema 400s, planning path validation) that felt like “band-aids after the split.”  
**Runbook:** [pi-upstream.md](./pi-upstream.md)

## Start here

**Branch naming:** `overlay/pr-N-short-description` (one PR per row below).

| Step | Branch | Ship when | Unblocks |
|------|--------|-----------|----------|
| **0** | `overlay/pr-0-policy-docs` | Docs + `patchAllowlist` seed only | Team alignment |
| **0.5** | `fix/claude-schema-sanitizer` | `google-shared.ts` + convert-tools tests + error classifier/guidance | M002 execute on Claude / Cloud Code Assist |
| **1** | `overlay/pr-1-golden-b` | Golden walk test + `test:pi-claude-schemas` in CI | Prevents sanitizer regressions |
| **2** | `overlay/pr-2-verify-patches` | `verify-pi-patches.cjs` + full `patchAllowlist` | Prevents vendor overwrite surprises |
| **3** | `overlay/pr-3-tool-schemas` | High-traffic TypeBox rewrites | Less sanitizer heuristics |
| **4** | `overlay/pr-4-authoring-doc` | `tool-schema-authoring.md` | New tools stay clean |

**Parallel track (not pi overlay):** planning slice path validation (`planning-path-scope.ts` — skip prose/`None`, resolve relative paths against worktree roots). Land as `fix/plan-slice-path-scope` whenever plan-slice validation still fails.

**Working tree today (2026-05-26):** uncommitted changes span PR 0, PR 0.5, and unrelated GSD bootstrap work — **split into separate commits/PRs** before merge; do not ship one mega-PR.

**Immediate next command after PR 0 lands:**

```bash
npm run build -w @gsd/pi-ai
npx vitest run packages/pi-ai/test/google-shared-convert-tools.test.ts
```

Then implement PR 1 golden walk (see checklist below).

## Goal

Treat vendored pi as **upstream + allowlisted, tested overlay** — not pristine upstream and not ad-hoc patches.

## Principles (locked)

| Principle | Decision |
|-----------|----------|
| pi-* changes | **No undocumented modifications** — every delta in patch inventory + CI |
| Provider regression | **Golden B** on every PR (conversion tests + all GSD tool schemas) |
| Live provider | **Golden C** optional/nightly (real Cloud Code Assist); not PR-blocking |
| New GSD tools | **Authoring rules + sanitizer** (sanitizer alone is not enough) |
| Existing tools | **Rewrite high-traffic** at source; sanitizer for MCP/legacy |
| Rule enforcement | Docs + golden B now; lint later if regressions continue |
| Execution order | **Tests → inventory/CI → tool rewrites → authoring doc** |

## PR sequence

Execute in order. Do not skip ahead — each PR defines “done” for the next.

---

### PR 0 — Policy docs (this plan + ADR amendment)

**Goal:** Align architecture docs with reality before more code.

**Changes**

- This file (`pi-overlay-execution-plan.md`)
- ADR-010 amendment: “no **undocumented** modifications”
- `pi-upstream.md`: overlay policy, verification block, patch row for Claude schema sanitization

**Acceptance**

- [x] ADR-010 and `pi-upstream.md` link here
- [ ] Team agrees PR 1–4 scope matches tables below
- [ ] `scripts/pi-upstream.json` → `patchAllowlist` seeded (expand in PR 2)

**Verify:** n/a (docs only)

**Ready to commit:** yes — docs-only PR; exclude code changes from this branch.

---

### PR 1 — Golden B: provider schema regression tests

**Goal:** CI catches Cloud Code Assist / Claude `input_schema` failures before runtime.

**Add**

1. **Conversion unit tests** (extend existing)  
   - File: `packages/pi-ai/test/google-shared-convert-tools.test.ts`  
   - Cover: `patternProperties`, `const`, nested `anyOf`/`oneOf`, empty `additionalProperties`, top-level `{ type, properties, required? }` only  
   - Entry: `convertTools(tools, true)` → `parameters` field

2. **GSD tool golden walk** (new)  
   - File: `src/resources/extensions/gsd/tests/claude-tool-schema-golden.test.ts`  
   - Register GSD workflow tools (minimum: `registerDbTools`, `registerMemoryTools`, `registerExecTools` — expand to full bootstrap surface over time)  
   - For each tool: run `convertTools([tool], true)`, assert sanitized JSON:
     - Root has only `type`, `properties`, optional `required`
     - No `\b(anyOf|oneOf|allOf|patternProperties|\$ref)\b` at any depth
   - Pattern: mock `pi.registerTool` like `tool-param-optionality.test.ts`

**Wire CI**

- Add script: `test:pi-claude-schemas` (or include in `test:packages` / `verify:pr` subset)
- Document command in `pi-upstream.md` verification block

**Acceptance**

- [ ] `npm run build -w @gsd/pi-ai && npx vitest run test/google-shared-convert-tools.test.ts` passes
- [ ] `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --test src/resources/extensions/gsd/tests/claude-tool-schema-golden.test.ts` passes
- [ ] Tests fail if `toClaudeInputSchemaRoot` / `convertTools(..., true)` is removed or reverted to upstream-only behavior

**Notes**

- Some tests may fail until PR 3 rewrites land; if so, land sanitizer fixes from current branch first, then golden walk — golden B must pass before merge.

---

### PR 2 — Patch inventory + `verify:pi-patches`

**Goal:** Undocumented `packages/pi-*` edits fail CI (prevents `2ff3dec` → `af9d27b`-style regressions).

**Add**

1. **Manifest** — `scripts/pi-upstream.json` → `patchAllowlist` array (paths relative to repo root, globs allowed)
2. **Script** — `scripts/verify-pi-patches.cjs`:
   - Compare changed files under `packages/pi-*/src/**` (vs `main` or staged diff in CI) to `patchAllowlist`
   - Fail with list of undocumented files + pointer to `pi-upstream.md`
3. **npm script** — `verify:pi-patches`
4. **CI** — run alongside `verify:pi-boundary` after pi changes

**Update patch table** in `pi-upstream.md` (minimum new rows):

| Location | Purpose |
|----------|---------|
| `packages/pi-ai/src/providers/google-shared.ts` | Claude / Cloud Code Assist tool schema sanitization (`toClaudeInputSchemaRoot`, `normalizeClaudeToolSchemaForGoogle`) |
| `packages/pi-ai/test/google-shared-convert-tools.test.ts` | Regression tests for PR 1 |

Seed `patchAllowlist` from existing “GSD patches that must survive vendoring” table + PR 1 files.

**Acceptance**

- [ ] `npm run verify:pi-patches` passes on clean tree
- [ ] Touching an unlisted file under `packages/pi-ai/src/` fails verify
- [ ] Listed files pass

---

### PR 3 — High-traffic tool schema rewrites (source)

**Goal:** Critical workflow tools don’t rely on sanitizer heuristics.

**Rewrite at source** (TypeBox parameters in bootstrap):

| Tool | File | Fix patterns |
|------|------|--------------|
| `gsd_task_complete` | `db-tools.ts` | `verificationEvidence` object\|string union → object schema + description for string fallback; drop array\|string unions on optional metadata |
| `gsd_slice_complete` | `db-tools.ts` | Same for `keyFiles`, `requirementsAdvanced`, etc. |
| `gsd_save_decision` | `db-tools.ts` | `made_by` → `StringEnum` (already partially OK) |
| `gsd_plan_slice` | `db-tools.ts` / tool params | Arrays only for `files`, `inputs`, `expectedOutput` |
| `capture_thought` | `memory-tools.ts` | `Type.Record` → `Type.Object({}, { additionalProperties: true })` or drop structured field |

**Acceptance**

- [ ] Golden B passes without sanitizer “prefer array over string” branches for these tools
- [ ] Manual smoke: plan slice + execute task on Claude via Cloud Code Assist (Golden C checklist)

---

### PR 4 — Tool schema authoring guide

**Goal:** New tools don’t reintroduce forbidden patterns.

**Add:** `docs/dev/tool-schema-authoring.md`

**Rules (summary)**

- Prefer `StringEnum([...])` from `@gsd/pi-ai` over `Type.Union` of literals
- Use `Type.Array(Type.String())` — never `Type.Union([array, string])`
- Avoid `Type.Record` — use `additionalProperties: true` on `Type.Object`
- Optional fields: `Type.Optional` on property, not union with `undefined`
- MCP tools: sanitizer handles; GSD-owned tools must pass golden B at registration time

**Link from:** `pi-upstream.md`, `plan-slice.md` prompt footer (one line)

**Acceptance**

- [ ] Doc linked from `pi-upstream.md`
- [ ] Optional follow-up: ESLint/custom check for `Type.Union` / `Type.Record` in `bootstrap/**` (only if golden B keeps catching new violations)

---

### Optional — Golden C (nightly / pre-release)

**Goal:** Confirm full active tool set against live Cloud Code Assist.

- Script or manual checklist: dispatch `execute-task` with Claude model on Antigravity/Gemini CLI
- Requires credentials; not PR-blocking
- Run after vendor bump or large tool registration changes

---

## Verification commands (target state)

After PR 2:

```bash
npm run build:pi
npm run verify:pi-boundary
npm run verify:pi-patches
npm run test:pi-claude-schemas   # PR 1
npm run test:smoke
```

After vendor bump, additionally:

1. Reconcile `patchAllowlist` against upstream diff
2. Re-run full block above
3. Optional Golden C

---

## Patch inventory maintenance

When adding a **new** GSD delta under `packages/pi-*`:

1. Implement change + tests (golden B if provider-related)
2. Add path to `scripts/pi-upstream.json` → `patchAllowlist`
3. Add row to `pi-upstream.md` patch table with **purpose**
4. PR must pass `verify:pi-patches`

When **vendoring** upstream:

1. Run vendor scripts
2. Re-apply every file in `patchAllowlist` (or merge manually)
3. Never `git checkout HEAD --` entire files unless re-validated against v0.75.5+ APIs
4. Full verification block

---

## Out of scope (for now)

- Moving pi packages to npm (ADR-010 Phase 2 npm)
- ESLint for `Type.Union` in bootstrap (unless PR 4 follow-up needed)
- Rewriting every legacy tool schema (only high-traffic + golden B failures)

---

## Tracking

| PR | Title | Status |
|----|-------|--------|
| 0 | Policy docs + execution plan | Done |
| 0.5 | Claude schema sanitizer hotfix | Done |
| — | Plan-slice path scope | Done |
| 1 | Golden B provider schema tests | Done |
| 2 | `verify:pi-patches` + inventory | Done |
| 3 | High-traffic tool schema rewrites | Done |
| 4 | Tool schema authoring guide | Done |

Update this table as PRs merge.
