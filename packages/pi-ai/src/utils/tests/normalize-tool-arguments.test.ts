import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Type } from "@sinclair/typebox";
import { normalizeToolArguments } from "../normalize-tool-arguments.js";
import { validateToolArguments } from "../validation.js";

describe("normalizeToolArguments", () => {
	test("aliases filePath to path for read", () => {
		const args = { filePath: "src/app.js" };
		normalizeToolArguments("read", args);
		assert.deepEqual(args, { path: "src/app.js" });
	});

	test("aliases file_path to path for write", () => {
		const args = { file_path: "src/app.js", content: "x" };
		normalizeToolArguments("write", args);
		assert.deepEqual(args, { path: "src/app.js", content: "x" });
	});

	test("aliases file to path for read", () => {
		const args = { file: ".gsd/milestones/M003/M003-CONTEXT.md" };
		normalizeToolArguments("read", args);
		assert.deepEqual(args, { path: ".gsd/milestones/M003/M003-CONTEXT.md" });
	});

	test("parses JSON-string tasks for subagent", () => {
		const args = {
			tasks: '[{"agent":"tester","task":"Evaluate Q3"}]',
		};
		normalizeToolArguments("subagent", args);
		assert.deepEqual(args.tasks, [{ agent: "tester", task: "Evaluate Q3" }]);
	});

	test("leaves non-JSON strings unchanged", () => {
		const args = { tasks: "not-json" };
		normalizeToolArguments("subagent", args);
		assert.equal(args.tasks, "not-json");
	});
});

describe("validateToolArguments integration", () => {
	test("accepts read calls that use filePath instead of path", () => {
		const tool = {
			name: "read",
			description: "read",
			parameters: Type.Object({
				path: Type.String(),
			}),
		};
		const validated = validateToolArguments(tool, {
			type: "toolCall",
			id: "read-1",
			name: "read",
			arguments: { filePath: "README.md" },
		});
		assert.equal(validated.path, "README.md");
	});

	test("accepts read calls that use file instead of path", () => {
		const tool = {
			name: "read",
			description: "read",
			parameters: Type.Object({
				path: Type.String(),
			}),
		};
		const validated = validateToolArguments(tool, {
			type: "toolCall",
			id: "read-2",
			name: "read",
			arguments: { file: "README.md" },
		});
		assert.equal(validated.path, "README.md");
	});
});
