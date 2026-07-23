import { test } from "node:test";
import assert from "node:assert/strict";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { entityTools, toolSlug } from "../../src/tools/entityTools.js";
import type { ToolDef } from "../../src/tools/types.js";
import { createContext } from "../testing/fixtures.js";

function parse(result: CallToolResult): unknown {
  return JSON.parse((result.content[0] as { text: string }).text);
}

function byName(tools: ToolDef[], name: string): ToolDef {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `expected a tool named ${name}`);

  return tool;
}

test("toolSlug converts single-word and multi-word PascalCase to snake_case", () => {
  assert.equal(toolSlug("Lead"), "lead");
  assert.equal(toolSlug("Account"), "account");
  assert.equal(toolSlug("CustomEntity"), "custom_entity");
  assert.equal(toolSlug("Case"), "case");
});

test("toolSlug splits a leading custom-entity capital from the following word", () => {
  assert.equal(toolSlug("COpportunity"), "c_opportunity");
  assert.equal(toolSlug("CDeal"), "c_deal");
});

test("toolSlug splits an acronym run from the following word", () => {
  assert.equal(toolSlug("APIKey"), "api_key");
  assert.equal(toolSlug("HTTPServer"), "http_server");
  assert.equal(toolSlug("SalesOrder"), "sales_order");
});

test("toolSlug replaces non-alphanumeric runs with a single underscore", () => {
  assert.equal(toolSlug("Some Entity-Name"), "some_entity_name");
});

test("entityTools produces search and get tools named from the slug", async () => {
  const { context } = createContext({});
  const tools = await entityTools("Lead", context);
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ["get_lead", "search_lead"]);
});

test("the search tool exposes typed filters plus the raw where escape hatch", async () => {
  const { context } = createContext({});
  const search = byName(await entityTools("Lead", context), "search_lead");
  const keys = Object.keys(search.inputSchema);
  assert.ok(keys.includes("status"));
  assert.ok(keys.includes("where"));
  assert.ok(keys.includes("textFilter"));
  assert.ok(keys.includes("maxSize"));
});

test("the search handler defaults maxSize to 20 and forwards the query", async () => {
  const { context, calls } = createContext({ find: { total: 3, list: [{ id: "l1" }] } });
  const search = byName(await entityTools("Lead", context), "search_lead");
  const result = await search.handler({});
  assert.deepEqual(parse(result), { total: 3, list: [{ id: "l1" }] });
  const [entityType, params] = calls.at(-1)!.args as [string, Record<string, unknown>];
  assert.equal(entityType, "Lead");
  assert.equal(params.maxSize, 20);
});

test("the search handler translates typed filters and ANDs raw where conditions", async () => {
  const { context, calls } = createContext({});
  const search = byName(await entityTools("Lead", context), "search_lead");
  await search.handler({ status: "New", where: [{ type: "isNull", attribute: "assignedUserId" }] });
  const params = (calls.at(-1)!.args as [string, Record<string, unknown>])[1];
  assert.deepEqual(params.where, [
    { type: "equals", attribute: "status", value: "New" },
    { type: "isNull", attribute: "assignedUserId" },
  ]);
});

test("the search handler joins a select array into a comma-separated string", async () => {
  const { context, calls } = createContext({});
  const search = byName(await entityTools("Lead", context), "search_lead");
  await search.handler({ select: ["id", "name"] });
  const params = (calls.at(-1)!.args as [string, Record<string, unknown>])[1];
  assert.equal(params.select, "id,name");
});

test("the get handler fetches a record by id and joins the select fields", async () => {
  const { context, calls } = createContext({ getRecord: { id: "l1", name: "Ann" } });
  const get = byName(await entityTools("Lead", context), "get_lead");
  const result = await get.handler({ id: "l1", select: ["id", "name"] });
  assert.deepEqual(parse(result), { id: "l1", name: "Ann" });
  const [entityType, id, params] = calls.at(-1)!.args as [string, string, Record<string, unknown>];
  assert.equal(entityType, "Lead");
  assert.equal(id, "l1");
  assert.equal(params.select, "id,name");
});
