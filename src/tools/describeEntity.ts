import { z } from "zod";
import { guard, jsonResult } from "./result.js";
import type { ToolContext, ToolDef } from "./types.js";

export function describeEntityTool(context: ToolContext): ToolDef {
  return {
    name: "describe_entity",
    title: "Describe entity",
    description:
      "Return the fields (with types and enum options) and relationships of an EspoCRM entity type. " +
      "Use this to learn valid attribute names and values before searching or reading records.",
    inputSchema: {
      entityType: z.string().describe("Entity type name, e.g. 'Lead'. Get valid values from list_entity_types."),
    },
    handler: guard(async ({ entityType }: { entityType: string }) =>
      jsonResult(await context.metadata.describeEntity(entityType)),
    ),
  };
}
