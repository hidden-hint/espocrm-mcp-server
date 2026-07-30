import { z } from "zod"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { pruneUndefined } from "../util.js"
import { guard, jsonResult } from "./result.js"
import type { ToolContext, ToolDef } from "./types.js"
import type { ListResult } from "../espo/client.js"

export function getStreamTool(context: ToolContext): ToolDef {
  return {
    name: "get_stream",
    title: "Get record stream",
    description:
      "Fetch the activity stream of an EspoCRM record — posts, emails, status changes, and other updates, " +
      "newest first. Useful for understanding the history of a lead or other record.",
    inputSchema: {
      entityType: z.string().describe("Entity type name, e.g. 'Lead'."),
      id: z.string().describe("Record id."),
      maxSize: z.number().int().min(1).max(200).optional().describe("Page size (default 20)."),
      offset: z.number().int().min(0).optional().describe("Result offset for pagination."),
    },
    handler: guard(
      async ({
        entityType,
        id,
        maxSize,
        offset,
      }: {
        entityType: string
        id: string
        maxSize?: number
        offset?: number
      }): Promise<CallToolResult> => {
        const params: Record<string, unknown> = pruneUndefined({
          maxSize: maxSize ?? 20,
          offset,
          orderBy: "createdAt",
          order: "desc",
        })

        const result: ListResult<Record<string, unknown>> = await context.espo.getStream(entityType, id, params)

        return jsonResult({ total: result.total, list: result.list })
      },
    ),
  }
}
