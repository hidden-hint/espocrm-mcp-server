import type { Config } from "../config.js";
import { ConfigError } from "../errors.js";

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

export function espoAuthorizationCredential(username: string, secret: string): EspoCredential {
  return { kind: "espoAuthorization", value: Buffer.from(`${username}:${secret}`, "utf8").toString("base64") };
}
