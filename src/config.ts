import { ConfigError } from "./errors.js";
import { decodeKey } from "./oauth/tokens.js";

export type AuthMode = "apiKey" | "oauth";
export type Transport = "stdio" | "http";

export interface Config {
  baseUrl: string;
  authMode: AuthMode;
  apiKey: string | undefined;
  transport: Transport;
  httpPort: number;
  httpPath: string;
  readOnly: boolean;
  entityTypes: string[];
  metadataTtlSeconds: number;
  oauthIssuerUrl: string | undefined;
  oauthEncryptionKey: string | undefined;
  accessTokenTtlSeconds: number;
}

type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const value = env[key];
  if (value === undefined || value === "") {
    throw new ConfigError(`Missing required environment variable ${key}`);
  }

  return value;
}

function enumOf<T extends string>(env: Env, key: string, allowed: readonly T[], fallback: T): T {
  const value = env[key];
  if (value === undefined || value === "") {
    return fallback;
  }
  if (!allowed.includes(value as T)) {
    throw new ConfigError(`Environment variable ${key} must be one of: ${allowed.join(", ")}`);
  }

  return value as T;
}

function integer(env: Env, key: string, fallback: number): number {
  const value = env[key];
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new ConfigError(`Environment variable ${key} must be an integer`);
  }

  return parsed;
}

function boolean(env: Env, key: string, fallback: boolean): boolean {
  const value = env[key];
  if (value === undefined || value === "") {
    return fallback;
  }

  return /^(1|true|yes|on)$/i.test(value);
}

function commaList(env: Env, key: string, fallback: string[]): string[] {
  const value = env[key];
  if (value === undefined || value === "") {
    return fallback;
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function assertValidEncryptionKey(value: string): void {
  try {
    decodeKey(value);
  } catch (error) {
    throw new ConfigError(`MCP_OAUTH_ENCRYPTION_KEY is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateApiKeyMode(config: Config): void {
  if (config.apiKey === undefined || config.apiKey === "") {
    throw new ConfigError("ESPOCRM_AUTH_MODE=apiKey requires ESPOCRM_API_KEY");
  }
}

function validateOauthMode(config: Config): void {
  if (config.transport !== "http") {
    throw new ConfigError("ESPOCRM_AUTH_MODE=oauth requires MCP_TRANSPORT=http (no browser login flow over stdio)");
  }
  if (config.oauthIssuerUrl === undefined || config.oauthIssuerUrl === "") {
    throw new ConfigError("ESPOCRM_AUTH_MODE=oauth requires MCP_OAUTH_ISSUER_URL (this server's public URL)");
  }
  if (config.oauthEncryptionKey === undefined || config.oauthEncryptionKey === "") {
    throw new ConfigError("ESPOCRM_AUTH_MODE=oauth requires MCP_OAUTH_ENCRYPTION_KEY (32 bytes, e.g. `openssl rand -base64 32`)");
  }

  assertValidEncryptionKey(config.oauthEncryptionKey);
}

function validate(config: Config): void {
  if (config.authMode === "apiKey") {
    validateApiKeyMode(config);

    return;
  }

  validateOauthMode(config);
}

export function loadConfig(env: Env): Config {
  const config: Config = {
    baseUrl: required(env, "ESPOCRM_BASE_URL").replace(/\/+$/, ""),
    authMode: enumOf(env, "ESPOCRM_AUTH_MODE", ["apiKey", "oauth"], "apiKey"),
    apiKey: env.ESPOCRM_API_KEY,
    transport: enumOf(env, "MCP_TRANSPORT", ["stdio", "http"], "stdio"),
    httpPort: integer(env, "MCP_HTTP_PORT", 3000),
    httpPath: env.MCP_HTTP_PATH || "/mcp",
    readOnly: boolean(env, "MCP_READ_ONLY", true),
    entityTypes: commaList(env, "MCP_ENTITY_TYPES", ["Lead", "Contact", "Account", "Opportunity"]),
    metadataTtlSeconds: integer(env, "ESPOCRM_METADATA_TTL", 300),
    oauthIssuerUrl: env.MCP_OAUTH_ISSUER_URL,
    oauthEncryptionKey: env.MCP_OAUTH_ENCRYPTION_KEY,
    accessTokenTtlSeconds: integer(env, "MCP_ACCESS_TOKEN_TTL", 3600),
  };

  validate(config);

  return config;
}
