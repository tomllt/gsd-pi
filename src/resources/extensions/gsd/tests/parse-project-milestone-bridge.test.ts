// gsd-pi / parseProject MILESTONE_LINE_RE bridging regression
//
// Guards against a silent data-integrity bug: MILESTONE_LINE_RE used `\s+`
// around its separator, and `\s` matches newlines. A milestone line lacking a
// valid internal separator could therefore "bridge" onto the NEXT bullet's
// `- `, consuming it as the separator and swallowing the following well-formed
// milestone. The separator gaps are now horizontal-whitespace-only so a line
// can never span a newline.
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { parseProject } from "../schemas/parsers.ts";

function milestoneSection(...lines: string[]): string {
  return ["# Project", "", "## Milestone Sequence", "", ...lines, ""].join("\n");
}

describe("parseProject milestone bridging", () => {
  test("a malformed milestone line does not swallow the following well-formed one", () => {
    // M001 uses an invalid " : " separator; M002 is canonical. Before the fix
    // this returned a SINGLE match (M001 with oneLiner "[ ] M002: Baz — qux"),
    // dropping M002 entirely.
    const content = milestoneSection(
      "- [ ] M001: Foo : bar",
      "- [ ] M002: Baz — qux",
    );

    const { milestones } = parseProject(content);

    // M002 must survive intact — it must NOT be consumed as M001's one-liner.
    const m002 = milestones.find(m => m.id === "M002");
    assert.ok(m002, "M002 must be registered, not swallowed by the malformed M001 line");
    assert.equal(m002!.title, "Baz", "M002 title parsed cleanly");
    assert.equal(m002!.oneLiner, "qux", "M002 one-liner parsed cleanly");

    // No milestone may have bridged the M002 bullet into its own one-liner.
    assert.ok(
      !milestones.some(m => m.oneLiner.includes("M002")),
      "no milestone may bridge across the newline and consume the M002 bullet",
    );

    // M001 has no valid separator, so it is skipped — consistent with the
    // empty-parse hard-fail in execute-summary-save-empty-project.test.ts.
    // The fixture therefore yields exactly the one well-formed milestone.
    assert.deepEqual(milestones.map(m => m.id), ["M002"], "only the well-formed milestone parses");
  });

  test("two well-formed milestones on adjacent lines both parse", () => {
    const content = milestoneSection(
      "- [x] M001: Foo — bar",
      "- [ ] M002: Baz — qux",
    );

    const { milestones } = parseProject(content);
    assert.deepEqual(
      milestones.map(m => ({ id: m.id, title: m.title, oneLiner: m.oneLiner, done: m.done })),
      [
        { id: "M001", title: "Foo", oneLiner: "bar", done: true },
        { id: "M002", title: "Baz", oneLiner: "qux", done: false },
      ],
      "adjacent canonical milestone lines are parsed independently",
    );
  });

  test("a trailing malformed line cannot bridge onto a following bullet of any kind", () => {
    // The last milestone is malformed and is followed by a non-milestone list
    // bullet. The malformed line must be skipped without consuming the bullet.
    const content = milestoneSection(
      "- [ ] M001: Foo — bar",
      "- [ ] M002: Baz : qux",
      "- some unrelated bullet",
    );

    const { milestones } = parseProject(content);
    assert.deepEqual(milestones.map(m => m.id), ["M001"], "malformed M002 is skipped, not bridged onto the unrelated bullet");
  });
});
