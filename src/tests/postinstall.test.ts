import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("postinstall respects PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD", () => {
  const result = spawnSync("node", ["scripts/postinstall.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
      GSD_SKIP_RTK_INSTALL: "1",
    },
    encoding: "utf-8",
  });

  assert.equal(result.status, 0, `postinstall exits cleanly: ${result.stderr}`);
});

test("install script only treats npm postinstall as postinstall mode", () => {
  const installScript = readFileSync(join(projectRoot, "scripts", "install.js"), "utf-8");
  assert.match(
    installScript,
    /process\.env\.npm_lifecycle_event === 'postinstall'/,
  );
  assert.match(
    installScript,
    /process\.env\.GSD_POSTINSTALL === '1'/,
  );
});

test("modular installer deps module exists", () => {
  assert.ok(existsSync(join(projectRoot, "scripts", "install", "deps.js")));
});

test("install script supports --yes non-interactive flag", () => {
  const installScript = readFileSync(join(projectRoot, "scripts", "install.js"), "utf-8");
  assert.match(installScript, /--yes/);
  assert.match(installScript, /assertInteractiveOrYes/);
});

test("install --help exits cleanly", () => {
  const result = spawnSync("node", ["scripts/install.js", "--help"], {
    cwd: projectRoot,
    encoding: "utf-8",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--yes/);
});
