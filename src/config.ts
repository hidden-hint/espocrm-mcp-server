import { ConfigError } from "./errors.js";

export type AuthMode = "apiKey" | "passthrough";
export type Transport = "stdio" | "http";
export type PassthroughAs = "apiKey" | "espoAuthorization";

export interface Config {
  baseUrl: string;
  authMode: AuthMode;
  apiKey: string | undefined;
  passthroughAs: PassthroughAs;
  transport: Transport;
  httpPort: number;
  httpPath: string;
  readOnly: boolean;
  entityTypes: string[];
  metadataTtlSeconds: number;
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

function validate(config: Config): void {
  if (config.authMode === "apiKey" && (config.apiKey === undefined || config.apiKey === "")) {
    throw new ConfigError("ESPOCRM_AUTH_MODE=apiKey requires ESPOCRM_API_KEY");
  }
  if (config.authMode === "passthrough" && config.transport === "stdio") {
    throw new ConfigError("ESPOCRM_AUTH_MODE=passthrough requires MCP_TRANSPORT=http (no per-request headers over stdio)");
  }
}

export function loadConfig(env: Env): Config {
  const config: Config = {
    baseUrl: required(env, "ESPOCRM_BASE_URL").replace(/\/+$/, ""),
    authMode: enumOf(env, "ESPOCRM_AUTH_MODE", ["apiKey", "passthrough"], "apiKey"),
    apiKey: env.ESPOCRM_API_KEY,
    passthroughAs: enumOf(env, "MCP_PASSTHROUGH_AS", ["apiKey", "espoAuthorization"], "apiKey"),
    transport: enumOf(env, "MCP_TRANSPORT", ["stdio", "http"], "stdio"),
    httpPort: integer(env, "MCP_HTTP_PORT", 3000),
    httpPath: env.MCP_HTTP_PATH || "/mcp",
    readOnly: boolean(env, "MCP_READ_ONLY", true),
    entityTypes: commaList(env, "MCP_ENTITY_TYPES", ["Lead", "Contact", "Account", "Opportunity"]),
    metadataTtlSeconds: integer(env, "ESPOCRM_METADATA_TTL", 300),
  };

  validate(config);

  return config;
}
