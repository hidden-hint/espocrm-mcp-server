import { test } from "node:test"
import assert from "node:assert/strict"
import { loadConfig } from "../src/config.js"
import { ConfigError } from "../src/errors.js"
import type { Config } from "../src/config.js"

const MINIMAL: Record<string, string> = { ESPOCRM_BASE_URL: "https://crm.example.test", ESPOCRM_API_KEY: "key" }

const OAUTH_ENV: Record<string, string> = {
  ESPOCRM_BASE_URL: "https://crm.example.test",
  ESPOCRM_AUTH_MODE: "oauth",
  MCP_TRANSPORT: "http",
  MCP_OAUTH_ISSUER_URL: "https://mcp.example.test",
  MCP_OAUTH_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
}

test("loadConfig applies documented defaults", (): void => {
  const config: Config = loadConfig(MINIMAL)
  assert.equal(config.authMode, "apiKey")
  assert.equal(config.transport, "stdio")
  assert.equal(config.httpPort, 3000)
  assert.equal(config.httpPath, "/mcp")
  assert.equal(config.readOnly, true)
  assert.deepEqual(config.entityTypes, ["Lead", "Contact", "Account", "Opportunity"])
  assert.equal(config.metadataTtlSeconds, 300)
  assert.equal(config.accessTokenTtlSeconds, 3600)
})

test("loadConfig strips a trailing slash from the base URL", (): void => {
  assert.equal(
    loadConfig({ ...MINIMAL, ESPOCRM_BASE_URL: "https://crm.example.test///" }).baseUrl,
    "https://crm.example.test",
  )
})

test("loadConfig throws when the base URL is missing", (): void => {
  assert.throws((): Config => loadConfig({ ESPOCRM_API_KEY: "key" }), ConfigError)
  assert.throws((): Config => loadConfig({ ESPOCRM_BASE_URL: "", ESPOCRM_API_KEY: "key" }), ConfigError)
})

test("loadConfig requires an apiKey in apiKey auth mode", (): void => {
  assert.throws((): Config => loadConfig({ ESPOCRM_BASE_URL: "https://crm.example.test" }), ConfigError)
})

test("loadConfig accepts oauth auth over http without an apiKey", (): void => {
  const config: Config = loadConfig(OAUTH_ENV)
  assert.equal(config.authMode, "oauth")
  assert.equal(config.apiKey, undefined)
  assert.equal(config.oauthIssuerUrl, "https://mcp.example.test")
})

test("loadConfig rejects oauth auth over the stdio transport", (): void => {
  assert.throws((): Config => loadConfig({ ...OAUTH_ENV, MCP_TRANSPORT: "stdio" }), ConfigError)
})

test("loadConfig rejects oauth auth without an issuer URL", (): void => {
  const { MCP_OAUTH_ISSUER_URL, ...withoutIssuer } = OAUTH_ENV
  assert.throws((): Config => loadConfig(withoutIssuer), ConfigError)
})

test("loadConfig rejects oauth auth without an encryption key", (): void => {
  const { MCP_OAUTH_ENCRYPTION_KEY, ...withoutKey } = OAUTH_ENV
  assert.throws((): Config => loadConfig(withoutKey), ConfigError)
})

test("loadConfig rejects an oauth encryption key that is not 32 bytes", (): void => {
  assert.throws((): Config => loadConfig({ ...OAUTH_ENV, MCP_OAUTH_ENCRYPTION_KEY: "too-short" }), ConfigError)
})

test("loadConfig rejects an out-of-range enum value", (): void => {
  assert.throws((): Config => loadConfig({ ...MINIMAL, ESPOCRM_AUTH_MODE: "passthrough" }), ConfigError)
  assert.throws((): Config => loadConfig({ ...MINIMAL, MCP_TRANSPORT: "grpc" }), ConfigError)
})

test("loadConfig rejects a non-integer port", (): void => {
  assert.throws((): Config => loadConfig({ ...MINIMAL, MCP_HTTP_PORT: "8080.5" }), ConfigError)
  assert.throws((): Config => loadConfig({ ...MINIMAL, MCP_HTTP_PORT: "abc" }), ConfigError)
})

test("loadConfig parses an integer port", (): void => {
  assert.equal(loadConfig({ ...MINIMAL, MCP_HTTP_PORT: "8080" }).httpPort, 8080)
})

test("loadConfig parses truthy boolean spellings for readOnly", (): void => {
  for (const value of ["1", "true", "TRUE", "yes", "on"]) {
    assert.equal(loadConfig({ ...MINIMAL, MCP_READ_ONLY: value }).readOnly, true, value)
  }
})

test("loadConfig parses falsy boolean spellings for readOnly", (): void => {
  for (const value of ["0", "false", "no", "off", "anything-else"]) {
    assert.equal(loadConfig({ ...MINIMAL, MCP_READ_ONLY: value }).readOnly, false, value)
  }
})

test("loadConfig splits, trims, and compacts the entity type list", (): void => {
  assert.deepEqual(loadConfig({ ...MINIMAL, MCP_ENTITY_TYPES: " Lead , Contact ,, CDeal " }).entityTypes, [
    "Lead",
    "Contact",
    "CDeal",
  ])
})

test("loadConfig falls back to the default http path when the value is empty", (): void => {
  assert.equal(loadConfig({ ...MINIMAL, MCP_HTTP_PATH: "" }).httpPath, "/mcp")
  assert.equal(loadConfig({ ...MINIMAL, MCP_HTTP_PATH: "/custom" }).httpPath, "/custom")
})
