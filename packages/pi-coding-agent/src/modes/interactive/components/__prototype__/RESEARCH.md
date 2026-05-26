# TUI transcript design research

**Question:** What visual language should GSD Pi use for chat + tool flow — and how close can we get to Lip Gloss–quality polish within copy-clean constraints?

## Lip Gloss / Charm stack (reference, not a dependency)

[Lip Gloss](https://github.com/charmbracelet/lipgloss) treats terminal UI like CSS:

| Lip Gloss concept | GSD Pi equivalent today | Opportunity |
|---|---|---|
| Reusable `Style` objects (`.Copy()`, `.Margin()`) | `TerminalStyle` builder + `theme.fg()` | Centralize semantic styles: `styles.userTurn`, `styles.toolSuccess` |
| Adaptive colors (light/dark terminal) | `dark` / `light` / custom JSON themes | Already have; under-use `surface*` / `mode*` tokens |
| Block borders without side rails | ADR-019 **`open`** mode | Finish migration — drop rounded message bubbles |
| Join vertical blocks | Manual line arrays | Helper: `joinBlocks(gap: 0 \| 1)` |
| Tables / lists / trees | Tool phase summaries, markdown | Roll up repetitive tools like a list block |
| Glamour (markdown stylesheet) | `Markdown` component + theme tokens | Message prose as document flow, tools as subheadings |

**Speakeasy CLI pattern:** semantic color roles (`Info`, `Success`, `Warning`, `Dimmed`, `Help`) mapped once — not re-deciding colors per component. GSD already has tokens; prototypes below test *using them consistently*.

## Copy-clean constraint (ADR-019 — non-negotiable for transcript)

Body lines users copy must have **no** leading `│`, `┃`, or rail glyphs.

Allowed on non-body rows:

- Top rule: `─── Title ───────── status ───`
- Optional bottom rule (often omit for density)
- Title-row decorations (● status dot, `[You]` chip) — user rarely selects rule lines

**Eliminate for content:** full-width background fills on body lines (they pollute copy on some terminals), vertical rails, footer hint rows (move hints to title bar).

## Best practices from terminal chat UIs

1. **Role hierarchy before decoration** — scan for *who* (You / GSD / Tool) before *how pretty*. Glamour-style headings beat ornate boxes.
2. **One line per collapsed action** — collapsed tools are list items, not cards-with-cards. Repetition is the enemy (3× identical Background Shell headers).
3. **Group by phase, not by tool call** — "Shell cleanup (3)" beats three identical rules. Bubble Tea apps often batch status lines.
4. **Status on the rule, content below** — Lip Gloss puts metadata in the header margin; body stays clean prose/output.
5. **Rhythm = intentional blank lines** — zero padding everywhere feels cramped; one blank line *between turns* is enough.
6. **Semantic color sparingly** — success green on status word only; error red on title rule; body stays `text` / `dim`.
7. **Interactive chrome ≠ transcript** — keep `rounded` panels for selectors/dialogs; transcript stays `open`.

## Prototype families (run to compare)

| ID | Inspiration | Idea |
|---|---|---|
| `current` | Today | Rounded user/GSD bubbles + open tool rules |
| `open-unified` | ADR-019 complete | All turns horizontal-rule `open`; no bg fill |
| `glamour-flow` | Glamour | Document headings + flowing prose; tools as `##` sections |
| `charm-minimal` | Lip Gloss semantic | Chips, ● dots, badge-like status; tight open rules |
| `timeline` | Log stream | Timestamp-forward; phase labels; list-style tool targets |
| `phase-rollup` | Batch UX | Collapse N identical tools into one grouped block |
| `whisper` | Ultra-minimal | Prompt char + prose; half-width separators; monochrome tools |
| `lipgloss-panel` | Lip Gloss rounded | Rounded panels for messages, open tools (hybrid) |
| `compact` | Density pass | Zero padding/gaps (prior prototype) |
| `tight-tools` | Hybrid density | Comfortable bubbles, flush tool stack |

## Mapping to implementation (if we ship one)

| Change | Files |
|---|---|
| Message rails → open surfaces | `transcript-design.ts`, `user-message.ts`, `assistant-message.ts` |
| Remove leading `""` before tool blocks | `tool-execution.ts`, `bash-execution.ts` |
| Footer hints → title bar | `renderTranscriptCard` |
| Tool phase rollup UI | `ToolPhaseSummaryComponent`, `chat-controller.ts` |
| Semantic style registry | New `transcript-styles.ts` or extend `transcript-design.ts` |

## Verdict

*(pick after running `npm run prototype:tui-design`)*

- **Preferred family:**
- **Keep from current:**
- **Drop:**
- **Follow-up:**
