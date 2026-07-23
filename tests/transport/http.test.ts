import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../../src/transport/http.js";
import { makeConfig, SAMPLE_METADATA } from "../testing/fixtures.js";

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

test("a POST without a credential in passthrough mode returns 401", async () => {
  const app = await startApp(makeConfig({ transport: "http", authMode: "passthrough", apiKey: undefined }));
  try {
    const response = await fetch(`http://127.0.0.1:${app.port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, -32001);
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
