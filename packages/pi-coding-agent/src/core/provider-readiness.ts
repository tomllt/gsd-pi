/**
 * Provider readiness policy extracted from ModelRegistry.
 */

import type { AuthStorage } from "./auth-storage.js";

export type ProviderAuthMode = "apiKey" | "oauth" | "none" | "externalCli";

export interface ProviderReadinessConfig {
	isReady?: () => boolean;
	oauth?: unknown;
	apiKey?: string;
	authMode?: ProviderAuthMode;
}

export interface ProviderReadinessDeps {
	authStorage: AuthStorage;
	registeredProviders: Map<string, ProviderReadinessConfig>;
	providerRequestConfigs: Map<string, { apiKey?: string }>;
	disabledModelProviders: Set<string>;
}

export function getProviderAuthMode(deps: ProviderReadinessDeps, provider: string): ProviderAuthMode {
	if (provider === "gsd-fake") return "none";
	const config = deps.registeredProviders.get(provider);
	if (!config) return "apiKey";
	if (config.authMode) return config.authMode;
	if (config.oauth) return "oauth";
	if (config.apiKey) return "apiKey";
	return "apiKey";
}

export function setDisabledModelProviders(deps: ProviderReadinessDeps, providers: string[]): void {
	deps.disabledModelProviders.clear();
	for (const provider of providers) {
		const normalized = provider.trim().toLowerCase();
		if (normalized.length > 0) {
			deps.disabledModelProviders.add(normalized);
		}
	}
}

export function getDisabledModelProviders(deps: ProviderReadinessDeps): string[] {
	return Array.from(deps.disabledModelProviders);
}

export function isProviderRequestReady(deps: ProviderReadinessDeps, provider: string): boolean {
	if (deps.disabledModelProviders.has(provider.trim().toLowerCase())) return false;
	const config = deps.registeredProviders.get(provider);
	if (config?.isReady) return config.isReady();
	const authMode = getProviderAuthMode(deps, provider);
	if (authMode === "externalCli" || authMode === "none") return true;
	return deps.authStorage.hasAuth(provider) || deps.providerRequestConfigs.has(provider);
}
