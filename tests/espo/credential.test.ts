import { test } from "node:test"
import assert from "node:assert/strict"
import { ConfigError } from "../../src/errors.js"
import {
  credentialFingerprint,
  credentialFromConfig,
  credentialHeaders,
  espoAuthorizationCredential,
} from "../../src/espo/credential.js"
import { makeConfig } from "../testing/fixtures.js"
import type { EspoCredential } from "../../src/espo/credential.js"

test("credentialHeaders renders an apiKey credential as X-Api-Key", (): void => {
  assert.deepEqual(credentialHeaders({ kind: "apiKey", apiKey: "secret" }), { "X-Api-Key": "secret" })
})

test("credentialHeaders renders an espoAuthorization credential as Espo-Authorization", (): void => {
  assert.deepEqual(credentialHeaders({ kind: "espoAuthorization", value: "token" }), {
    "Espo-Authorization": "token",
  })
})

test("credentialFromConfig returns the configured apiKey", (): void => {
  assert.deepEqual(credentialFromConfig(makeConfig({ apiKey: "secret" })), { kind: "apiKey", apiKey: "secret" })
})

test("credentialFromConfig throws when the apiKey is missing or empty", (): void => {
  assert.throws((): EspoCredential => credentialFromConfig(makeConfig({ apiKey: undefined })), ConfigError)
  assert.throws((): EspoCredential => credentialFromConfig(makeConfig({ apiKey: "" })), ConfigError)
})

test("credentialFingerprint is stable for the same credential and distinct across credentials", (): void => {
  const fingerprint: string = credentialFingerprint({ kind: "apiKey", apiKey: "secret" })
  assert.equal(fingerprint, credentialFingerprint({ kind: "apiKey", apiKey: "secret" }))
  assert.notEqual(fingerprint, credentialFingerprint({ kind: "apiKey", apiKey: "other" }))
  assert.notEqual(fingerprint, credentialFingerprint({ kind: "espoAuthorization", value: "secret" }))
})

test("credentialFingerprint does not leak the credential it fingerprints", (): void => {
  const fingerprint: string = credentialFingerprint({ kind: "apiKey", apiKey: "secret" })
  assert.match(fingerprint, /^[0-9a-f]{64}$/)
  assert.ok(!fingerprint.includes("secret"))
})

test("espoAuthorizationCredential base64-encodes username:secret into an Espo-Authorization value", (): void => {
  const credential: EspoCredential = espoAuthorizationCredential("ann", "s3cret")
  assert.deepEqual(credential, {
    kind: "espoAuthorization",
    value: Buffer.from("ann:s3cret", "utf8").toString("base64"),
  })
  assert.deepEqual(credentialHeaders(credential), {
    "Espo-Authorization": Buffer.from("ann:s3cret", "utf8").toString("base64"),
  })
})
