import { test } from "node:test"
import assert from "node:assert/strict"
import { AuthError, ConfigError, EspoApiError } from "../src/errors.js"

test("ConfigError carries its name and message and extends Error", (): void => {
  const error: ConfigError = new ConfigError("bad config")
  assert.ok(error instanceof Error)
  assert.equal(error.name, "ConfigError")
  assert.equal(error.message, "bad config")
})

test("AuthError carries its name and message and extends Error", (): void => {
  const error: AuthError = new AuthError("no credential")
  assert.ok(error instanceof Error)
  assert.equal(error.name, "AuthError")
  assert.equal(error.message, "no credential")
})

test("EspoApiError exposes status and body and a derived message", (): void => {
  const error: EspoApiError = new EspoApiError(404, "Not Found")
  assert.ok(error instanceof Error)
  assert.equal(error.name, "EspoApiError")
  assert.equal(error.status, 404)
  assert.equal(error.body, "Not Found")
  assert.equal(error.message, "EspoCRM API error 404")
})
