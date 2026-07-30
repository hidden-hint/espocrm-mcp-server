import { test, afterEach } from "node:test"
import assert from "node:assert/strict"
import type { Response } from "express"
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js"
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js"
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js"
import { createOauthProvider } from "../../src/oauth/provider.js"
import { decodeKey, sealToken, unsealToken, type TokenPayload } from "../../src/oauth/tokens.js"
import { espoAuthorizationCredential } from "../../src/espo/credential.js"
import { makeConfig } from "../testing/fixtures.js"
import type { EspoOAuthServerProvider } from "../../src/oauth/provider.js"
import type { Config } from "../../src/config.js"
import type { AuthRequestPayload, RefreshTokenPayload } from "../../src/oauth/tokens.js"

const KEY_B64: string = Buffer.alloc(32, 7).toString("base64")
const AUDIENCE: string = "https://mcp.example.test/mcp"
const CLIENT = { client_id: "client-1", redirect_uris: ["https://client.example/cb"] } as OAuthClientInformationFull

interface StubbedResponse {
  ok: boolean
  status: number
  text: () => Promise<string>
}

interface TestProvider {
  provider: EspoOAuthServerProvider
  key: Buffer
}

const realFetch: typeof fetch = globalThis.fetch

afterEach((): void => {
  globalThis.fetch = realFetch
})

function stubAppUser(response: { ok: boolean; status: number; body: string }): void {
  globalThis.fetch = ((): Promise<StubbedResponse> =>
    Promise.resolve({
      ok: response.ok,
      status: response.status,
      text: (): Promise<string> => Promise.resolve(response.body),
    })) as unknown as typeof fetch
}

function makeProvider(): TestProvider {
  const config: Config = makeConfig({
    authMode: "oauth",
    apiKey: undefined,
    transport: "http",
    baseUrl: "https://crm.example.test",
    oauthIssuerUrl: "https://mcp.example.test",
    oauthEncryptionKey: KEY_B64,
  })

  return { provider: createOauthProvider(config), key: decodeKey(KEY_B64) }
}

const nowSeconds: () => number = (): number => Math.floor(Date.now() / 1000)

function fakeResponse(): { response: Response; read: () => string } {
  let body: string = ""
  const response: { setHeader(): void; send(value: string): void } = {
    setHeader(): void {},
    send(value: string): void {
      body = value
    },
  }

  return { response: response as unknown as Response, read: (): string => body }
}

test("verifyAccessToken returns AuthInfo carrying the EspoCRM credential in extra", async (): Promise<void> => {
  const { provider, key }: TestProvider = makeProvider()
  const token: string = sealToken(
    {
      kind: "access",
      espoCredential: { kind: "espoAuthorization", value: "sealed-value" },
      clientId: "client-1",
      scopes: ["s"],
      aud: AUDIENCE,
      exp: nowSeconds() + 3600,
    },
    key,
  )
  const info: AuthInfo = await provider.verifyAccessToken(token)
  assert.equal(info.clientId, "client-1")
  assert.deepEqual(info.scopes, ["s"])
  assert.equal(info.expiresAt, nowSeconds() + 3600)
  assert.deepEqual(info.extra?.espoCredential, { kind: "espoAuthorization", value: "sealed-value" })
})

test("verifyAccessToken rejects an expired token", async (): Promise<void> => {
  const { provider, key }: TestProvider = makeProvider()
  const token: string = sealToken(
    {
      kind: "access",
      espoCredential: { kind: "apiKey", apiKey: "k" },
      clientId: "client-1",
      scopes: [],
      aud: AUDIENCE,
      exp: nowSeconds() - 10,
    },
    key,
  )
  await assert.rejects(provider.verifyAccessToken(token), /expired/i)
})

test("verifyAccessToken rejects a token minted for a different audience", async (): Promise<void> => {
  const { provider, key }: TestProvider = makeProvider()
  const token: string = sealToken(
    {
      kind: "access",
      espoCredential: { kind: "apiKey", apiKey: "k" },
      clientId: "client-1",
      scopes: [],
      aud: "https://evil.example/mcp",
      exp: nowSeconds() + 3600,
    },
    key,
  )
  await assert.rejects(provider.verifyAccessToken(token), /audience/i)
})

test("verifyAccessToken rejects a non-access token and garbage", async (): Promise<void> => {
  const { provider, key }: TestProvider = makeProvider()
  const refresh: string = sealToken(
    { kind: "refresh", username: "a", password: "b", clientId: "client-1", scopes: [] },
    key,
  )
  await assert.rejects(provider.verifyAccessToken(refresh), /access token/i)
  await assert.rejects(provider.verifyAccessToken("not-a-real-token"), /Malformed/i)
})

test("challengeForAuthorizationCode returns the sealed PKCE challenge", async (): Promise<void> => {
  const { provider, key }: TestProvider = makeProvider()
  const code: string = sealToken(
    {
      kind: "code",
      username: "ann",
      password: "p",
      codeChallenge: "the-challenge",
      clientId: "client-1",
      redirectUri: "https://client.example/cb",
      scopes: [],
      exp: nowSeconds() + 60,
    },
    key,
  )
  assert.equal(await provider.challengeForAuthorizationCode(CLIENT, code), "the-challenge")
})

test("exchangeAuthorizationCode logs in to EspoCRM and mints usable access and refresh tokens", async (): Promise<void> => {
  const { provider, key }: TestProvider = makeProvider()
  stubAppUser({ ok: true, status: 200, body: JSON.stringify({ token: "espo-token" }) })
  const code: string = sealToken(
    {
      kind: "code",
      username: "ann",
      password: "p",
      codeChallenge: "c",
      clientId: "client-1",
      redirectUri: "https://client.example/cb",
      scopes: ["x"],
      exp: nowSeconds() + 60,
    },
    key,
  )
  const tokens: OAuthTokens = await provider.exchangeAuthorizationCode(
    CLIENT,
    code,
    undefined,
    "https://client.example/cb",
  )
  assert.equal(tokens.token_type, "Bearer")
  assert.equal(tokens.expires_in, 3600)
  assert.equal(tokens.scope, "x")

  const info: AuthInfo = await provider.verifyAccessToken(tokens.access_token)
  assert.deepEqual(info.extra?.espoCredential, espoAuthorizationCredential("ann", "espo-token"))

  const refresh: RefreshTokenPayload = unsealToken(tokens.refresh_token!, key) as Extract<
    TokenPayload,
    { kind: "refresh" }
  >
  assert.equal(refresh.kind, "refresh")
  assert.equal(refresh.username, "ann")
  assert.equal(refresh.password, "p")
})

test("exchangeAuthorizationCode rejects a code whose redirect_uri does not match", async (): Promise<void> => {
  const { provider, key }: TestProvider = makeProvider()
  const code: string = sealToken(
    {
      kind: "code",
      username: "ann",
      password: "p",
      codeChallenge: "c",
      clientId: "client-1",
      redirectUri: "https://client.example/cb",
      scopes: [],
      exp: nowSeconds() + 60,
    },
    key,
  )
  await assert.rejects(
    provider.exchangeAuthorizationCode(CLIENT, code, undefined, "https://client.example/other"),
    /redirect_uri/i,
  )
})

test("exchangeAuthorizationCode surfaces an EspoCRM credential rejection as an invalid grant", async (): Promise<void> => {
  const { provider, key }: TestProvider = makeProvider()
  stubAppUser({ ok: false, status: 401, body: "Unauthorized" })
  const code: string = sealToken(
    {
      kind: "code",
      username: "ann",
      password: "wrong",
      codeChallenge: "c",
      clientId: "client-1",
      redirectUri: "https://client.example/cb",
      scopes: [],
      exp: nowSeconds() + 60,
    },
    key,
  )
  await assert.rejects(
    provider.exchangeAuthorizationCode(CLIENT, code, undefined, "https://client.example/cb"),
    /EspoCRM rejected/i,
  )
})

test("exchangeRefreshToken re-authenticates and issues a fresh access token", async (): Promise<void> => {
  const { provider, key }: TestProvider = makeProvider()
  stubAppUser({ ok: true, status: 200, body: JSON.stringify({ token: "fresh-token" }) })
  const refresh: string = sealToken(
    { kind: "refresh", username: "ann", password: "p", clientId: "client-1", scopes: ["y"] },
    key,
  )
  const tokens: OAuthTokens = await provider.exchangeRefreshToken(CLIENT, refresh)
  const info: AuthInfo = await provider.verifyAccessToken(tokens.access_token)
  assert.deepEqual(info.extra?.espoCredential, espoAuthorizationCredential("ann", "fresh-token"))
})

test("authorize renders a login form with the OAuth request sealed into a hidden field", async (): Promise<void> => {
  const { provider, key }: TestProvider = makeProvider()
  const { response, read } = fakeResponse()
  await provider.authorize(
    CLIENT,
    { redirectUri: "https://client.example/cb", codeChallenge: "chal", scopes: ["a"], state: "xyz" },
    response,
  )
  const body: string = read()
  assert.match(body, /action="\/oauth\/login"/)
  assert.match(body, /name="password"/)

  const requestToken: string = /name="request" value="([^"]+)"/.exec(body)?.[1] ?? ""
  const payload: AuthRequestPayload = unsealToken(requestToken, key) as Extract<TokenPayload, { kind: "authRequest" }>
  assert.equal(payload.kind, "authRequest")
  assert.equal(payload.clientId, "client-1")
  assert.equal(payload.redirectUri, "https://client.example/cb")
  assert.equal(payload.codeChallenge, "chal")
  assert.equal(payload.state, "xyz")
})
