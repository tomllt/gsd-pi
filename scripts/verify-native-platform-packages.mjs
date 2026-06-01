#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const optionalDependencies = pkg.optionalDependencies ?? {};
const enginePackages = Object.keys(optionalDependencies)
  .filter((name) => name.startsWith("@opengsd/engine-"))
  .sort();

if (enginePackages.length === 0) {
  process.stderr.write("ERROR: no @opengsd/engine-* optionalDependencies found\n");
  process.exit(1);
}

const allowAnyVersion = process.argv.includes("--any-version");
const missing = [];

for (const name of enginePackages) {
  const pinnedVersion = optionalDependencies[name];
  const spec = allowAnyVersion ? name : `${name}@${pinnedVersion}`;
  const result = spawnSync("npm", ["view", spec, "version"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  if (result.status === 0 && result.stdout.trim()) {
    process.stdout.write(`verified ${spec}: ${result.stdout.trim()}\n`);
    continue;
  }

  missing.push(spec);
}

if (missing.length === 0) {
  process.stdout.write("Native platform package verification passed.\n");
  process.exit(0);
}

process.stderr.write("ERROR: missing native platform packages on npm:\n");
for (const spec of missing) {
  process.stderr.write(`  - ${spec}\n`);
}
process.stderr.write(
  allowAnyVersion
    ? "Publish the missing @opengsd/engine-* packages before publishing @opengsd/gsd-pi.\nRun Build Native Binaries (build-native.yml) with publish=true, platform_packages_only=true, publish_auth=token.\nPackages must exist on npm before trusted publishing can be configured — see docs/dev/ci-cd-pipeline.md.\n"
    : "Publish the native platform packages for this version before publishing @opengsd/gsd-pi. The production NPM Publish workflow does this automatically before the main package publish.\n",
);
process.exit(1);
