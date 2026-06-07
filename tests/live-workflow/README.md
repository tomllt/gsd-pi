# gsd-pi live-workflow tests

End-to-end tests that drive the **real `gsd` binary** to dispatch a **real
agent** through the **real dispatch + verification gates** against a **real
model** — no fake-LLM transcript.

This is the live counterpart to the other two test layers:

| Layer | Dir | Agent | Network | In CI |
| --- | --- | --- | --- | --- |
| Fake-LLM e2e | `tests/e2e` | scripted JSONL transcript | none | yes (required gate) |
| Provider smoke | `tests/live` | real API, transport only | yes | no (manual) |
| **Workflow** | `tests/live-workflow` | **real agent, single unit** | yes | no (manual) |

These exist to answer one question the other layers can't: *does a real agent,
given a real plan, actually execute a dispatched unit to a correct, durable
outcome through gsd's real gates?* They are slow and cost real tokens, so they
never run in the default suite.

> **Why `next`, not `auto`?** The harness dispatches a single unit with
> `gsd headless next` rather than running the full `auto` loop. A real agent
> sails through task → slice → UAT, but `auto`'s final *milestone closeout* is
> built around human-gated checkpoints (e.g. a depth-verification confirmation)
> that the fake-LLM e2e tests script around with `--answers`; a real agent's
> closeout turn hangs in non-supervised headless mode. `next` runs the same
> real dispatch + verification gates and exits cleanly, which is the part worth
> smoke-testing live.

## Running

```bash
# 1. Build the binary the test will drive.
npm run build:core && chmod +x dist/loader.js

# 2. Export a provider credential (any vendor) and run.
export ANTHROPIC_API_KEY=...        # or OPENAI_API_KEY, or any *_API_KEY / *_OAUTH_TOKEN
GSD_LIVE_TESTS=1 \
GSD_SMOKE_BINARY="$(pwd)/dist/loader.js" \
npm run test:live-workflow
```

Without `GSD_LIVE_TESTS=1` the runner is a no-op. With it set but no provider
credential in the environment, each test **skips** (POSIX exit 77) rather than
failing.

### Env knobs

| Var | Default | Purpose |
| --- | --- | --- |
| `GSD_LIVE_TESTS` | — | Must be `1` or the suite is skipped entirely. |
| `GSD_SMOKE_BINARY` | `gsd` on PATH | Built binary to drive (recommended). |
| `*_API_KEY` / `*_OAUTH_TOKEN` | — | Provider credential, forwarded to the child. At least one required. Provider-agnostic. |
| `GSD_LIVE_WORKFLOW_MODEL` | auto-resolved | Force a model id. Unset = gsd picks the default for whichever provider's credential is present. |
| `GSD_LIVE_WORKFLOW_TIMEOUT_MS` | `300000` | Per-run dispatch timeout (wall-clock budget). Raise for slower models. |
| `GSD_LIVE_WORKFLOW_OUTPUT` | `text` | Output format. `text` = readable transcript; `stream-json` = machine-parseable JSONL. |

## How it works

Each `test-*.ts` script:

1. **Seeds a tiny milestone** in a throwaway git project — one slice, one task
   whose verification is a runnable command (`node --test ...`). The bundled
   test *fails* until the agent does the work. A `package.json` `test` script is
   included so gsd's verification gate has a host-owned check to discover and
   run; after seeding it runs `gsd headless recover` and commits the result so
   the pre-dispatch `git diff --check` guard sees a clean tree.
2. **Forwards credentials from the environment.** Any `*_API_KEY` /
   `*_OAUTH_TOKEN` in your shell is passed to the child; nothing reads or
   touches your real `~/.gsd`. The child keeps the e2e harness's isolated,
   fresh agent home, so the test behaves identically locally and in CI.
   Provider-agnostic by construction — no vendor is named anywhere.
3. **Dispatches one unit**: `gsd headless --output-format text --verbose
   --timeout <T> --max-restarts 0 [--model <M>] next`. `next` runs a single
   real agent turn (execute-task) through the verification gate, then exits —
   no milestone-closeout tail (see "Why `next`, not `auto`?" above).
4. **Asserts on durable outcomes only** — never on agent prose, which drifts:
   - exit code `0` (success; `10`=blocked, `1`=error/timeout, `11`=cancelled),
   - the task's own verification command now **passes**,
   - the agent added at least one git commit.

Artifacts (transcript + raw streams) are written under `test-results/e2e/` for
post-mortem.

## Seeing the output

By default the run uses `--output-format text --verbose`, so you get a
**readable transcript** — gsd's own progress renderer (assistant text, tool
calls with summarized args, status/notify lines, cost). It is **streamed live**
to your terminal as the agent works (the harness tees the child's
stdout/stderr via `runStreaming`), bracketed by `─── live transcript ───`
markers, and also saved for post-mortem:

```bash
# the test prints this path near the end as `transcript: <path>`
cat test-results/e2e/<timestamp>_live-tiny-milestone/transcript.txt   # clean, ANSI-stripped
# raw streams are kept alongside it:
#   dispatch.stdout.log   dispatch.stderr.log
```

Want machine-readable JSONL instead (e.g. to post-process events)? Set:

```bash
GSD_LIVE_WORKFLOW_OUTPUT=stream-json GSD_LIVE_TESTS=1 npm run test:live-workflow
# then, for just the assistant prose:
jq -rc 'select(.type=="agent_end") | .messages[]
        | select(.role=="assistant") | .content[]?
        | select(.type=="text") | .text' \
  test-results/e2e/<timestamp>_live-tiny-milestone/dispatch.stdout.log
```

## Writing a new live-workflow test

1. Create `tests/live-workflow/test-<name>.ts`. The `test-*.ts` glob is what
   `run.ts` executes.
2. Import seeding/credential helpers from `./harness.ts` and process helpers
   from `../e2e/_shared/index.ts`.
3. Skip with `process.exit(77)` when prerequisites are missing; fail with a
   non-zero exit otherwise. Use `try/finally` to clean up the tmp project
   (these are standalone scripts, not `node:test` files).
4. **Assert on durable state, not words.** Re-run a verification command,
   read the DB/markdown/git — never `assert.match` on what the model said.

## Anti-patterns

- ❌ Asserting on agent response text. It changes every run — you'll flake.
- ❌ Large/open-ended milestones. Keep tasks trivial and unambiguous; this is a
   smoke test of the *loop*, not a benchmark of model capability.
- ❌ Running in the default test suite or a required CI gate. Cost + nondeterminism.
