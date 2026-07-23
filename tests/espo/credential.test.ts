import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingHttpHeaders } from "node:http";
import { AuthError, ConfigError } from "../../src/errors.js";
import { credentialFromConfig, credentialFromRequest, credentialHeaders } from "../../src/espo/credential.js";
import { makeConfig } from "../testing/fixtures.js";

test("credentialHeaders renders an apiKey credential as X-Api-Key", () => {
  assert.deepEqual(credentialHeaders({ kind: "apiKey", apiKey: "secret" }), { "X-Api-Key": "secret" });
});

test("credentialHeaders renders an espoAuthorization credential as Espo-Authorization", () => {
  assert.deepEqual(credentialHeaders({ kind: "espoAuthorization", value: "token" }), {
    "Espo-Authorization": "token",
  });
});

test("credentialFromConfig returns the configured apiKey", () => {
  assert.deepEqual(credentialFromConfig(makeConfig({ apiKey: "secret" })), { kind: "apiKey", apiKey: "secret" });
});

test("credentialFromConfig throws when the apiKey is missing or empty", () => {
  assert.throws(() => credentialFromConfig(makeConfig({ apiKey: undefined })), ConfigError);
  assert.throws(() => credentialFromConfig(makeConfig({ apiKey: "" })), ConfigError);
});

test("credentialFromRequest in apiKey mode ignores headers and uses the config key", () => {
  const config = makeConfig({ authMode: "apiKey", apiKey: "config-key" });
  const headers: IncomingHttpHeaders = { "x-api-key": "header-key" };
  assert.deepEqual(credentialFromRequest(headers, config), { kind: "apiKey", apiKey: "config-key" });
});

test("credentialFromRequest in passthrough reads X-Api-Key first", () => {
  const config = makeConfig({ authMode: "passthrough" });
  assert.deepEqual(credentialFromRequest({ "x-api-key": "caller" }, config), {
    kind: "apiKey",
    apiKey: "caller",
  });
});

test("credentialFromRequest takes the first value of an array-valued header", () => {
  const config = makeConfig({ authMode: "passthrough" });
  assert.deepEqual(credentialFromRequest({ "x-api-key": ["first", "second"] }, config), {
    kind: "apiKey",
    apiKey: "first",
  });
});

test("credentialFromRequest falls back to Espo-Authorization", () => {
  const config = makeConfig({ authMode: "passthrough" });
  assert.deepEqual(credentialFromRequest({ "espo-authorization": "espo-token" }, config), {
    kind: "espoAuthorization",
    value: "espo-token",
  });
});

test("credentialFromRequest prefers X-Api-Key over Espo-Authorization and Authorization", () => {
  const config = makeConfig({ authMode: "passthrough" });
  const headers: IncomingHttpHeaders = {
    "x-api-key": "the-key",
    "espo-authorization": "espo-token",
    authorization: "Bearer bearer-token",
  };
  assert.deepEqual(credentialFromRequest(headers, config), { kind: "apiKey", apiKey: "the-key" });
});

test("credentialFromRequest strips the Bearer prefix and maps per passthroughAs=apiKey", () => {
  const config = makeConfig({ authMode: "passthrough", passthroughAs: "apiKey" });
  assert.deepEqual(credentialFromRequest({ authorization: "Bearer abc123" }, config), {
    kind: "apiKey",
    apiKey: "abc123",
  });
});

test("credentialFromRequest maps a Bearer token to espoAuthorization when configured", () => {
  const config = makeConfig({ authMode: "passthrough", passthroughAs: "espoAuthorization" });
  assert.deepEqual(credentialFromRequest({ authorization: "bearer abc123" }, config), {
    kind: "espoAuthorization",
    value: "abc123",
  });
});

test("credentialFromRequest throws AuthError when no credential header is present", () => {
  const config = makeConfig({ authMode: "passthrough" });
  assert.throws(() => credentialFromRequest({}, config), AuthError);
});

test("credentialFromRequest ignores empty header values", () => {
  const config = makeConfig({ authMode: "passthrough" });
  assert.throws(() => credentialFromRequest({ "x-api-key": "", "espo-authorization": "" }, config), AuthError);
});
