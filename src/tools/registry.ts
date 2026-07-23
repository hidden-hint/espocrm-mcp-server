import type { Config } from "../config.js";
import { log } from "../logger.js";
import { describeEntityTool } from "./describeEntity.js";
import { entityTools } from "./entityTools.js";
import { getStreamTool } from "./getStream.js";
import { listEntityTypesTool } from "./listEntityTypes.js";
import { postToStreamTool } from "./postToStream.js";
import type { ToolContext, ToolDef } from "./types.js";
import { entityWriteTools } from "./writeTools.js";

// Cross-cutting helpers stay generic (they don't multiply per entity); search/get
// are generated per allowlisted entity with typed filters derived from metadata.
// An unknown allowlisted entity is logged and skipped rather than breaking startup.
export async function collectTools(context: ToolContext, config: Config): Promise<ToolDef[]> {
  const tools: ToolDef[] = [
    listEntityTypesTool(context),
    describeEntityTool(context),
    getStreamTool(context),
  ];

  for (const entityType of config.entityTypes) {
    try {
      tools.push(...(await entityTools(entityType, context)));
    } catch (error) {
      log(`skipping entity '${entityType}': ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!config.readOnly) {
    tools.push(postToStreamTool(context));
    for (const entityType of config.entityTypes) {
      try {
        tools.push(...(await entityWriteTools(entityType, context)));
      } catch (error) {
        log(`skipping write tools for '${entityType}': ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return tools;
}
