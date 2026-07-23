import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { EspoClient } from "../espo/client.js";
import type { MetadataService } from "../espo/metadata.js";

// Bound to a single request: the client is already authenticated as the caller,
// so every tool inherits that user's ACL for free.
export interface ToolContext {
  espo: EspoClient;
  metadata: MetadataService;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (args: any) => Promise<CallToolResult>;
}
