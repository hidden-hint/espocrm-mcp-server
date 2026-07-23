import type { IncomingHttpHeaders } from "node:http";
import type { Config } from "./config.js";
import { EspoClient } from "./espo/client.js";
import { credentialFromConfig, credentialFromRequest } from "./espo/credential.js";
import { MetadataService } from "./espo/metadata.js";
import type { ToolContext } from "./tools/types.js";

export function contextFromConfig(config: Config): ToolContext {
  const espo = new EspoClient(config.baseUrl, credentialFromConfig(config));

  return { espo, metadata: new MetadataService(espo, config.metadataTtlSeconds) };
}

export function contextFromRequest(headers: IncomingHttpHeaders, config: Config): ToolContext {
  const espo = new EspoClient(config.baseUrl, credentialFromRequest(headers, config));

  return { espo, metadata: new MetadataService(espo, config.metadataTtlSeconds) };
}
