import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { Agent } from "@gsd/pi-agent-core";
import { AgentSession } from "./agent-session.js";
import { AuthStorage } from "./auth-storage.js";
import type { ExtensionError } from "./extensions/types.js";
import { ModelRegistry } from "./model-registry.js";
import { DefaultResourceLoader } from "./resource-loader.js";
import { SessionManager } from "./session-manager.js";
import { SettingsManager } from "./settings-manager.js";

let testDir: string;

async function createSession() {
	const agentDir = join(testDir, "agent-home");
	const authStorage = AuthStorage.inMemory({});
	const modelRegistry = new ModelRegistry(authStorage, join(agentDir, "models.json"));
	const settingsManager = SettingsManager.inMemory();
	const resourceLoader = new DefaultResourceLoader({
		cwd: testDir,
		agentDir,
		settingsManager,
		noExtensions: true,
		noPromptTemplates: true,
		noThemes: true,
	});
	await resourceLoader.reload();

	return new AgentSession({
		agent: new Agent(),
		sessionManager: SessionManager.inMemory(testDir),
		settingsManager,
		cwd: testDir,
		resourceLoader,
		modelRegistry,
	});
}

describe("AgentSession command error reporting", () => {
	beforeEach(() => {
		testDir = mkdtempSync(join(tmpdir(), "agent-session-command-errors-"));
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("includes stack traces when extension commands throw", async () => {
		const session = await createSession();
		const emittedErrors: ExtensionError[] = [];
		const commandError = new Error("command exploded");

		(session as any)._extensionRunner = {
			getCommand: (name: string) => name === "boom"
				? {
					handler: async () => {
						throw commandError;
					},
				}
				: undefined,
			createCommandContext: () => ({}),
			emitError: (error: ExtensionError) => {
				emittedErrors.push(error);
			},
		};

		await session.prompt("/boom");

		assert.equal(emittedErrors.length, 1);
		assert.equal(emittedErrors[0].extensionPath, "command:boom");
		assert.equal(emittedErrors[0].event, "command");
		assert.equal(emittedErrors[0].error, "command exploded");
		assert.equal(emittedErrors[0].stack, commandError.stack);
	});
});
