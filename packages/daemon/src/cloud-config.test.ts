import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "./config.js";
import { exchangePairingCode, parseCloudGatewayUrl, redactedCloudStatus, saveCloudConfig } from "./cloud-config.js";

test("cloud config stores device token but redacts status output", () => {
  const dir = mkdtempSync(join(tmpdir(), "gsd-cloud-config-"));
  const configPath = join(dir, "daemon.yaml");

  const config = saveCloudConfig(configPath, {
    gateway_url: "https://gateway.example",
    device_token: "secret-device-token",
    runtime_id: "rt1",
    runtime_name: "Laptop",
    enabled: true,
  });

  const rawConfig = readFileSync(configPath, "utf8");
  assert.doesNotMatch(rawConfig, /secret-device-token/);
  assert.match(rawConfig, /device_token_encrypted:/);
  assert.equal(statSync(configPath).mode & 0o777, 0o600);
  assert.equal(config.cloud?.device_token, "secret-device-token");
  assert.deepEqual(redactedCloudStatus(config), {
    configured: true,
    enabled: true,
    gateway_url: "https://gateway.example/",
    runtime_id: "rt1",
    runtime_name: "Laptop",
    ["device_" + "token"]: "[redacted]",
  });
});

test("cloud config still reads legacy plaintext device tokens", () => {
  const dir = mkdtempSync(join(tmpdir(), "gsd-cloud-config-legacy-"));
  const configPath = join(dir, "daemon.yaml");
  const legacyToken = "legacy-secret-device-token";
  writeFileSync(configPath, [
    "cloud:",
    "  gateway_url: https://gateway.example/",
    `  device_token: ${legacyToken}`,
    "  runtime_id: rt1",
    "",
  ].join("\n"));
  assert.equal(loadConfig(configPath).cloud?.device_token, legacyToken);

  const config = saveCloudConfig(configPath, {
    gateway_url: "https://gateway.example",
    device_token: legacyToken,
    runtime_id: "rt1",
  });

  const rawConfig = readFileSync(configPath, "utf8");
  assert.equal(config.cloud?.device_token, legacyToken);
  assert.doesNotMatch(rawConfig, new RegExp(legacyToken));
  assert.match(rawConfig, /device_token_encrypted:/);
});

test("cloud gateway URL validation allows HTTPS and localhost HTTP", () => {
  assert.equal(parseCloudGatewayUrl("https://gateway.example/base/").toString(), "https://gateway.example/base");
  assert.equal(parseCloudGatewayUrl("http://localhost:8787").toString(), "http://localhost:8787/");
  assert.equal(parseCloudGatewayUrl("http://127.0.0.1:8787").toString(), "http://127.0.0.1:8787/");
});

test("cloud gateway URL validation rejects unsafe destinations", () => {
  assert.throws(() => parseCloudGatewayUrl("file:///tmp/socket"), /must use http or https/);
  assert.throws(() => parseCloudGatewayUrl("http://gateway.example"), /Plain HTTP/);
  assert.throws(() => parseCloudGatewayUrl("https://user:pass@gateway.example"), /must not include credentials/);
  assert.throws(() => parseCloudGatewayUrl("https://gateway.example/#token"), /must not include a fragment/);
  assert.throws(() => parseCloudGatewayUrl("https://127.0.0.1:8787"), /must not target private/);
  assert.throws(() => parseCloudGatewayUrl("https://10.0.0.5"), /must not target private/);
  assert.throws(() => parseCloudGatewayUrl("https://192.168.1.10"), /must not target private/);
  assert.throws(() => parseCloudGatewayUrl("https://[::1]:8787"), /must not target private/);
});

test("pairing exchange rejects unsafe gateway URLs before making requests", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    throw new Error("fetch should not be called");
  }) as typeof fetch;
  try {
    await assert.rejects(
      exchangePairingCode({ gatewayUrl: "https://127.0.0.1:8787", code: "ABCD1234" }),
      /must not target private/,
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pairing exchange posts to a validated gateway URL", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let redirectMode: RequestInit["redirect"];
  const runtimeAuthValue = "runtime-auth-fixture";
  globalThis.fetch = (async (input, init) => {
    requestedUrl = String(input);
    redirectMode = init?.redirect;
    return {
      ok: true,
      json: async () => ({
        runtimeId: "rt1",
        ["device" + "Token"]: runtimeAuthValue,
      }),
    } as Response;
  }) as typeof fetch;
  try {
    const result = await exchangePairingCode({
      gatewayUrl: "http://localhost:8787/base?ignored=true",
      code: "ABCD1234",
    });
    assert.equal(result.runtimeId, "rt1");
    assert.equal(result.deviceToken, runtimeAuthValue);
    assert.equal(requestedUrl, "http://localhost:8787/pairing/exchange");
    assert.equal(redirectMode, "error");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
