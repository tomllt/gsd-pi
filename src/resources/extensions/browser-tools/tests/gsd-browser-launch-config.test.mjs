import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { resolveGsdBrowserMcpLaunchConfig } = await import("../../shared/gsd-browser-cli.ts");

describe("resolveGsdBrowserMcpLaunchConfig identity flags", () => {
  it("emits a non-empty --identity-key alongside --identity-scope", () => {
    // Regression: gsd-browser exits immediately ("Connection closed") when
    // --identity-scope is supplied without --identity-key.
    const { args } = resolveGsdBrowserMcpLaunchConfig("/tmp/example-project", {});

    const scopeIndex = args.indexOf("--identity-scope");
    const keyIndex = args.indexOf("--identity-key");

    assert.ok(scopeIndex >= 0, "expected --identity-scope in args");
    assert.ok(keyIndex >= 0, "expected --identity-key in args");
    assert.equal(args[keyIndex + 1] && args[keyIndex + 1].length > 0, true, "identity-key must be non-empty");
  });

  it("keeps the identity-key stable across sessions for the same project", () => {
    const a = resolveGsdBrowserMcpLaunchConfig("/tmp/example-project", {}, { sessionSuffix: "pi-aaa" });
    const b = resolveGsdBrowserMcpLaunchConfig("/tmp/example-project", {}, { sessionSuffix: "pi-bbb" });

    const keyOf = (cfg) => cfg.args[cfg.args.indexOf("--identity-key") + 1];
    // Session names differ per pi process, but the persistent browser identity
    // must not, so cookies/profile survive across sessions.
    assert.notEqual(a.sessionName, b.sessionName);
    assert.equal(keyOf(a), keyOf(b));
  });

  it("honors GSD_BROWSER_IDENTITY_KEY override", () => {
    const { args } = resolveGsdBrowserMcpLaunchConfig("/tmp/example-project", {
      GSD_BROWSER_IDENTITY_KEY: "custom-key",
    });
    assert.equal(args[args.indexOf("--identity-key") + 1], "custom-key");
  });
});
