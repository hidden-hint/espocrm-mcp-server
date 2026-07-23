import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { createLoginHandler } from "../../src/oauth/login.js";
import { OAUTH_LOGIN_PATH } from "../../src/oauth/loginPage.js";
import { createOauthProvider } from "../../src/oauth/provider.js";
import { decodeKey, sealToken, unsealToken, type TokenPayload } from "../../src/oauth/tokens.js";
import { makeConfig } from "../testing/fixtures.js";

const KEY_B64 = Buffer.alloc(32, 3).toString("base64");
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

// Answers the EspoCRM App/user login while letting requests to the local test server through.
function stubEspoLogin(result: { ok: boolean; status: number; body: string }): void {
  globalThis.fetch = ((input: URL | string, init?: unknown) => {
    const url = new URL(String(input));
    if (url.hostname.endsWith("example.test")) {
      return Promise.resolve({ ok: result.ok, status: result.status, text: () => Promise.resolve(result.body) });
    }

    return realFetch(input as URL, init as RequestInit);
  }) as unknown as typeof fetch;
}

function config() {
  return makeConfig({
    authMode: "oauth",
    apiKey: undefined,
    transport: "http",
    baseUrl: "https://crm.example.test",
    oauthIssuerUrl: "https://mcp.example.test",
    oauthEncryptionKey: KEY_B64,
  });
}

async function startLoginApp(): Promise<{ port: number; close: () => Promise<void> }> {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.post(OAUTH_LOGIN_PATH, createLoginHandler(createOauthProvider(config()), config()));
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });

  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function authRequestToken(overrides: { state: string | undefined }): string {
  return sealToken(
    {
      kind: "authRequest",
      clientId: "client-1",
      redirectUri: "https://client.example/cb",
      codeChallenge: "challenge",
      state: overrides.state,
      scopes: [],
      resource: undefined,
      exp: Math.floor(Date.now() / 1000) + 600,
    },
    decodeKey(KEY_B64),
  );
}

function post(port: number, body: Record<string, string>): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${OAUTH_LOGIN_PATH}`, {
    method: "POST",
    body: new URLSearchParams(body),
    redirect: "manual",
  });
}

test("valid credentials redirect to the client callback with a code and the original state", async () => {
  stubEspoLogin({ ok: true, status: 200, body: JSON.stringify({ token: "espo-token" }) });
  const app = await startLoginApp();
  try {
    const response = await post(app.port, {
      request: authRequestToken({ state: "state-123" }),
      username: "ann",
      password: "s3cret",
    });
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get("location")!);
    assert.equal(location.origin + location.pathname, "https://client.example/cb");
    assert.equal(location.searchParams.get("state"), "state-123");
    const code = unsealToken(location.searchParams.get("code")!, decodeKey(KEY_B64)) as Extract<TokenPayload, { kind: "code" }>;
    assert.equal(code.kind, "code");
    assert.equal(code.username, "ann");
  } finally {
    await app.close();
  }
});

test("invalid credentials re-render the login form with an error and do not redirect", async () => {
  stubEspoLogin({ ok: false, status: 401, body: "Unauthorized" });
  const app = await startLoginApp();
  try {
    const response = await post(app.port, {
      request: authRequestToken({ state: undefined }),
      username: "ann",
      password: "wrong",
    });
    assert.equal(response.status, 401);
    assert.match(await response.text(), /Invalid EspoCRM username or password/);
  } finally {
    await app.close();
  }
});

test("a tampered or missing request field is rejected without contacting EspoCRM", async () => {
  const app = await startLoginApp();
  try {
    const response = await post(app.port, { request: "garbage", username: "ann", password: "s3cret" });
    assert.equal(response.status, 400);
  } finally {
    await app.close();
  }
});
