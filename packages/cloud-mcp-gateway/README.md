# @opengsd/cloud-mcp-gateway

Cloud-hosted MCP gateway for brokering remote MCP clients to a paired Local GSD Runtime.

The gateway is a live routing layer. It does not host workspaces, clone source code, store `.gsd` artifacts, or run GSD workflows itself.

## Local Smoke Test

Build and start the gateway with persistent auth storage:

```bash
export GSD_CLOUD_USER_TOKEN="$(openssl rand -hex 32)"
npm run build -w @opengsd/cloud-mcp-gateway
node packages/cloud-mcp-gateway/dist/cli.js \
  --port 8787 \
  --auth-store ./.tmp/gsd-cloud-auth.json
```

Create a pairing code:

```bash
curl -s -X POST http://localhost:8787/pairing-codes \
  -H "Authorization: Bearer $GSD_CLOUD_USER_TOKEN" \
  -H 'Content-Type: application/json'
```

Pair and connect the local daemon with the returned code:

```bash
npm run build -w @opengsd/daemon
node packages/daemon/dist/cli.js cloud pair \
  --gateway http://localhost:8787 \
  --code <CODE> \
  --runtime-name local-dev

node packages/daemon/dist/cli.js cloud connect --verbose
```

List projects through MCP:

```bash
node --input-type=module <<'NODE'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "gateway-smoke", version: "0.0.1" });
const transport = new StreamableHTTPClientTransport(
  new URL("http://localhost:8787/mcp"),
  { requestInit: { headers: { Authorization: `Bearer ${process.env.GSD_CLOUD_USER_TOKEN}` } } },
);

await client.connect(transport);
const result = await client.callTool({ name: "gsd_cloud_projects", arguments: {} });
console.log(result.content[0].text);
await client.close();
NODE
```

## Auth Storage

By default, the gateway uses in-memory auth state for local development and tests.

For persistent auth state, set one of:

```bash
node packages/cloud-mcp-gateway/dist/cli.js --auth-store /secure/path/gsd-cloud-auth.json
GSD_CLOUD_AUTH_STORE_PATH=/secure/path/gsd-cloud-auth.json node packages/cloud-mcp-gateway/dist/cli.js
```

The auth store persists user tokens, device tokens, and pairing codes as SHA-256 hashes. Raw bearer tokens and device tokens are not written to disk.

`GSD_CLOUD_USER_TOKEN` seeds the initial user bearer token and is required at startup.
