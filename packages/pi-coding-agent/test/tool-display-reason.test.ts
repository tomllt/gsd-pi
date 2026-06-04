import { describe, expect, test } from "vitest";
import { createWriteToolDefinition } from "../src/core/tools/write.ts";
import { initTheme, theme } from "../src/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("tool displayReason rendering", () => {
	test("write errors render displayReason instead of model-facing policy text", () => {
		initTheme("dark");
		const tool = createWriteToolDefinition(process.cwd());
		const component = tool.renderResult?.(
			{
				content: [{
					type: "text",
					text: "HARD BLOCK: Cannot write to milestone CONTEXT.md without depth verification.",
				}],
				details: { displayReason: "Depth check required before writing milestone context." },
			},
			{ expanded: false, isPartial: false },
			theme,
			{ isError: true } as any,
		);

		const rendered = stripAnsi(component?.render(120).join("\n") ?? "");
		expect(rendered).toContain("Depth check required before writing milestone context.");
		expect(rendered).not.toContain("HARD BLOCK");
		expect(rendered).not.toContain("ask_user_questions");
	});
});
