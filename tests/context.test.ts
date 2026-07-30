import { test } from "node:test"
import assert from "node:assert/strict"
import { contextFromConfig, contextFromCredential } from "../src/context.js"
import { ConfigError } from "../src/errors.js"
import { MetadataService } from "../src/espo/metadata.js"
import { makeConfig } from "./testing/fixtures.js"
import type { ToolContext } from "../src/tools/types.js"
import type { Config } from "../src/config.js"

test("contextFromConfig builds a client bound to the configured base URL", (): void => {
  const context: ToolContext = contextFromConfig(makeConfig({ baseUrl: "https://crm.example.test", apiKey: "k" }))
  assert.equal(context.espo.baseUrl, "https://crm.example.test")
  assert.ok(context.metadata instanceof MetadataService)
})

test("contextFromConfig throws when the apiKey credential is missing", (): void => {
  assert.throws((): ToolContext => contextFromConfig(makeConfig({ apiKey: undefined })), ConfigError)
})

test("contextFromCredential builds a client from a supplied credential", (): void => {
  const config: Config = makeConfig({ authMode: "oauth", apiKey: undefined, baseUrl: "https://crm.example.test" })
  const context: ToolContext = contextFromCredential({ kind: "espoAuthorization", value: "caller-token" }, config)
  assert.equal(context.espo.baseUrl, "https://crm.example.test")
  assert.ok(context.metadata instanceof MetadataService)
})
