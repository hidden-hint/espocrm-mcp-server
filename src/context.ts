import type { Config } from "./config.js"
import { EspoClient } from "./espo/client.js"
import { credentialFromConfig, type EspoCredential } from "./espo/credential.js"
import { LabelService } from "./espo/labels.js"
import { MetadataService } from "./espo/metadata.js"
import type { ToolContext } from "./tools/types.js"

export function contextFromCredential(credential: EspoCredential, config: Config): ToolContext {
  const espo: EspoClient = new EspoClient(config.baseUrl, credential)
  const labels: LabelService = new LabelService(espo, config.metadataTtlSeconds)

  return { espo, metadata: new MetadataService(espo, config.metadataTtlSeconds, labels) }
}

export function contextFromConfig(config: Config): ToolContext {
  return contextFromCredential(credentialFromConfig(config), config)
}
