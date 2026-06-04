import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { detectWebApp } = await import("../web-app-detect.ts");

function makeProject(files) {
  const root = mkdtempSync(join(tmpdir(), "gsd-webapp-detect-"));
  for (const [relPath, contents] of Object.entries(files)) {
    const full = join(root, relPath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

describe("detectWebApp", () => {
  const roots = [];
  after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

  const project = (files) => {
    const root = makeProject(files);
    roots.push(root);
    return root;
  };

  it("detects a React dependency", () => {
    const root = project({ "package.json": JSON.stringify({ dependencies: { react: "^18.0.0" } }) });
    assert.equal(detectWebApp(root), true);
  });

  it("detects a Vite/Next dev dependency", () => {
    const root = project({ "package.json": JSON.stringify({ devDependencies: { vite: "^5.0.0" } }) });
    assert.equal(detectWebApp(root), true);
  });

  it("detects a dev-server script", () => {
    const root = project({ "package.json": JSON.stringify({ scripts: { dev: "next dev" } }) });
    assert.equal(detectWebApp(root), true);
  });

  it("detects a static index.html site", () => {
    const root = project({ "index.html": "<!doctype html>" });
    assert.equal(detectWebApp(root), true);
  });

  it("returns false for a CLI/library package", () => {
    const root = project({
      "package.json": JSON.stringify({
        dependencies: { commander: "^12.0.0" },
        scripts: { build: "tsc", test: "node --test" },
      }),
    });
    assert.equal(detectWebApp(root), false);
  });

  it("returns false when there is no package.json or index.html", () => {
    const root = project({ "README.md": "# nothing" });
    assert.equal(detectWebApp(root), false);
  });

  it("does not throw on malformed package.json", () => {
    const root = project({ "package.json": "{ not valid json" });
    assert.equal(detectWebApp(root), false);
  });
});
