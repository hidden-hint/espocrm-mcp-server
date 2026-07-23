import { z } from "zod";
import { guard, jsonResult } from "./result.js";
import type { ToolContext, ToolDef } from "./types.js";

export function postToStreamTool(context: ToolContext): ToolDef {
  return {
    name: "post_to_stream",
    title: "Post to record stream",
    description:
      "Post a text note to an EspoCRM record's activity stream (a Post on the record). ACL-checked server-side. " +
      "Use this to log a call outcome, a follow-up, or any manual note on a lead or other record.",
    inputSchema: {
      entityType: z.string().describe("Entity type of the record, e.g. 'Lead'."),
      id: z.string().describe("Record id to post the note on."),
      post: z.string().describe("The note text."),
    },
    handler: guard(async ({ entityType, id, post }: { entityType: string; id: string; post: string }) =>
      jsonResult(await context.espo.create("Note", { type: "Post", parentType: entityType, parentId: id, post })),
    ),
  };
}
