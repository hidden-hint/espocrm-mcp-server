import type { IncomingHttpHeaders } from "node:http";
import type { Config } from "../config.js";
import { AuthError, ConfigError } from "../errors.js";

export type EspoCredential =
  | { kind: "apiKey"; apiKey: string }
  | { kind: "espoAuthorization"; value: string };

export function credentialHeaders(credential: EspoCredential): Record<string, string> {
  switch (credential.kind) {
    case "apiKey":
      return { "X-Api-Key": credential.apiKey };
    case "espoAuthorization":
      return { "Espo-Authorization": credential.value };
  }
}

export function credentialFromConfig(config: Config): EspoCredential {
  if (config.apiKey === undefined || config.apiKey === "") {
    throw new ConfigError("ESPOCRM_API_KEY is required for apiKey auth mode");
  }

  return { kind: "apiKey", apiKey: config.apiKey };
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];

  return Array.isArray(value) ? value[0] : value;
}

export function credentialFromRequest(headers: IncomingHttpHeaders, config: Config): EspoCredential {
  if (config.authMode === "apiKey") {
    return credentialFromConfig(config);
  }

  const apiKey = headerValue(headers, "x-api-key");
  if (apiKey !== undefined && apiKey !== "") {
    return { kind: "apiKey", apiKey };
  }

  const espoAuthorization = headerValue(headers, "espo-authorization");
  if (espoAuthorization !== undefined && espoAuthorization !== "") {
    return { kind: "espoAuthorization", value: espoAuthorization };
  }

  const authorization = headerValue(headers, "authorization");
  if (authorization !== undefined && authorization !== "") {
    const token = authorization.replace(/^Bearer\s+/i, "");

    return config.passthroughAs === "espoAuthorization"
      ? { kind: "espoAuthorization", value: token }
      : { kind: "apiKey", apiKey: token };
  }

  throw new AuthError(
    "No EspoCRM credential in request. Send X-Api-Key, Espo-Authorization, or Authorization: Bearer <token>.",
  );
}
