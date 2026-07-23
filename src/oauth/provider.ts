import type { Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import { InvalidGrantError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Config } from "../config.js";
import { ConfigError, EspoApiError } from "../errors.js";
import { espoAuthorizationCredential } from "../espo/credential.js";
import { InMemoryClientStore } from "./clientStore.js";
import { authenticateEspoUser } from "./espoLogin.js";
import { renderLoginPage } from "./loginPage.js";
import {
  decodeKey,
  sealToken,
  unsealToken,
  type AccessTokenPayload,
  type AuthCodePayload,
  type AuthRequestPayload,
  type RefreshTokenPayload,
  type TokenPayload,
} from "./tokens.js";

const AUTH_REQUEST_TTL_SECONDS = 600;
const AUTH_CODE_TTL_SECONDS = 60;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export interface OauthProviderOptions {
  baseUrl: string;
  encryptionKey: Buffer;
  audience: string;
  accessTokenTtlSeconds: number;
  clientStore: InMemoryClientStore;
}

export class EspoOAuthServerProvider implements OAuthServerProvider {
  private readonly baseUrl: string;
  private readonly key: Buffer;
  private readonly audience: string;
  private readonly accessTokenTtlSeconds: number;
  private readonly clientStore: InMemoryClientStore;

  constructor(options: OauthProviderOptions) {
    this.baseUrl = options.baseUrl;
    this.key = options.encryptionKey;
    this.audience = options.audience;
    this.accessTokenTtlSeconds = options.accessTokenTtlSeconds;
    this.clientStore = options.clientStore;
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return this.clientStore;
  }

  authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const request: AuthRequestPayload = {
      kind: "authRequest",
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state,
      scopes: params.scopes ?? [],
      resource: params.resource?.href,
      exp: nowSeconds() + AUTH_REQUEST_TTL_SECONDS,
    };
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(renderLoginPage({ requestToken: sealToken(request, this.key), error: undefined }));

    return Promise.resolve();
  }

  unsealAuthRequest(requestToken: string): AuthRequestPayload {
    const payload = this.unseal(requestToken);
    if ("authRequest" !== payload.kind || payload.exp < nowSeconds()) {
      throw new InvalidGrantError("Login request is invalid or has expired");
    }

    return payload;
  }

  issueAuthorizationCode(request: AuthRequestPayload, username: string, password: string): string {
    const code: AuthCodePayload = {
      kind: "code",
      username,
      password,
      codeChallenge: request.codeChallenge,
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      scopes: request.scopes,
      exp: nowSeconds() + AUTH_CODE_TTL_SECONDS,
    };

    return sealToken(code, this.key);
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    return this.decodeAuthCode(client, authorizationCode).codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    const code = this.decodeAuthCode(client, authorizationCode);
    if (redirectUri !== undefined && redirectUri !== code.redirectUri) {
      throw new InvalidGrantError("redirect_uri does not match the authorization request");
    }

    return this.issueTokens(client, code.username, code.password, code.scopes);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
  ): Promise<OAuthTokens> {
    const payload = this.unseal(refreshToken);
    if ("refresh" !== payload.kind || payload.clientId !== client.client_id) {
      throw new InvalidGrantError("Invalid refresh token");
    }

    return this.issueTokens(client, payload.username, payload.password, scopes ?? payload.scopes);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const payload = this.unseal(token);
    if ("access" !== payload.kind) {
      throw new InvalidTokenError("Not an access token");
    }
    if (payload.aud !== this.audience) {
      throw new InvalidTokenError("Token audience mismatch");
    }
    if (payload.exp < nowSeconds()) {
      throw new InvalidTokenError("Token has expired");
    }

    return {
      token,
      clientId: payload.clientId,
      scopes: payload.scopes,
      expiresAt: payload.exp,
      resource: new URL(payload.aud),
      extra: { espoCredential: payload.espoCredential },
    };
  }

  revokeToken(): Promise<void> {
    return Promise.resolve();
  }

  private async issueTokens(
    client: OAuthClientInformationFull,
    username: string,
    password: string,
    scopes: string[],
  ): Promise<OAuthTokens> {
    const espoAuthToken = await this.login(username, password);
    const access: AccessTokenPayload = {
      kind: "access",
      espoCredential: espoAuthorizationCredential(username, espoAuthToken),
      clientId: client.client_id,
      scopes,
      aud: this.audience,
      exp: nowSeconds() + this.accessTokenTtlSeconds,
    };
    const refresh: RefreshTokenPayload = { kind: "refresh", username, password, clientId: client.client_id, scopes };

    return {
      access_token: sealToken(access, this.key),
      token_type: "Bearer",
      expires_in: this.accessTokenTtlSeconds,
      refresh_token: sealToken(refresh, this.key),
      ...(scopes.length === 0 ? {} : { scope: scopes.join(" ") }),
    };
  }

  private async login(username: string, password: string): Promise<string> {
    try {
      return await authenticateEspoUser(this.baseUrl, username, password);
    } catch (error) {
      if (error instanceof EspoApiError) {
        throw new InvalidGrantError("EspoCRM rejected the supplied credentials");
      }

      throw error;
    }
  }

  private decodeAuthCode(client: OAuthClientInformationFull, authorizationCode: string): AuthCodePayload {
    const payload = this.unseal(authorizationCode);
    if ("code" !== payload.kind || payload.clientId !== client.client_id || payload.exp < nowSeconds()) {
      throw new InvalidGrantError("Authorization code is invalid or has expired");
    }

    return payload;
  }

  private unseal(token: string): TokenPayload {
    try {
      return unsealToken(token, this.key);
    } catch {
      throw new InvalidTokenError("Malformed token");
    }
  }
}

export function resourceServerUrl(config: Config): URL {
  if (config.oauthIssuerUrl === undefined || config.oauthIssuerUrl === "") {
    throw new ConfigError("oauth mode requires MCP_OAUTH_ISSUER_URL");
  }

  return new URL(config.httpPath, config.oauthIssuerUrl);
}

export function createOauthProvider(config: Config): EspoOAuthServerProvider {
  if (config.oauthEncryptionKey === undefined || config.oauthEncryptionKey === "") {
    throw new ConfigError("oauth mode requires MCP_OAUTH_ENCRYPTION_KEY");
  }

  return new EspoOAuthServerProvider({
    baseUrl: config.baseUrl,
    encryptionKey: decodeKey(config.oauthEncryptionKey),
    audience: resourceServerUrl(config).href,
    accessTokenTtlSeconds: config.accessTokenTtlSeconds,
    clientStore: new InMemoryClientStore(),
  });
}
