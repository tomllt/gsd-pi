// Project/App: gsd-pi
// File Purpose: Extracted from interactive-mode.ts (Phase E2 seam remediation).
// @ts-nocheck — host-delegated helpers; types flow from InteractiveMode at runtime.

import * as os from "node:os";
import * as path from "node:path";
import { Container, Spacer, Text } from "@gsd/pi-tui";
import type { ResourceDiagnostic } from "@gsd/pi-coding-agent/core/resource-loader.js";
import { theme, type ThemeColor } from "@gsd/pi-coding-agent/theme/theme.js";
import type { InteractiveModeDelegateHost } from "./interactive-mode-delegate-host.js";

export function formatDisplayPath(host: InteractiveModeDelegateHost, p: string): string {
		const home = os.homedir();
		let result = p;

		// Replace home directory with ~
		if (result.startsWith(home)) {
			result = `~${result.slice(home.length)}`;
		}

		return result;
	}

	/**
	 * Get a short path relative to the package root for display.
	 */
export function getShortPath(host: InteractiveModeDelegateHost, fullPath: string, source: string): string {
		// For npm packages, show path relative to node_modules/pkg/
		const npmMatch = fullPath.match(/node_modules\/(@?[^/]+(?:\/[^/]+)?)\/(.*)/);
		if (npmMatch && source.startsWith("npm:")) {
			return npmMatch[2];
		}

		// For git packages, show path relative to repo root
		const gitMatch = fullPath.match(/git\/[^/]+\/[^/]+\/(.*)/);
		if (gitMatch && source.startsWith("git:")) {
			return gitMatch[1];
		}

		// For local/auto, just use formatDisplayPath
		return formatDisplayPath(host, fullPath);
	}

export function getDisplaySourceInfo(host: InteractiveModeDelegateHost, source: string,
		scope: string,
	): { label: string; scopeLabel?: string; color: "accent" | "muted" } {
		if (source === "local") {
			if (scope === "user") {
				return { label: "user", color: "muted" };
			}
			if (scope === "project") {
				return { label: "project", color: "muted" };
			}
			if (scope === "temporary") {
				return { label: "path", scopeLabel: "temp", color: "muted" };
			}
			return { label: "path", color: "muted" };
		}

		if (source === "cli") {
			return { label: "path", scopeLabel: scope === "temporary" ? "temp" : undefined, color: "muted" };
		}

		const scopeLabel =
			scope === "user" ? "user" : scope === "project" ? "project" : scope === "temporary" ? "temp" : undefined;
		return { label: source, scopeLabel, color: "accent" };
	}

export function getScopeGroup(host: InteractiveModeDelegateHost, source: string, scope: string): "user" | "project" | "path" {
		if (source === "cli" || scope === "temporary") return "path";
		if (scope === "user") return "user";
		if (scope === "project") return "project";
		return "path";
	}

export function isPackageSource(host: InteractiveModeDelegateHost, source: string): boolean {
		return source.startsWith("npm:") || source.startsWith("git:");
	}

export function buildScopeGroups(host: InteractiveModeDelegateHost, paths: string[],
		metadata: Map<string, { source: string; scope: string; origin: string }>,
	): Array<{ scope: "user" | "project" | "path"; paths: string[]; packages: Map<string, string[]> }> {
		const groups: Record<
			"user" | "project" | "path",
			{ scope: "user" | "project" | "path"; paths: string[]; packages: Map<string, string[]> }
		> = {
			user: { scope: "user", paths: [], packages: new Map() },
			project: { scope: "project", paths: [], packages: new Map() },
			path: { scope: "path", paths: [], packages: new Map() },
		};

		for (const p of paths) {
			const meta = findMetadata(host, p, metadata);
			const source = meta?.source ?? "local";
			const scope = meta?.scope ?? "project";
			const groupKey = getScopeGroup(host, source, scope);
			const group = groups[groupKey];

			if (isPackageSource(host, source)) {
				const list = group.packages.get(source) ?? [];
				list.push(p);
				group.packages.set(source, list);
			} else {
				group.paths.push(p);
			}
		}

		return [groups.project, groups.user, groups.path].filter(
			(group) => group.paths.length > 0 || group.packages.size > 0,
		);
	}

export function formatScopeGroups(
	host: InteractiveModeDelegateHost,
	groups: Array<{ scope: "user" | "project" | "path"; paths: string[]; packages: Map<string, string[]> }>,
	options: {
		formatPath: (p: string) => string;
		formatPackagePath: (p: string, source: string) => string;
	},
): string {
		const lines: string[] = [];

		for (const group of groups) {
			lines.push(`  ${theme.fg("accent", group.scope)}`);

			const sortedPaths = [...group.paths].sort((a, b) => a.localeCompare(b));
			for (const p of sortedPaths) {
				lines.push(theme.fg("dim", `    ${options.formatPath(p)}`));
			}

			const sortedPackages = Array.from(group.packages.entries()).sort(([a], [b]) => a.localeCompare(b));
			for (const [source, paths] of sortedPackages) {
				lines.push(`    ${theme.fg("mdLink", source)}`);
				const sortedPackagePaths = [...paths].sort((a, b) => a.localeCompare(b));
				for (const p of sortedPackagePaths) {
					lines.push(theme.fg("dim", `      ${options.formatPackagePath(p, source)}`));
				}
			}
		}

		return lines.join("\n");
	}

	/**
	 * Find metadata for a path, checking parent directories if exact match fails.
	 * Package manager stores metadata for directories, but we display file paths.
	 */
export function findMetadata(host: InteractiveModeDelegateHost, p: string,
		metadata: Map<string, { source: string; scope: string; origin: string }>,
	): { source: string; scope: string; origin: string } | undefined {
		// Try exact match first
		const exact = metadata.get(p);
		if (exact) return exact;

		// Try parent directories (package manager stores directory paths)
		let current = p;
		let parent = path.dirname(current);
		while (parent !== current) {
			const meta = metadata.get(parent);
			if (meta) return meta;
			current = parent;
			parent = path.dirname(current);
		}

		return undefined;
	}

	/**
	 * Format a path with its source/scope info from metadata.
	 */
export function formatPathWithSource(host: InteractiveModeDelegateHost, 
		p: string,
		metadata: Map<string, { source: string; scope: string; origin: string }>,
	): string {
		const meta = findMetadata(host, p, metadata);
		if (meta) {
			const shortPath = getShortPath(host, p, meta.source);
			const { label, scopeLabel } = getDisplaySourceInfo(host, meta.source, meta.scope);
			const labelText = scopeLabel ? `${label} (${scopeLabel})` : label;
			return `${labelText} ${shortPath}`;
		}
		return formatDisplayPath(host, p);
	}

	/**
	 * Format resource diagnostics with nice collision display using metadata.
	 */
export function formatDiagnostics(host: InteractiveModeDelegateHost, 
		diagnostics: readonly ResourceDiagnostic[],
		metadata: Map<string, { source: string; scope: string; origin: string }>,
	): string {
		const lines: string[] = [];

		// Group collision diagnostics by name
		const collisions = new Map<string, ResourceDiagnostic[]>();
		const otherDiagnostics: ResourceDiagnostic[] = [];

		for (const d of diagnostics) {
			if (d.type === "collision" && d.collision) {
				const list = collisions.get(d.collision.name) ?? [];
				list.push(d);
				collisions.set(d.collision.name, list);
			} else {
				otherDiagnostics.push(d);
			}
		}

		// Format collision diagnostics grouped by name
		for (const [name, collisionList] of collisions) {
			const first = collisionList[0]?.collision;
			if (!first) continue;
			lines.push(theme.fg("warning", `  "${name}" collision:`));
			// Show winner
			lines.push(
				theme.fg("dim", `    ${theme.fg("success", "✓")} ${formatPathWithSource(host, first.winnerPath, metadata)}`),
			);
			// Show all losers
			for (const d of collisionList) {
				if (d.collision) {
					lines.push(
						theme.fg(
							"dim",
							`    ${theme.fg("warning", "✗")} ${formatPathWithSource(host, d.collision.loserPath, metadata)} (skipped)`,
						),
					);
				}
			}
		}

		// Format other diagnostics (skill name collisions, parse errors, etc.)
		for (const d of otherDiagnostics) {
			if (d.path) {
				// Use metadata-aware formatting for paths
				const sourceInfo = formatPathWithSource(host, d.path, metadata);
				lines.push(theme.fg(d.type === "error" ? "error" : "warning", `  ${sourceInfo}`));
				lines.push(theme.fg(d.type === "error" ? "error" : "warning", `    ${d.message}`));
			} else {
				lines.push(theme.fg(d.type === "error" ? "error" : "warning", `  ${d.message}`));
			}
		}

		return lines.join("\n");
	}

export function showLoadedResources(host: InteractiveModeDelegateHost, options?: {
		extensionPaths?: string[];
		force?: boolean;
		showDiagnosticsWhenQuiet?: boolean;
	}): void {
		const showListing = options?.force || host.options.verbose || !host.settingsManager.getQuietStartup();
		const showDiagnostics = showListing || options?.showDiagnosticsWhenQuiet === true;
		if (!showListing && !showDiagnostics) {
			return;
		}

		const metadata = host.session.resourceLoader.getPathMetadata();
		const sectionHeader = (name: string, color: ThemeColor = "mdHeading") => theme.fg(color, `[${name}]`);

		const skillsResult = host.session.resourceLoader.getSkills();
		const promptsResult = host.session.resourceLoader.getPrompts();
		const themesResult = host.session.resourceLoader.getThemes();

		if (showListing) {
			const contextFiles = host.session.resourceLoader.getAgentsFiles().agentsFiles;
			if (contextFiles.length > 0) {
				host.chatContainer.addChild(new Spacer(1));
				const contextList = contextFiles
					.map((f) => theme.fg("dim", `  ${formatDisplayPath(host, f.path)}`))
					.join("\n");
				host.chatContainer.addChild(new Text(`${sectionHeader("Context")}\n${contextList}`, 0, 0));
				host.chatContainer.addChild(new Spacer(1));
			}

			const skills = skillsResult.skills;
			if (skills.length > 0) {
				const skillPaths = skills.map((s) => s.filePath);
				const groups = buildScopeGroups(host, skillPaths, metadata);
				const skillList = formatScopeGroups(host, groups, {
					formatPath: (p) => formatDisplayPath(host, p),
					formatPackagePath: (p, source) => getShortPath(host, p, source),
				});
				host.chatContainer.addChild(new Text(`${sectionHeader("Skills")}\n${skillList}`, 0, 0));
				host.chatContainer.addChild(new Spacer(1));
			}

			const templates = host.session.promptTemplates;
			if (templates.length > 0) {
				const templatePaths = templates.map((t) => t.filePath);
				const groups = buildScopeGroups(host, templatePaths, metadata);
				const templateByPath = new Map(templates.map((t) => [t.filePath, t]));
				const templateList = formatScopeGroups(host, groups, {
					formatPath: (p) => {
						const template = templateByPath.get(p);
						return template ? `/${template.name}` : formatDisplayPath(host, p);
					},
					formatPackagePath: (p) => {
						const template = templateByPath.get(p);
						return template ? `/${template.name}` : formatDisplayPath(host, p);
					},
				});
				host.chatContainer.addChild(new Text(`${sectionHeader("Prompts")}\n${templateList}`, 0, 0));
				host.chatContainer.addChild(new Spacer(1));
			}

			const extensionPaths = options?.extensionPaths ?? [];
			if (extensionPaths.length > 0) {
				const groups = buildScopeGroups(host, extensionPaths, metadata);
				const extList = formatScopeGroups(host, groups, {
					formatPath: (p) => formatDisplayPath(host, p),
					formatPackagePath: (p, source) => getShortPath(host, p, source),
				});
				host.chatContainer.addChild(new Text(`${sectionHeader("Extensions", "mdHeading")}\n${extList}`, 0, 0));
				host.chatContainer.addChild(new Spacer(1));
			}

			// Show loaded themes (excluding built-in)
			const loadedThemes = themesResult.themes;
			const customThemes = loadedThemes.filter((t) => t.sourcePath);
			if (customThemes.length > 0) {
				const themePaths = customThemes.map((t) => t.sourcePath!);
				const groups = buildScopeGroups(host, themePaths, metadata);
				const themeList = formatScopeGroups(host, groups, {
					formatPath: (p) => formatDisplayPath(host, p),
					formatPackagePath: (p, source) => getShortPath(host, p, source),
				});
				host.chatContainer.addChild(new Text(`${sectionHeader("Themes")}\n${themeList}`, 0, 0));
				host.chatContainer.addChild(new Spacer(1));
			}
		}

		if (showDiagnostics) {
			const skillDiagnostics = skillsResult.diagnostics;
			if (skillDiagnostics.length > 0) {
				const collisionDiags = skillDiagnostics.filter(d => d.type === "collision");
				const issueDiags = skillDiagnostics.filter(d => d.type !== "collision");

				if (collisionDiags.length > 0) {
					const collisionLines = formatDiagnostics(host, collisionDiags, metadata);
					host.chatContainer.addChild(new Text(`${theme.fg("warning", "[Skill conflicts]")}\n${collisionLines}`, 0, 0));
					host.chatContainer.addChild(new Spacer(1));
				}

				if (issueDiags.length > 0) {
					const issueLines = formatDiagnostics(host, issueDiags, metadata);
					host.chatContainer.addChild(new Text(`${theme.fg("warning", "[Skill issues]")}\n${issueLines}`, 0, 0));
					host.chatContainer.addChild(new Spacer(1));
				}
			}

			const promptDiagnostics = promptsResult.diagnostics;
			if (promptDiagnostics.length > 0) {
				const warningLines = formatDiagnostics(host, promptDiagnostics, metadata);
				host.chatContainer.addChild(
					new Text(`${theme.fg("warning", "[Prompt conflicts]")}\n${warningLines}`, 0, 0),
				);
				host.chatContainer.addChild(new Spacer(1));
			}

			const extensionDiagnostics: ResourceDiagnostic[] = [];
			const extensionErrors = host.session.resourceLoader.getExtensions().errors;
			if (extensionErrors.length > 0) {
				for (const error of extensionErrors) {
					extensionDiagnostics.push({ type: "error", message: error.error, path: error.path });
				}
			}

			const commandDiagnostics = host.session.extensionRunner?.getCommandDiagnostics() ?? [];
			extensionDiagnostics.push(...commandDiagnostics);

			const shortcutDiagnostics = host.session.extensionRunner?.getShortcutDiagnostics() ?? [];
			extensionDiagnostics.push(...shortcutDiagnostics);

			if (extensionDiagnostics.length > 0) {
				const warningLines = formatDiagnostics(host, extensionDiagnostics, metadata);
				host.chatContainer.addChild(
					new Text(`${theme.fg("warning", "[Extension issues]")}\n${warningLines}`, 0, 0),
				);
				host.chatContainer.addChild(new Spacer(1));
			}

			const themeDiagnostics = themesResult.diagnostics;
			if (themeDiagnostics.length > 0) {
				const warningLines = formatDiagnostics(host, themeDiagnostics, metadata);
				host.chatContainer.addChild(new Text(`${theme.fg("warning", "[Theme conflicts]")}\n${warningLines}`, 0, 0));
				host.chatContainer.addChild(new Spacer(1));
			}
		}
	}
