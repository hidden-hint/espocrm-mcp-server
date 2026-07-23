import { z } from "zod";
import { buildFilters } from "../espo/fields.js";
import { pruneUndefined } from "../util.js";
import { guard, jsonResult } from "./result.js";
import type { ToolContext, ToolDef } from "./types.js";

// EspoCRM entity types are PascalCase (Lead, COpportunity); tool names must be
// lower snake_case: Lead -> lead, COpportunity -> c_opportunity.
export function toolSlug(entityType: string): string {
  return entityType
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase();
}

const whereItem = z
  .object({
    type: z
      .string()
      .describe(
        "Condition type: equals, notEquals, like, notLike, contains, in, notIn, isTrue, isFalse, " +
          "isNull, isNotNull, greaterThan, lessThan, greaterThanOrEquals, lessThanOrEquals, and, or.",
      ),
    attribute: z.string().optional().describe("Field name the condition applies to."),
    value: z.any().optional().describe("Comparison value. For 'and'/'or', an array of nested conditions."),
  })
  .passthrough();

async function searchTool(entityType: string, context: ToolContext): Promise<ToolDef> {
  const description = await context.metadata.describeEntity(entityType);
  const filters = buildFilters(description.fields);

  return {
    name: `search_${toolSlug(entityType)}`,
    title: `Search ${entityType}`,
    description:
      `Search ${entityType} records, scoped to the calling user's access rights. The typed parameters below are ` +
      `${entityType} fields — set any to filter. For conditions not covered by them, use 'where'. Both are ANDed together.`,
    inputSchema: {
      ...filters.params,
      where: z
        .array(whereItem)
        .optional()
        .describe("Advanced raw EspoCRM conditions, ANDed with the typed filters above."),
      textFilter: z.string().optional().describe(`Free-text search across ${entityType}'s text fields.`),
      select: z.array(z.string()).optional().describe("Field names to return. Omit for the entity defaults."),
      orderBy: z.string().optional().describe("Field name to sort by."),
      order: z.enum(["asc", "desc"]).optional().describe("Sort direction."),
      maxSize: z.number().int().min(1).max(200).optional().describe("Page size (default 20)."),
      offset: z.number().int().min(0).optional().describe("Result offset for pagination."),
      primaryFilter: z.string().optional().describe(`Named primary filter defined on ${entityType}.`),
    },
    handler: guard(async (args: Record<string, unknown>) => {
      const conditions = filters.toConditions(args);
      if (Array.isArray(args.where)) {
        conditions.push(...args.where);
      }

      const params = pruneUndefined({
        where: conditions.length === 0 ? undefined : conditions,
        textFilter: args.textFilter,
        select: Array.isArray(args.select) ? args.select.join(",") : undefined,
        orderBy: args.orderBy,
        order: args.order,
        maxSize: typeof args.maxSize === "number" ? args.maxSize : 20,
        offset: args.offset,
        primaryFilter: args.primaryFilter,
      });

      const result = await context.espo.find(entityType, params);

      return jsonResult({ total: result.total, list: result.list });
    }),
  };
}

function getTool(entityType: string, context: ToolContext): ToolDef {
  return {
    name: `get_${toolSlug(entityType)}`,
    title: `Get ${entityType}`,
    description: `Fetch a single ${entityType} record by id, subject to the calling user's access rights.`,
    inputSchema: {
      id: z.string().describe(`${entityType} record id.`),
      select: z.array(z.string()).optional().describe("Field names to return. Omit for the full record."),
    },
    handler: guard(async ({ id, select }: { id: string; select?: string[] }) => {
      const params = pruneUndefined({ select: select?.join(",") });

      return jsonResult(await context.espo.getRecord(entityType, id, params));
    }),
  };
}

export async function entityTools(entityType: string, context: ToolContext): Promise<ToolDef[]> {
  return [await searchTool(entityType, context), getTool(entityType, context)];
}
