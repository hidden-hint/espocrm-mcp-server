import { z } from "zod";
import { writableFields, type WriteFieldSpec } from "../espo/fields.js";
import { toolSlug } from "./entityTools.js";
import { guard, jsonResult } from "./result.js";
import type { ToolContext, ToolDef } from "./types.js";

function bodyFromArgs(specs: WriteFieldSpec[], args: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const spec of specs) {
    if (args[spec.name] !== undefined) {
      body[spec.name] = args[spec.name];
    }
  }

  return body;
}

function createShape(specs: WriteFieldSpec[]): z.ZodRawShape {
  const shape: z.ZodRawShape = {};
  for (const spec of specs) {
    shape[spec.name] = spec.required ? spec.zod : spec.zod.optional();
  }

  return shape;
}

function updateShape(specs: WriteFieldSpec[]): z.ZodRawShape {
  const shape: z.ZodRawShape = { id: z.string().describe("Record id to update.") };
  for (const spec of specs) {
    shape[spec.name] = spec.zod.optional();
  }

  return shape;
}

function createTool(entityType: string, context: ToolContext, specs: WriteFieldSpec[]): ToolDef {
  return {
    name: `create_${toolSlug(entityType)}`,
    title: `Create ${entityType}`,
    description: `Create a new ${entityType} record. Fields are validated and ACL-checked server-side by EspoCRM.`,
    inputSchema: createShape(specs),
    handler: guard(async (args: Record<string, unknown>) =>
      jsonResult(await context.espo.create(entityType, bodyFromArgs(specs, args))),
    ),
  };
}

function updateTool(entityType: string, context: ToolContext, specs: WriteFieldSpec[]): ToolDef {
  return {
    name: `update_${toolSlug(entityType)}`,
    title: `Update ${entityType}`,
    description:
      `Update a ${entityType} record by id. Only the fields you provide are changed (partial update); omitted ` +
      `fields are left untouched. ACL-checked server-side.`,
    inputSchema: updateShape(specs),
    handler: guard(async (args: Record<string, unknown>) => {
      const { id, ...rest } = args;

      return jsonResult(await context.espo.update(entityType, String(id), bodyFromArgs(specs, rest)));
    }),
  };
}

function deleteTool(entityType: string, context: ToolContext): ToolDef {
  return {
    name: `delete_${toolSlug(entityType)}`,
    title: `Delete ${entityType}`,
    description:
      `Delete a ${entityType} record by id. In EspoCRM this moves the record to the deleted state ` +
      `(recoverable from the recycle bin). ACL-checked server-side.`,
    inputSchema: { id: z.string().describe("Record id to delete.") },
    handler: guard(async ({ id }: { id: string }) => {
      await context.espo.deleteRecord(entityType, id);

      return jsonResult({ deleted: true, id });
    }),
  };
}

export async function entityWriteTools(entityType: string, context: ToolContext): Promise<ToolDef[]> {
  const specs = writableFields((await context.metadata.describeEntity(entityType)).fields);

  return [createTool(entityType, context, specs), updateTool(entityType, context, specs), deleteTool(entityType, context)];
}
