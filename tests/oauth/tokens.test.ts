import { test } from "node:test"
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { decodeKey, sealToken, unsealToken, type AccessTokenPayload } from "../../src/oauth/tokens.js"
import type { AuthCodePayload, RefreshTokenPayload, TokenPayload } from "../../src/oauth/tokens.js"

const KEY: Buffer = randomBytes(32)

const ACCESS: AccessTokenPayload = {
  kind: "access",
  espoCredential: { kind: "espoAuthorization", value: "dXNlcjp0b2tlbg==" },
  clientId: "client-1",
  scopes: [],
  aud: "https://mcp.example.test/mcp",
  exp: 4102444800,
}

test("sealToken then unsealToken round-trips the payload", (): void => {
  assert.deepEqual(unsealToken(sealToken(ACCESS, KEY), KEY), ACCESS)
})

test("sealToken round-trips an auth code and a refresh payload", (): void => {
  const code: AuthCodePayload = {
    kind: "code",
    username: "ann",
    password: "s3cret",
    codeChallenge: "abc",
    clientId: "client-1",
    redirectUri: "https://client.example/cb",
    scopes: ["a"],
    exp: 4102444800,
  }
  const refresh: RefreshTokenPayload = {
    kind: "refresh",
    username: "ann",
    password: "s3cret",
    clientId: "client-1",
    scopes: [],
  }
  assert.deepEqual(unsealToken(sealToken(code, KEY), KEY), code)
  assert.deepEqual(unsealToken(sealToken(refresh, KEY), KEY), refresh)
})

test("unsealToken throws when the token was sealed with a different key", (): void => {
  const sealed: string = sealToken(ACCESS, KEY)
  assert.throws((): TokenPayload => unsealToken(sealed, randomBytes(32)))
})

test("unsealToken throws when the ciphertext has been tampered with", (): void => {
  const raw: Buffer = Buffer.from(sealToken(ACCESS, KEY), "base64url")
  const last: number = raw.length - 1
  raw[last] = (raw[last] ?? 0) ^ 0x01
  assert.throws((): TokenPayload => unsealToken(raw.toString("base64url"), KEY))
})

test("decodeKey accepts a base64 32-byte key", (): void => {
  const key: Buffer = randomBytes(32)
  assert.deepEqual(decodeKey(key.toString("base64")), key)
})

test("decodeKey accepts a hex 32-byte key", (): void => {
  const key: Buffer = randomBytes(32)
  assert.deepEqual(decodeKey(key.toString("hex")), key)
})

test("decodeKey throws when the key does not decode to 32 bytes", (): void => {
  assert.throws((): Buffer => decodeKey(randomBytes(16).toString("base64")))
  assert.throws((): Buffer => decodeKey("too-short"))
})
