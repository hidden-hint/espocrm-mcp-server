import { guard, jsonResult } from "./result.js";
import type { ToolContext, ToolDef } from "./types.js";

export function listEntityTypesTool(context: ToolContext): ToolDef {
  return {
    name: "list_entity_types",
    title: "List entity types",
    description:
      "List the EspoCRM entity types available on this instance (Lead, Contact, Account, Opportunity, custom entities, ...). " +
      "Use this first to discover what can be searched or read, then call describe_entity for a type's fields.",
    inputSchema: {},
    handler: guard(async () => jsonResult(await context.metadata.listEntityTypes())),
  };
}
