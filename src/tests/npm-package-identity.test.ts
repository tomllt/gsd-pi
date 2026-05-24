// Project/App: gsd-pi
// File Purpose: Regression coverage for the public npm package identity.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const projectRoot = process.cwd();

function readPackageJson(path: string): {
	name?: string;
	version?: string;
	optionalDependencies?: Record<string, string>;
} {
	return JSON.parse(readFileSync(join(projectRoot, path), "utf8"));
}

test("published npm package names use the @opengsd scope", () => {
	const rootPackage = readPackageJson("package.json");
	assert.equal(rootPackage.name, "@opengsd/gsd-pi");

	const platforms = [
		"darwin-arm64",
		"darwin-x64",
		"linux-arm64-gnu",
		"linux-x64-gnu",
		"win32-x64-msvc",
	];

	for (const platform of platforms) {
		const nativePackage = readPackageJson(`native/npm/${platform}/package.json`);
		const expectedName = `@opengsd/engine-${platform}`;
		assert.equal(nativePackage.name, expectedName);
		const engineSpec = rootPackage.optionalDependencies?.[expectedName];
		assert.ok(
			engineSpec,
			`root package must install the ${expectedName} native optional dependency`,
		);
		const acceptsRange = engineSpec.startsWith(">=");
		const acceptsExactPin = engineSpec === nativePackage.version;
		assert.ok(
			acceptsRange || acceptsExactPin,
			`${expectedName} optional dependency should be a range (>=…) or pinned to native version ${nativePackage.version}, got ${engineSpec}`,
		);
	}
});
