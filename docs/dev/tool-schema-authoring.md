# GSD tool schema authoring

Rules for TypeBox parameters on GSD-owned extension tools (`src/resources/extensions/gsd/bootstrap/**`). These tools must pass **golden B** (`npm run test:pi-claude-schemas`) when sanitized for Claude / Cloud Code Assist.

See also: [pi-upstream.md](./pi-upstream.md), [pi-overlay-execution-plan.md](./pi-overlay-execution-plan.md).

## Required patterns

| Pattern | Use | Avoid |
|---------|-----|-------|
| String enums | `StringEnum(["a", "b"], { description })` from `@gsd/pi-ai` | `Type.Union([Type.Literal("a"), ...])` |
| String lists | `Type.Array(Type.String(), { description })` | `Type.Union([Type.Array(...), Type.String()])` |
| Open objects | `Type.Object({}, { additionalProperties: true })` | `Type.Record(...)` |
| Optional fields | `Type.Optional(Type.String(...))` | union with `undefined` |
| Structured arrays | `Type.Array(Type.Object({ ... }))` | `Type.Union([object, string])` per item |

## Cloud Code Assist / Claude constraints

The sanitizer in `packages/pi-ai/src/providers/google-shared.ts` (`toClaudeInputSchemaRoot`) strips or rewrites some patterns, but **do not rely on heuristics** for workflow tools. Forbidden at any depth after sanitization:

- `anyOf`, `oneOf`, `allOf`
- `patternProperties`, `$ref`

Root schema must be `{ type: "object", properties, required? }` only.

## High-traffic tools (rewrite at source)

These must pass golden B without sanitizer union-collapse:

- `gsd_plan_slice` — arrays only for `files`, `inputs`, `expectedOutput`
- `gsd_task_complete` — structured `verificationEvidence` objects only
- `gsd_slice_complete` — array fields only (no string fallbacks in schema)
- `capture_thought` — no `Type.Record` on `structuredFields`

Executor layers may still coerce legacy string payloads at runtime; tool schemas exposed to models must stay strict.

## MCP and legacy tools

Third-party or legacy MCP tools are sanitized at conversion time only. GSD-owned bootstrap tools must be authored correctly at registration time.

## Verification

```bash
npm run test:pi-claude-schemas
```

When changing `packages/pi-*` provider code, also update `patchAllowlist` and run:

```bash
npm run verify:pi-patches
```

## Optional follow-up

If golden B keeps catching new violations, add an ESLint/custom check for `Type.Union` / `Type.Record` under `bootstrap/**`.
