import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decodeKey, sealToken, unsealToken, type AccessTokenPayload } from "../../src/oauth/tokens.js";

const KEY = randomBytes(32);

const ACCESS: AccessTokenPayload = {
  kind: "access",
  espoCredential: { kind: "espoAuthorization", value: "dXNlcjp0b2tlbg==" },
  clientId: "client-1",
  scopes: [],
  aud: "https://mcp.example.test/mcp",
  exp: 4102444800,
};

test("sealToken then unsealToken round-trips the payload", () => {
  assert.deepEqual(unsealToken(sealToken(ACCESS, KEY), KEY), ACCESS);
});

test("sealToken round-trips an auth code and a refresh payload", () => {
  const code = {
    kind: "code" as const,
    username: "ann",
    password: "s3cret",
    codeChallenge: "abc",
    clientId: "client-1",
    redirectUri: "https://client.example/cb",
    scopes: ["a"],
    exp: 4102444800,
  };
  const refresh = { kind: "refresh" as const, username: "ann", password: "s3cret", clientId: "client-1", scopes: [] };
  assert.deepEqual(unsealToken(sealToken(code, KEY), KEY), code);
  assert.deepEqual(unsealToken(sealToken(refresh, KEY), KEY), refresh);
});

test("unsealToken throws when the token was sealed with a different key", () => {
  const sealed = sealToken(ACCESS, KEY);
  assert.throws(() => unsealToken(sealed, randomBytes(32)));
});

test("unsealToken throws when the ciphertext has been tampered with", () => {
  const raw = Buffer.from(sealToken(ACCESS, KEY), "base64url");
  const last = raw.length - 1;
  raw[last] = (raw[last] ?? 0) ^ 0x01;
  assert.throws(() => unsealToken(raw.toString("base64url"), KEY));
});

test("decodeKey accepts a base64 32-byte key", () => {
  const key = randomBytes(32);
  assert.deepEqual(decodeKey(key.toString("base64")), key);
});

test("decodeKey accepts a hex 32-byte key", () => {
  const key = randomBytes(32);
  assert.deepEqual(decodeKey(key.toString("hex")), key);
});

test("decodeKey throws when the key does not decode to 32 bytes", () => {
  assert.throws(() => decodeKey(randomBytes(16).toString("base64")));
  assert.throws(() => decodeKey("too-short"));
});
