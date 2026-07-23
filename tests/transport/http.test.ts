import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../../src/transport/http.js";
import { decodeKey, sealToken } from "../../src/oauth/tokens.js";
import { makeConfig, SAMPLE_METADATA } from "../testing/fixtures.js";

const OAUTH_KEY = Buffer.alloc(32, 9).toString("base64");

function oauthConfig(): Parameters<typeof createApp>[0] {
  return makeConfig({
    transport: "http",
    authMode: "oauth",
    apiKey: undefined,
    baseUrl: "https://crm.example.test",
    oauthIssuerUrl: "https://mcp.example.test",
    oauthEncryptionKey: OAUTH_KEY,
  });
}

function accessToken(): string {
  return sealToken(
    {
      kind: "access",
      espoCredential: { kind: "espoAuthorization", value: "sealed" },
      clientId: "c",
      scopes: [],
      aud: "https://mcp.example.test/mcp",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    decodeKey(OAUTH_KEY),
  );
}

const INITIALIZE_REQUEST = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } },
};

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function startApp(config: Parameters<typeof createApp>[0]): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const app = createApp(config);
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// Serves the EspoCRM metadata for upstream calls while letting requests to the
// local test server (127.0.0.1) reach the real fetch implementation.
function stubEspoFetch(): void {
  globalThis.fetch = ((input: URL | string, init?: unknown) => {
    const url = new URL(String(input));
    if (url.hostname.endsWith("example.test")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(SAMPLE_METADATA)),
      });
    }

    return realFetch(input as URL, init as RequestInit);
  }) as unknown as typeof fetch;
}

test("GET on the MCP path is rejected with 405", async () => {
  const app = await startApp(makeConfig({ transport: "http" }));
  try {
    const response = await fetch(`http://127.0.0.1:${app.port}/mcp`);
    assert.equal(response.status, 405);
    assert.equal((await response.json()).error.code, -32000);
  } finally {
    await app.close();
  }
});

test("DELETE on the MCP path is rejected with 405", async () => {
  const app = await startApp(makeConfig({ transport: "http" }));
  try {
    const response = await fetch(`http://127.0.0.1:${app.port}/mcp`, { method: "DELETE" });
    assert.equal(response.status, 405);
  } finally {
    await app.close();
  }
});

test("the health endpoint reports ok", async () => {
  const app = await startApp(makeConfig({ transport: "http" }));
  try {
    const response = await fetch(`http://127.0.0.1:${app.port}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  } finally {
    await app.close();
  }
});

test("in oauth mode a POST without a bearer token returns 401 with a WWW-Authenticate header", async () => {
  const app = await startApp(oauthConfig());
  try {
    const response = await fetch(`http://127.0.0.1:${app.port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 401);
    assert.match(response.headers.get("www-authenticate") ?? "", /resource_metadata/);
  } finally {
    await app.close();
  }
});

test("in oauth mode the protected-resource metadata advertises the authorization server", async () => {
  const app = await startApp(oauthConfig());
  try {
    const response = await fetch(`http://127.0.0.1:${app.port}/.well-known/oauth-protected-resource/mcp`);
    assert.equal(response.status, 200);
    const doc = await response.json();
    assert.ok(Array.isArray(doc.authorization_servers) && doc.authorization_servers.length >= 1);
  } finally {
    await app.close();
  }
});

test("in oauth mode the authorization-server metadata is served", async () => {
  const app = await startApp(oauthConfig());
  try {
    const response = await fetch(`http://127.0.0.1:${app.port}/.well-known/oauth-authorization-server`);
    assert.equal(response.status, 200);
    assert.ok((await response.json()).token_endpoint);
  } finally {
    await app.close();
  }
});

test("in oauth mode a POST with a valid access token reaches the MCP server", async () => {
  stubEspoFetch();
  const app = await startApp(oauthConfig());
  try {
    const response = await fetch(`http://127.0.0.1:${app.port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${accessToken()}`,
      },
      body: JSON.stringify(INITIALIZE_REQUEST),
    });
    assert.equal(response.status, 200);
    assert.ok((await response.json()).result);
  } finally {
    await app.close();
  }
});

test("the openapi endpoint serves a document typed from live metadata", async () => {
  stubEspoFetch();
  const app = await startApp(makeConfig({ transport: "http", authMode: "apiKey", apiKey: "k", entityTypes: ["Lead"] }));
  try {
    const response = await fetch(`http://127.0.0.1:${app.port}/openapi.json`);
    assert.equal(response.status, 200);
    const doc = await response.json();
    assert.equal(doc.openapi, "3.1.0");
    assert.ok(doc.paths["/Lead"]);
  } finally {
    await app.close();
  }
});
