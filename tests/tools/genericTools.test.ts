import { test } from "node:test";
import assert from "node:assert/strict";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describeEntityTool } from "../../src/tools/describeEntity.js";
import { getStreamTool } from "../../src/tools/getStream.js";
import { listEntityTypesTool } from "../../src/tools/listEntityTypes.js";
import { postToStreamTool } from "../../src/tools/postToStream.js";
import { createContext } from "../testing/fixtures.js";

function parse(result: CallToolResult): any {
  return JSON.parse((result.content[0] as { text: string }).text);
}

test("list_entity_types returns the instance's entity types", async () => {
  const { context } = createContext({});
  const result = await listEntityTypesTool(context).handler({});
  const names = parse(result).map((entry: { entityType: string }) => entry.entityType);
  assert.deepEqual(names, ["CDeal", "Contact", "Lead"]);
});

test("describe_entity returns the pruned field and link description", async () => {
  const { context } = createContext({});
  const result = await describeEntityTool(context).handler({ entityType: "Lead" });
  const description = parse(result);
  assert.equal(description.entityType, "Lead");
  assert.deepEqual(description.fields.status, { type: "enum", required: true, options: ["New", "Assigned", "Dead"] });
});

test("describe_entity surfaces an unknown entity as a tool error", async () => {
  const { context } = createContext({});
  const result = await describeEntityTool(context).handler({ entityType: "Ghost" });
  assert.equal(result.isError, true);
});

test("get_stream requests the stream newest-first with a default page size", async () => {
  const { context, calls } = createContext({ getStream: { total: 1, list: [{ id: "note-1" }] } });
  const result = await getStreamTool(context).handler({ entityType: "Lead", id: "l1" });
  assert.deepEqual(parse(result), { total: 1, list: [{ id: "note-1" }] });
  const [entityType, id, params] = calls.at(-1)!.args as [string, string, Record<string, unknown>];
  assert.equal(entityType, "Lead");
  assert.equal(id, "l1");
  assert.deepEqual(params, { maxSize: 20, orderBy: "createdAt", order: "desc" });
});

test("post_to_stream creates a Post Note linked to the parent record", async () => {
  const { context, calls } = createContext({ create: { id: "note-1" } });
  const result = await postToStreamTool(context).handler({ entityType: "Lead", id: "l1", post: "Called back" });
  assert.deepEqual(parse(result), { id: "note-1" });
  const [entityType, body] = calls.at(-1)!.args as [string, Record<string, unknown>];
  assert.equal(entityType, "Note");
  assert.deepEqual(body, { type: "Post", parentType: "Lead", parentId: "l1", post: "Called back" });
});
