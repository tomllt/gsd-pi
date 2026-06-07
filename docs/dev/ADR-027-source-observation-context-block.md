# Source Observation Context Block

GSD auto-mode should not depend on historical `read` tool results remaining visible in the provider transcript for a Unit to reason about source files. Observation Budgeting, provider-specific payload conversion, and narrow line-window reads can make small files disappear or appear partial on later turns, which encourages repeated rereads and line-number thrash. The long-term fix is a mechanical source-observation contract, not a larger default truncation cap or more prompt guidance.

## Decision

The Tool Contract module owns a source-observation invariant for source-reading Units. Each active Unit has a Source-observation set: files declared by the Unit plan plus files successfully read during the Unit when they fit the Whole-File Observation threshold. For `execute-task`, plan-declared files are `task.files` plus concrete filesystem-looking entries from `task.inputs`; `expectedOutput` is acceptance/output language and does not seed source context.

Whole-File Observations are limited to text files at or below the existing read-tool cap: 50KB and 2000 lines. Plan-declared files that fit the threshold are preloaded before the first Provider turn. If the model asks for a narrow `read` slice of an under-threshold file, the visible tool result remains the requested slice, but the File Observation auto-upgrades to whole-file coverage in the background.

Provider request assembly injects a Source Context Block generated from the active Unit's Source-observation set on every Provider call. This block is deliberate Unit context; it does not rely on old tool-result messages surviving masking, truncation, or Responses-vs-messages conversion. Observation Budgeting may still mask and truncate historical tool results, but it must not silently discard the active Unit's protected Source Context Block.

Files that cannot become Whole-File Observations are represented explicitly in the Source Context Block as unavailable: missing, binary/image, over-threshold, glob, directory, or unresolved selector. Existing pre-execution validation still blocks impossible `task.inputs`; missing `task.files` may be legitimate creation targets and should not fail the Unit by itself.

After the Unit closes, whole-file content may degrade to metadata or summary. Full source text is protected for the active Unit only.

## Consequences

- Known small files are available from the first Provider turn, so the model should not spend turns reconstructing them through `offset`/`limit` windows.
- `context_management.tool_result_max_chars` can stay a general bloat control instead of carrying source-retention semantics.
- The read tool, Tool Contract, Unit planning resolver, and provider-payload masking hook need an explicit shared contract for File Observation metadata and Source Context Block injection.
- Tests should cover plan preloading, narrow-read auto-upgrade, provider payload masking, unavailable statuses, and Unit-close degradation.

## Alternatives Considered

- **Increase `tool_result_max_chars` globally.** This helps the immediate symptom but does not fix narrow reads, history aging, provider payload shape differences, or source files that need deliberate Unit-level retention.
- **Preserve original `read` tool results verbatim.** Rejected because it couples source context to transcript position and provider conversion details, and it makes old tool output hard to budget.
- **Prompt the model to stop using line windows.** Rejected as the primary fix because the failure is mechanical: a small file can be known completely even when the model asked for a slice.
- **Fail preflight for every unavailable plan-declared file.** Rejected because `task.files` can name files the task intends to create; unavailable status is more precise than a false blocker.
