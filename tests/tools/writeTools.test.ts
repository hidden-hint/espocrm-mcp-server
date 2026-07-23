import { test } from "node:test";
import assert from "node:assert/strict";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolDef } from "../../src/tools/types.js";
import { entityWriteTools } from "../../src/tools/writeTools.js";
import { createContext } from "../testing/fixtures.js";

function parse(result: CallToolResult): unknown {
  return JSON.parse((result.content[0] as { text: string }).text);
}

function byName(tools: ToolDef[], name: string): ToolDef {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `expected a tool named ${name}`);

  return tool;
}

test("entityWriteTools produces create, update, and delete tools", async () => {
  const { context } = createContext({});
  const tools = await entityWriteTools("Lead", context);
  assert.deepEqual(tools.map((tool) => tool.name), ["create_lead", "update_lead", "delete_lead"]);
});

test("the create schema keeps required fields required and others optional", async () => {
  const { context } = createContext({});
  const create = byName(await entityWriteTools("Lead", context), "create_lead");
  assert.equal(create.inputSchema.status?.isOptional(), false);
  assert.equal(create.inputSchema.name?.isOptional(), true);
});

test("the create handler sends only the provided fields", async () => {
  const { context, calls } = createContext({ create: { id: "new-1" } });
  const create = byName(await entityWriteTools("Lead", context), "create_lead");
  const result = await create.handler({ name: "Ann", status: "New", ignored: "x" });
  assert.deepEqual(parse(result), { id: "new-1" });
  const [entityType, body] = calls.at(-1)!.args as [string, Record<string, unknown>];
  assert.equal(entityType, "Lead");
  assert.deepEqual(body, { name: "Ann", status: "New" });
});

test("the update schema makes every field optional and adds an id", async () => {
  const { context } = createContext({});
  const update = byName(await entityWriteTools("Lead", context), "update_lead");
  assert.ok("id" in update.inputSchema);
  assert.equal(update.inputSchema.status?.isOptional(), true);
});

test("the update handler splits the id out and sends a partial body", async () => {
  const { context, calls } = createContext({ update: { id: "l1" } });
  const update = byName(await entityWriteTools("Lead", context), "update_lead");
  await update.handler({ id: "l1", status: "Assigned" });
  const [entityType, id, body] = calls.at(-1)!.args as [string, string, Record<string, unknown>];
  assert.equal(entityType, "Lead");
  assert.equal(id, "l1");
  assert.deepEqual(body, { status: "Assigned" });
});

test("the delete handler removes the record and echoes the id", async () => {
  const { context, calls } = createContext({});
  const remove = byName(await entityWriteTools("Lead", context), "delete_lead");
  const result = await remove.handler({ id: "l1" });
  assert.deepEqual(parse(result), { deleted: true, id: "l1" });
  const [entityType, id] = calls.at(-1)!.args as [string, string];
  assert.equal(entityType, "Lead");
  assert.equal(id, "l1");
});
