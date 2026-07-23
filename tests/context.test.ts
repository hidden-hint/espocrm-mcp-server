import { test } from "node:test";
import assert from "node:assert/strict";
import { contextFromConfig, contextFromCredential } from "../src/context.js";
import { ConfigError } from "../src/errors.js";
import { MetadataService } from "../src/espo/metadata.js";
import { makeConfig } from "./testing/fixtures.js";

test("contextFromConfig builds a client bound to the configured base URL", () => {
  const context = contextFromConfig(makeConfig({ baseUrl: "https://crm.example.test", apiKey: "k" }));
  assert.equal(context.espo.baseUrl, "https://crm.example.test");
  assert.ok(context.metadata instanceof MetadataService);
});

test("contextFromConfig throws when the apiKey credential is missing", () => {
  assert.throws(() => contextFromConfig(makeConfig({ apiKey: undefined })), ConfigError);
});

test("contextFromCredential builds a client from a supplied credential", () => {
  const config = makeConfig({ authMode: "oauth", apiKey: undefined, baseUrl: "https://crm.example.test" });
  const context = contextFromCredential({ kind: "espoAuthorization", value: "caller-token" }, config);
  assert.equal(context.espo.baseUrl, "https://crm.example.test");
  assert.ok(context.metadata instanceof MetadataService);
});
