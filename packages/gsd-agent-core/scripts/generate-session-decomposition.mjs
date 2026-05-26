#!/usr/bin/env node
/**
 * Decompose agent-session.ts into session/* modules + thin facade.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcPath = path.join(root, "src/agent-session.ts");
const sessionDir = path.join(root, "src/session");
const source = fs.readFileSync(srcPath, "utf8");

const classStart = source.indexOf("export class AgentSession {");
const classEnd = source.lastIndexOf("\n}");
const classBody = source.slice(classStart, classEnd + 2);
const fileHeader = source.slice(0, classStart);

function extractMethodBody(name, opts = {}) {
	const { isArrow = false, isGetter = false, isSetter = false } = opts;
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	let pattern;
	if (isArrow) {
		pattern = new RegExp(`\\t(?:private )?${escaped} = (?:async )?\\(`, "m");
	} else if (isGetter) {
		pattern = new RegExp(`\\tget ${escaped}\\(`, "m");
	} else if (isSetter) {
		pattern = new RegExp(`\\tset ${escaped}\\(`, "m");
	} else {
		pattern = new RegExp(`\\t(?:(?:private|public|protected|async)\\s+)*${escaped}(?:<[^>]*>)?\\(`, "m");
	}

	const match = pattern.exec(classBody);
	if (!match) return null;

	let parenStart = classBody.indexOf("(", match.index);
	if (parenStart === -1) return null;

	let parenDepth = 0;
	let braceStart = -1;
	for (let i = parenStart; i < classBody.length; i++) {
		const ch = classBody[i];
		if (ch === "(") parenDepth++;
		else if (ch === ")") {
			parenDepth--;
			if (parenDepth === 0) {
				braceStart = classBody.indexOf("{", i);
				break;
			}
		}
	}
	if (braceStart === -1) return null;

	let depth = 0;
	for (let i = braceStart; i < classBody.length; i++) {
		if (classBody[i] === "{") depth++;
		else if (classBody[i] === "}") {
			depth--;
			if (depth === 0) return classBody.slice(match.index, i + 1);
		}
	}
	return null;
}

const hostFields = [
	"scopedModels",
	"unsubscribeAgent",
	"eventListeners",
	"steeringMessages",
	"followUpMessages",
	"pendingNextTurnMessages",
	"compactionAbortController",
	"autoCompactionAbortController",
	"overflowRecoveryAttempted",
	"branchSummaryAbortController",
	"retryAbortController",
	"retryAttempt",
	"lastTurnCost",
	"bashAbortController",
	"pendingBashMessages",
	"extensionRunner",
	"turnIndex",
	"customTools",
	"baseToolDefinitions",
	"cwd",
	"extensionRunnerRef",
	"initialActiveToolNames",
	"allowedToolNames",
	"baseToolsOverride",
	"sessionStartEvent",
	"extensionUIContext",
	"extensionCommandContextActions",
	"extensionAbortHandler",
	"extensionShutdownHandler",
	"extensionErrorListener",
	"extensionErrorUnsubscriber",
	"visibleSkillNames",
	"toolRegistry",
	"toolDefinitions",
	"toolPromptSnippets",
	"toolPromptGuidelines",
	"baseSystemPrompt",
	"baseSystemPromptOptions",
	"lastAssistantMessage",
];

const hostGetters = [
	"agent",
	"sessionManager",
	"settingsManager",
	"modelRegistry",
	"resourceLoader",
	"model",
	"thinkingLevel",
	"isStreaming",
	"systemPrompt",
	"messages",
	"steeringMode",
	"followUpMode",
	"sessionFile",
	"sessionId",
	"sessionName",
	"promptTemplates",
	"isCompacting",
	"pendingMessageCount",
	"state",
];

function rewriteBody(code, { moduleMethods = [], hostMethods = [] }) {
	let result = code.replace(/\tprivate /g, "\t").replace(/\tpublic /g, "\t");
	for (const m of moduleMethods) {
		result = result.replaceAll(`this._${m}`, `this.${m}`);
	}
	for (const m of hostMethods) {
		result = result.replaceAll(`this._${m}`, `this.host.${m}`);
		result = result.replaceAll(`this.${m}(`, `this.host.${m}(`);
	}
	for (const f of hostFields) {
		result = result.replaceAll(`this._${f}`, `this.host._${f}`);
	}
	for (const g of hostGetters) {
		result = result.replace(new RegExp(`this\\.${g}(?![\\w])`, "g"), `this.host.${g}`);
	}
	result = result.replaceAll("this._resourceLoader", "this.host.resourceLoader");
	result = result.replaceAll("this._modelRegistry", "this.host.modelRegistry");
	result = result.replaceAll("this.host.host.", "this.host.");
	return result;
}

function transformMethod(raw, spec, moduleMethods, hostMethods) {
	let body = rewriteBody(raw, { moduleMethods, hostMethods });
	if (spec.exportAs && !spec.isArrow) {
		body = body.replace(
			new RegExp(`^\\t(?:async )?${spec.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
			`\t${spec.isAsync ? "async " : ""}${spec.exportAs}`,
		);
	}
	if (spec.isArrow && spec.exportAs) {
		body = body.replace(
			new RegExp(`^\\t${spec.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} =`),
			`\t${spec.exportAs} =`,
		);
	}
	if (spec.isGetter && spec.exportAs) {
		body = body.replace(new RegExp(`^\\tget ${spec.name}`), `\tget ${spec.exportAs}`);
	}
	return body;
}

const MODULES = {
	"agent-session-prompt.ts": {
		className: "AgentSessionPromptModule",
		imports: `import type { AgentMessage, ThinkingLevel } from "@gsd/pi-agent-core";
import type { AssistantMessage, ImageContent, TextContent } from "@gsd/pi-ai";
import { isContextOverflow } from "@gsd/pi-ai";
import { formatNoApiKeyFoundMessage, formatNoModelSelectedMessage } from "@gsd/pi-coding-agent/core/auth-guidance.js";
import { expandPromptTemplate } from "@gsd/pi-coding-agent/core/prompt-templates.js";
import type { CustomMessage } from "@gsd/pi-coding-agent/core/messages.js";
import { readFileSync } from "node:fs";
import { stripFrontmatter } from "@gsd/pi-coding-agent/utils/frontmatter.js";
import { sleep } from "@gsd/pi-coding-agent/utils/sleep.js";
import type { PromptOptions } from "./agent-session-types.js";
import type { AgentSessionHost } from "./agent-session-host.js";`,
		moduleMethods: [
			"runAgentPrompt",
			"handlePostAgentRun",
			"tryExecuteExtensionCommand",
			"expandSkillCommand",
			"queueSteer",
			"queueFollowUp",
			"throwIfExtensionCommand",
			"isRetryableError",
			"prepareRetry",
		],
		hostMethods: [
			"emit",
			"emitQueueUpdate",
			"flushPendingBashMessages",
			"findLastAssistantMessage",
			"checkCompaction",
			"prompt",
			"sendCustomMessage",
			"sendUserMessage",
		],
		methods: [
			{ name: "_runAgentPrompt", exportAs: "runAgentPrompt", isAsync: true },
			{ name: "_handlePostAgentRun", exportAs: "handlePostAgentRun", isAsync: true },
			{ name: "prompt", isAsync: true },
			{ name: "_tryExecuteExtensionCommand", exportAs: "tryExecuteExtensionCommand", isAsync: true },
			{ name: "_expandSkillCommand", exportAs: "expandSkillCommand" },
			{ name: "steer", isAsync: true },
			{ name: "followUp", isAsync: true },
			{ name: "_queueSteer", exportAs: "queueSteer", isAsync: true },
			{ name: "_queueFollowUp", exportAs: "queueFollowUp", isAsync: true },
			{ name: "_throwIfExtensionCommand", exportAs: "throwIfExtensionCommand" },
			{ name: "sendCustomMessage", isAsync: true },
			{ name: "sendUserMessage", isAsync: true },
			{ name: "clearQueue" },
			{ name: "getSteeringMessages" },
			{ name: "getFollowUpMessages" },
			{ name: "abort", isAsync: true },
			{ name: "_isRetryableError", exportAs: "isRetryableError" },
			{ name: "_prepareRetry", exportAs: "prepareRetry", isAsync: true },
			{ name: "abortRetry" },
			{ name: "isRetrying", isGetter: true, exportAs: "isRetrying" },
			{ name: "autoRetryEnabled", isGetter: true, exportAs: "autoRetryEnabled" },
			{ name: "setAutoRetryEnabled" },
			{ name: "setSteeringMode" },
			{ name: "setFollowUpMode" },
		],
	},
	"agent-session-model.ts": {
		className: "AgentSessionModelModule",
		imports: `import type { ThinkingLevel } from "@gsd/pi-agent-core";
import type { AssistantMessage, Model } from "@gsd/pi-ai";
import { clampThinkingLevel, getSupportedThinkingLevels, modelsAreEqual, streamSimple } from "@gsd/pi-ai";
import { formatNoApiKeyFoundMessage } from "@gsd/pi-coding-agent/core/auth-guidance.js";
import { DEFAULT_THINKING_LEVEL } from "@gsd/pi-coding-agent/core/defaults.js";
import type { ModelCycleResult } from "./agent-session-types.js";
import { THINKING_LEVELS } from "./agent-session-types.js";
import type { AgentSessionHost } from "./agent-session-host.js";`,
		moduleMethods: [
			"getRequiredRequestAuth",
			"getCompactionRequestAuth",
			"emitModelSelect",
			"cycleScopedModel",
			"cycleAvailableModel",
			"getThinkingLevelForModelSwitch",
			"clampThinkingLevel",
		],
		hostMethods: ["emit", "setThinkingLevel", "setModel"],
		methods: [
			{ name: "_getRequiredRequestAuth", exportAs: "getRequiredRequestAuth", isAsync: true },
			{ name: "_getCompactionRequestAuth", exportAs: "getCompactionRequestAuth", isAsync: true },
			{ name: "_emitModelSelect", exportAs: "emitModelSelect", isAsync: true },
			{ name: "setModel", isAsync: true },
			{ name: "cycleModel", isAsync: true },
			{ name: "_cycleScopedModel", exportAs: "cycleScopedModel", isAsync: true },
			{ name: "_cycleAvailableModel", exportAs: "cycleAvailableModel", isAsync: true },
			{ name: "setThinkingLevel" },
			{ name: "cycleThinkingLevel" },
			{ name: "getAvailableThinkingLevels" },
			{ name: "supportsThinking" },
			{ name: "_getThinkingLevelForModelSwitch", exportAs: "getThinkingLevelForModelSwitch" },
			{ name: "_clampThinkingLevel", exportAs: "clampThinkingLevel" },
			{ name: "setScopedModels" },
		],
	},
	"agent-session-compaction.ts": {
		className: "AgentSessionCompactionModule",
		imports: `import type { AssistantMessage } from "@gsd/pi-ai";
import { isContextOverflow, streamSimple } from "@gsd/pi-ai";
import { formatNoModelSelectedMessage } from "@gsd/pi-coding-agent/core/auth-guidance.js";
import type { CompactionEntry } from "@gsd/pi-coding-agent/core/session-manager.js";
import { getLatestCompactionEntry } from "@gsd/pi-coding-agent/core/session-manager.js";
import type { SessionBeforeCompactResult } from "@gsd/pi-coding-agent/core/extensions/index.js";
import {
	type CompactionResult,
	calculateContextTokens,
	compact,
	estimateContextTokens,
	prepareCompaction,
	shouldCompact,
} from "../compaction/index.js";
import type { AgentSessionHost } from "./agent-session-host.js";`,
		moduleMethods: ["checkCompaction", "runAutoCompaction"],
		hostMethods: [
			"emit",
			"disconnectFromAgent",
			"reconnectToAgent",
			"abort",
			"getCompactionRequestAuth",
		],
		methods: [
			{ name: "compact", isAsync: true },
			{ name: "abortCompaction" },
			{ name: "abortBranchSummary" },
			{ name: "_checkCompaction", exportAs: "checkCompaction", isAsync: true },
			{ name: "_runAutoCompaction", exportAs: "runAutoCompaction", isAsync: true },
			{ name: "setAutoCompactionEnabled" },
			{ name: "autoCompactionEnabled", isGetter: true, exportAs: "autoCompactionEnabled" },
		],
	},
	"agent-session-navigation.ts": {
		className: "AgentSessionNavigationModule",
		imports: `import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ThinkingLevel } from "@gsd/pi-agent-core";
import type { AssistantMessage } from "@gsd/pi-ai";
import { resolvePath } from "@gsd/pi-coding-agent/utils/paths.js";
import { DEFAULT_THINKING_LEVEL } from "@gsd/pi-coding-agent/core/defaults.js";
import type { ContextUsage } from "@gsd/pi-coding-agent/core/extensions/index.js";
import type {
	SessionBeforeForkResult,
	SessionBeforeSwitchResult,
	SessionBeforeTreeResult,
} from "@gsd/pi-coding-agent/core/extensions/index.js";
import type { BranchSummaryEntry, SessionManager } from "@gsd/pi-coding-agent/core/session-manager.js";
import { CURRENT_SESSION_VERSION, getLatestCompactionEntry, type SessionHeader } from "@gsd/pi-coding-agent/core/session-manager.js";
import { theme } from "@gsd/pi-coding-agent/theme/theme.js";
import {
	calculateContextTokens,
	collectEntriesForBranchSummary,
	estimateContextTokens,
	generateBranchSummary,
} from "../compaction/index.js";
import { exportSessionToHtml, type ToolHtmlRenderer } from "../export-html/index.js";
import { createToolHtmlRenderer } from "../export-html/tool-renderer.js";
import type { SessionStats } from "./agent-session-types.js";
import type { AgentSessionHost } from "./agent-session-host.js";`,
		moduleMethods: [
			"settleCurrentTurnForSessionTransition",
			"extractUserMessageText",
			"emitSessionStartWithLegacySwitch",
		],
		hostMethods: [
			"emit",
			"abort",
			"abortRetry",
			"disconnectFromAgent",
			"reconnectToAgent",
			"buildRuntime",
			"refreshToolRegistry",
			"emitModelSelect",
			"setThinkingLevel",
			"getAvailableThinkingLevels",
			"clampThinkingLevel",
			"getRequiredRequestAuth",
			"getToolDefinition",
		],
		methods: [
			{ name: "setSessionName" },
			{ name: "_settleCurrentTurnForSessionTransition", exportAs: "settleCurrentTurnForSessionTransition", isAsync: true },
			{ name: "newSession", isAsync: true },
			{ name: "switchSession", isAsync: true },
			{ name: "fork", isAsync: true },
			{ name: "getLastTurnCost" },
			{ name: "editMode", isGetter: true, exportAs: "editMode" },
			{ name: "setEditMode" },
			{ name: "navigateTree", isAsync: true },
			{ name: "getUserMessagesForForking" },
			{ name: "_extractUserMessageText", exportAs: "extractUserMessageText" },
			{ name: "getSessionStats" },
			{ name: "getContextUsage" },
			{ name: "exportToHtml", isAsync: true },
			{ name: "exportToJsonl" },
			{ name: "getLastAssistantText" },
		],
	},
	"agent-session-extensions.ts": {
		className: "AgentSessionExtensionsModule",
		imports: `import type { AgentTool, ThinkingLevel } from "@gsd/pi-agent-core";
import type { Model } from "@gsd/pi-ai";
import { resetApiProviders } from "@gsd/pi-ai";
import type {
	ExtensionRunner,
	ReplacedSessionContext,
	ToolDefinition,
	ToolInfo,
} from "@gsd/pi-coding-agent/core/extensions/index.js";
import { wrapRegisteredTools } from "@gsd/pi-coding-agent/core/extensions/index.js";
import { emitSessionShutdownEvent } from "@gsd/pi-coding-agent/core/extensions/runner.js";
import type { ResourceExtensionPaths } from "@gsd/pi-coding-agent/core/resource-loader.js";
import type { SlashCommandInfo } from "@gsd/pi-coding-agent/core/slash-commands.js";
import { createSyntheticSourceInfo } from "@gsd/pi-coding-agent/core/source-info.js";
import { buildSystemPrompt } from "../system-prompt.js";
import { createAllToolDefinitions } from "@gsd/pi-coding-agent/core/tools/index.js";
import { createToolDefinitionFromAgentTool } from "@gsd/pi-coding-agent/core/tools/tool-definition-wrapper.js";
import { basename, dirname } from "node:path";
import type { ExtensionBindings, ToolDefinitionEntry } from "./agent-session-types.js";
import type { SessionStartEvent } from "@gsd/pi-coding-agent/core/extensions/index.js";
import type { AgentSessionHost } from "./agent-session-host.js";`,
		moduleMethods: [
			"installAgentToolHooks",
			"applyExtensionBindings",
			"refreshCurrentModelFromRegistry",
			"bindExtensionCore",
			"refreshToolRegistry",
			"buildRuntime",
			"normalizePromptSnippet",
			"normalizePromptGuidelines",
			"rebuildSystemPrompt",
			"buildExtensionResourcePaths",
			"getExtensionSourceLabel",
			"extendResourcesFromExtensions",
			"emitSessionStartWithLegacySwitch",
		],
		hostMethods: [
			"sendCustomMessage",
			"sendUserMessage",
			"abort",
			"compact",
			"setModel",
			"setThinkingLevel",
			"getActiveToolNames",
			"getAllTools",
			"setActiveToolsByName",
			"getContextUsage",
			"prompt",
		],
		methods: [
			{ name: "_installAgentToolHooks", exportAs: "installAgentToolHooks" },
			{ name: "bindExtensions", isAsync: true },
			{ name: "extendResourcesFromExtensions", isAsync: true },
			{ name: "emitSessionStartWithLegacySwitch", isAsync: true },
			{ name: "buildExtensionResourcePaths" },
			{ name: "getExtensionSourceLabel" },
			{ name: "_applyExtensionBindings", exportAs: "applyExtensionBindings" },
			{ name: "_refreshCurrentModelFromRegistry", exportAs: "refreshCurrentModelFromRegistry" },
			{ name: "_bindExtensionCore", exportAs: "bindExtensionCore" },
			{ name: "_refreshToolRegistry", exportAs: "refreshToolRegistry" },
			{ name: "_buildRuntime", exportAs: "buildRuntime" },
			{ name: "reload", isAsync: true },
			{ name: "_normalizePromptSnippet", exportAs: "normalizePromptSnippet" },
			{ name: "_normalizePromptGuidelines", exportAs: "normalizePromptGuidelines" },
			{ name: "_rebuildSystemPrompt", exportAs: "rebuildSystemPrompt" },
			{ name: "getActiveToolNames" },
			{ name: "getAllTools" },
			{ name: "getToolDefinition" },
			{ name: "setActiveToolsByName" },
			{ name: "createReplacedSessionContext" },
			{ name: "hasExtensionHandlers" },
			{ name: "extensionRunner", isGetter: true, exportAs: "extensionRunner" },
			{ name: "getRenderableToolDefinition" },
			{ name: "resourceLoader", isGetter: true, exportAs: "resourceLoader" },
		],
	},
	"agent-session-bash.ts": {
		className: "AgentSessionBashModule",
		imports: `import { type BashResult, executeBashWithOperations } from "../bash-executor.js";
import type { BashExecutionMessage } from "@gsd/pi-coding-agent/core/messages.js";
import { type BashOperations, createLocalBashOperations } from "@gsd/pi-coding-agent/core/tools/bash.js";
import type { AgentSessionHost } from "./agent-session-host.js";`,
		moduleMethods: ["flushPendingBashMessages"],
		hostMethods: ["emit"],
		methods: [
			{ name: "executeBash", isAsync: true },
			{ name: "recordBashResult" },
			{ name: "abortBash" },
			{ name: "isBashRunning", isGetter: true, exportAs: "isBashRunning" },
			{ name: "hasPendingBashMessages", isGetter: true, exportAs: "hasPendingBashMessages" },
			{ name: "_flushPendingBashMessages", exportAs: "flushPendingBashMessages" },
		],
	},
};

for (const [filename, config] of Object.entries(MODULES)) {
	const parts = [config.imports, "", `export class ${config.className} {`, "\tconstructor(readonly host: AgentSessionHost) {}", ""];
	for (const spec of config.methods) {
		const raw = extractMethodBody(spec.name, {
			isArrow: spec.isArrow,
			isGetter: spec.isGetter,
			isSetter: spec.isSetter,
		});
		if (!raw) {
			console.error(`Missing method ${spec.name} in ${filename}`);
			process.exitCode = 1;
			continue;
		}
		parts.push(transformMethod(raw, spec, config.moduleMethods, config.hostMethods), "");
	}
	parts.push("}", "");
	fs.writeFileSync(path.join(sessionDir, filename), parts.join("\n"));
	console.log("Wrote", filename);
}

// Fix host: remove _resourceLoaderInternal duplicate
const hostPath = path.join(sessionDir, "agent-session-host.ts");
let hostContent = fs.readFileSync(hostPath, "utf8");
hostContent = hostContent.replace(/\t_resourceLoaderInternal: ResourceLoader;\n/, "");
fs.writeFileSync(hostPath, hostContent);
console.log("Fixed agent-session-host.ts");

// Generate facade
const facadeMethods = [];
const hostImplMethods = new Set();

for (const config of Object.values(MODULES)) {
	for (const spec of config.methods) {
		const publicName = spec.exportAs ?? spec.name.replace(/^_/, "");
		const moduleKey = config.className.replace("AgentSession", "").replace("Module", "").toLowerCase();
		const moduleVar = {
			prompt: "_prompt",
			model: "_model",
			compaction: "_compaction",
			navigation: "_navigation",
			extensions: "_extensions",
			bash: "_bash",
		}[moduleKey];
		if (spec.isGetter) {
			facadeMethods.push(`\tget ${publicName}() { return this.${moduleVar}.${publicName}; }`);
		} else {
			const params = extractMethodBody(spec.name)?.match(/\(([^)]*)\)/)?.[1] ?? "";
			const isAsync = spec.isAsync || extractMethodBody(spec.name)?.includes("async ");
			facadeMethods.push(
				`\t${isAsync ? "async " : ""}${publicName}(${params})${isAsync ? "" : ""} { return this.${moduleVar}.${publicName}(${params.split(",").map((p) => p.trim().split(/[=:]/)[0].replace(/\?$/, "")).filter(Boolean).join(", ")}); }`,
			);
		}
		if (spec.exportAs) {
			hostImplMethods.add(spec.exportAs);
		}
	}

	for (const hm of config.hostMethods) {
		hostImplMethods.add(hm);
	}
}

// Events module host methods
hostImplMethods.add("emit");
hostImplMethods.add("emitQueueUpdate");
hostImplMethods.add("disconnectFromAgent");
hostImplMethods.add("reconnectToAgent");
hostImplMethods.add("isRetryableError");
hostImplMethods.add("runAgentPrompt");
hostImplMethods.add("handlePostAgentRun");
hostImplMethods.add("findLastAssistantMessage");

const hostModuleMap = {
	emit: "_events",
	emitQueueUpdate: "_events",
	disconnectFromAgent: "_events",
	reconnectToAgent: "_events",
	isRetryableError: "_prompt",
	runAgentPrompt: "_prompt",
	handlePostAgentRun: "_prompt",
	flushPendingBashMessages: "_bash",
	checkCompaction: "_compaction",
	getCompactionRequestAuth: "_model",
	getRequiredRequestAuth: "_model",
	emitModelSelect: "_model",
	findLastAssistantMessage: "_events",
	setThinkingLevel: "_model",
	getAvailableThinkingLevels: "_model",
	clampThinkingLevel: "_model",
	supportsThinking: "_model",
	getActiveToolNames: "_extensions",
	setActiveToolsByName: "_extensions",
	rebuildSystemPrompt: "_extensions",
	refreshToolRegistry: "_extensions",
	buildRuntime: "_extensions",
	installAgentToolHooks: "_extensions",
	prompt: "_prompt",
	sendCustomMessage: "_prompt",
	sendUserMessage: "_prompt",
	compact: "_compaction",
	abort: "_prompt",
	setSessionName: "_navigation",
	emitSessionStartWithLegacySwitch: "_extensions",
	extendResourcesFromExtensions: "_extensions",
	executeBash: "_bash",
	recordBashResult: "_bash",
	getContextUsage: "_navigation",
	getToolDefinition: "_extensions",
	getAllTools: "_extensions",
	createReplacedSessionContext: "_extensions",
	setModel: "_model",
	cycleModel: "_model",
};

const fieldBlock = classBody.match(/export class AgentSession \{([\s\S]*?)constructor\(/)?.[1] ?? "";
const constructorBlock = classBody.match(/constructor\(config: AgentSessionConfig\) \{([\s\S]*?)\n\t\}/)?.[0] ?? "";

let facadeConstructor = constructorBlock
	.replace("this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);", "this._unsubscribeAgent = this.agent.subscribe(this._events.handleAgentEvent);")
	.replace("this._installAgentToolHooks();", "this._extensions.installAgentToolHooks();")
	.replace("this._buildRuntime({", "this._extensions.buildRuntime({");

const hostImpls = [...hostImplMethods]
	.filter((m) => hostModuleMap[m])
	.sort()
	.map((m) => `\t${m}(...args: Parameters<AgentSessionHost["${m}"]>): ReturnType<AgentSessionHost["${m}"]> { return (this.${hostModuleMap[m]}.${m} as (...a: unknown[]) => unknown)(...args) as ReturnType<AgentSessionHost["${m}"]>; }`);

const eventsPublic = [
	"\tsubscribe(listener: AgentSessionEventListener): () => void { return this._events.subscribe(listener); }",
	"\tdispose(): void { return this._events.dispose(); }",
];

const simpleGetters = [
	"state",
	"model",
	"thinkingLevel",
	"isStreaming",
	"systemPrompt",
	"retryAttempt",
	"isCompacting",
	"messages",
	"steeringMode",
	"followUpMode",
	"sessionFile",
	"sessionId",
	"sessionName",
	"scopedModels",
	"promptTemplates",
	"pendingMessageCount",
];

const getterBlocks = simpleGetters.map((g) => {
	const raw = extractMethodBody(g, { isGetter: true });
	return raw ? `\t${raw.replace(/^\t/, "")}` : null;
}).filter(Boolean);

const facade = `${fileHeader.replace(
	/from "\.\/session\/agent-session-types\.js";/,
	`from "./session/agent-session-types.js";
import type { AgentSessionHost } from "./session/agent-session-host.js";
import { AgentSessionEventsModule } from "./session/agent-session-events.js";
import { AgentSessionPromptModule } from "./session/agent-session-prompt.js";
import { AgentSessionModelModule } from "./session/agent-session-model.js";
import { AgentSessionCompactionModule } from "./session/agent-session-compaction.js";
import { AgentSessionNavigationModule } from "./session/agent-session-navigation.js";
import { AgentSessionExtensionsModule } from "./session/agent-session-extensions.js";
import { AgentSessionBashModule } from "./session/agent-session-bash.js";`,
)}

export class AgentSession implements AgentSessionHost {
${fieldBlock.trimEnd()}
\tprivate readonly _events = new AgentSessionEventsModule(this);
\tprivate readonly _prompt = new AgentSessionPromptModule(this);
\tprivate readonly _model = new AgentSessionModelModule(this);
\tprivate readonly _compaction = new AgentSessionCompactionModule(this);
\tprivate readonly _navigation = new AgentSessionNavigationModule(this);
\tprivate readonly _extensions = new AgentSessionExtensionsModule(this);
\tprivate readonly _bash = new AgentSessionBashModule(this);

${facadeConstructor}

\t/** Model registry for API key resolution and model discovery */
\tget modelRegistry(): ModelRegistry {
\t\treturn this._modelRegistry;
\t}

${getterBlocks.join("\n\n")}

\t// AgentSessionHost cross-module surface
${hostImpls.join("\n")}

${eventsPublic.join("\n")}

${facadeMethods.join("\n")}
}
`;

fs.writeFileSync(srcPath, facade);
console.log("Wrote agent-session.ts facade");
