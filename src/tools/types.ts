import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { EspoClient } from "../espo/client.js"
import type { ParamShape } from "../espo/fields.js"
import type { MetadataService } from "../espo/metadata.js"

// Bound to a single request: the client is already authenticated as the caller,
// so every tool inherits that user's ACL for free.
export interface ToolContext {
  espo: EspoClient
  metadata: MetadataService
}

export interface ToolDef {
  name: string
  title: string
  description: string
  inputSchema: ParamShape
  handler: (args: any) => Promise<CallToolResult>
}
