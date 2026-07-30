import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import type { CipherGCM, DecipherGCM } from "node:crypto"
import type { EspoCredential } from "../espo/credential.js"

export interface AuthCodePayload {
  kind: "code"
  username: string
  password: string
  codeChallenge: string
  clientId: string
  redirectUri: string
  scopes: string[]
  exp: number
}

export interface AccessTokenPayload {
  kind: "access"
  espoCredential: EspoCredential
  clientId: string
  scopes: string[]
  aud: string
  exp: number
}

export interface RefreshTokenPayload {
  kind: "refresh"
  username: string
  password: string
  clientId: string
  scopes: string[]
}

export interface AuthRequestPayload {
  kind: "authRequest"
  clientId: string
  redirectUri: string
  codeChallenge: string
  state: string | undefined
  scopes: string[]
  resource: string | undefined
  exp: number
}

export type TokenPayload = AuthCodePayload | AccessTokenPayload | RefreshTokenPayload | AuthRequestPayload

// The literal type is load-bearing: it selects the GCM overloads of
// createCipheriv / createDecipheriv, which carry getAuthTag / setAuthTag.
const ALGORITHM = "aes-256-gcm" as const
const KEY_BYTES: number = 32
const IV_BYTES: number = 12
const TAG_BYTES: number = 16
const HEX_KEY: RegExp = /^[0-9a-fA-F]{64}$/

export function decodeKey(value: string): Buffer {
  const buffer: Buffer = HEX_KEY.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64")
  if (buffer.length !== KEY_BYTES) {
    throw new Error("encryption key must decode to 32 bytes (e.g. `openssl rand -base64 32`)")
  }

  return buffer
}

export function sealToken(payload: TokenPayload, key: Buffer): string {
  const iv: Buffer = randomBytes(IV_BYTES)
  const cipher: CipherGCM = createCipheriv(ALGORITHM, key, iv)
  const ciphertext: Buffer = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()])

  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url")
}

export function unsealToken(token: string, key: Buffer): TokenPayload {
  const raw: Buffer = Buffer.from(token, "base64url")
  const decipher: DecipherGCM = createDecipheriv(ALGORITHM, key, raw.subarray(0, IV_BYTES))
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES))
  const plaintext: Buffer = Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()])

  return JSON.parse(plaintext.toString("utf8")) as TokenPayload
}
