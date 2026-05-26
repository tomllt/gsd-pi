# Transcript design rethink (2026-05)

One visual language for chat + tool flow. Replaces the scattered 12-variant exploration.

## Problems with today

| Issue | Cause |
|---|---|
| Too much vertical air | `paddingY`, leading `""`, footer rows, bottom rules on every block |
| Repetitive tool spam | Same header repeated per call (3× Background Shell) |
| Weak grouping | Tools float as isolated cards — no sense of *work in progress* |
| Three visual dialects | Rounded user/GSD bubbles + open tool rules + mixed density |
| Copy friction | Box backgrounds and rails (partially fixed by ADR-019, not finished) |

## Design principles

1. **Copy-clean content** (ADR-019) — body lines have spaces only, never `│`/`┃`. Connectors and rules are on separate rows users rarely copy.
2. **Role before chrome** — scan *who* (You / GSD / tool) then *what*. Decoration is subservient.
3. **Work is grouped** — related actions link visually; phases have names and bridges from prose.
4. **Tight by default** — no footer hint rows; `ctrl+o` lives on the title rule. One blank line between major sections max.
5. **Semantic color on rules** — success/error on status words; body stays `text`/`dim`.
6. **Panels stay panel** — selectors/dialogs keep `rounded`; transcript stays `open`.

## Indent ladder

| Level | Cols | Use |
|---|---:|---|
| turn | 0 | User / GSD open turns |
| phase | 2 | Phase header (when not using bridge) |
| bridge | 6 | `╰─ phase name` from assistant |
| work | 4 / 6 | `│` spine + `├─`/`└─` branches (6 when bridged) |
| body | +3 | Expanded tool output under branch |

## Three directions (prototype)

Run: `npm run prototype:tui-design` (default compares all four)

| ID | Name | Best for |
|---|---|---|
| `current` | Production baseline | Before/after |
| **`gsd-flow`** | **★ Recommended** | Open turns + bridged work groups + spine tree |
| `gsd-document` | Document mode | Prose-heavy sessions; Glamour-style headings |
| `gsd-stream` | Stream mode | Maximum density; prompt-char turns |

Legacy explorations: `npm run prototype:tui-design -- explore`

## ★ GSD Flow (recommended)

```
─── You ───────────────────────────────────────────────────
tighten up the tool cards in the transcript

─── GSD ───────────────────────────── gpt-test · 1.2s ───
I'll kill the background servers and checkpoint...

      ╰─ shell cleanup ───────────────────────────────────
      │
      ├─ ─── Background Shell · bg_shell kill ── success · 340ms ───
      │
      ├─ ...
      │
      └─ ─── Background Shell ── success · 340ms · ctrl+o collapse ───
             bg_shell kill [87ad363a]
             ✓ Killed 87ad363a python3 -m http.server 3005

      ╰─ finalize ────────────────────────────────────────
      │
      ├─ ─── Save Summary · M002/S02 ── success · 120ms ───
      │
      └─ ─── Checkpoint GSD Database ── success · 89ms ───
             WAL checkpoint complete...
```

### Ship checklist (production)

- [ ] `transcript-design.ts` — open turns for user/assistant; drop `copyCleanRoundedSurface` rails
- [ ] `tool-execution.ts` — remove leading blank; footer hints → title bar; phase grouping hook
- [ ] `chat-controller.ts` — emit work-group boundaries for bridge/spine rendering
- [ ] `ToolPhaseSummaryComponent` — align with bridged phase model
- [ ] Design tests — update assistant/user contract tests for open turns

## Verdict

*(pick after reviewing prototypes)*

- Ship:
- Defer:
- Kill from current UI:
