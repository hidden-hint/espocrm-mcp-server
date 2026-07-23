import { test } from "node:test";
import assert from "node:assert/strict";
import { collectTools } from "../../src/tools/registry.js";
import { createContext, makeConfig } from "../testing/fixtures.js";

async function toolNames(overrides: Parameters<typeof makeConfig>[0]): Promise<string[]> {
  const { context } = createContext({});
  const tools = await collectTools(context, makeConfig(overrides));

  return tools.map((tool) => tool.name);
}

test("collectTools always includes the generic cross-cutting tools", async () => {
  const names = await toolNames({ entityTypes: ["Lead"], readOnly: true });
  assert.ok(names.includes("list_entity_types"));
  assert.ok(names.includes("describe_entity"));
  assert.ok(names.includes("get_stream"));
});

test("collectTools in read-only mode exposes only search and get per entity", async () => {
  const names = await toolNames({ entityTypes: ["Lead"], readOnly: true });
  assert.ok(names.includes("search_lead"));
  assert.ok(names.includes("get_lead"));
  assert.ok(!names.includes("create_lead"));
  assert.ok(!names.includes("post_to_stream"));
});

test("collectTools in write mode adds post_to_stream and per-entity write tools", async () => {
  const names = await toolNames({ entityTypes: ["Lead"], readOnly: false });
  assert.ok(names.includes("post_to_stream"));
  assert.ok(names.includes("create_lead"));
  assert.ok(names.includes("update_lead"));
  assert.ok(names.includes("delete_lead"));
});

test("collectTools skips an unknown entity type without failing", async () => {
  const names = await toolNames({ entityTypes: ["Lead", "Ghost"], readOnly: false });
  assert.ok(names.includes("search_lead"));
  assert.ok(names.includes("create_lead"));
  assert.ok(!names.some((name) => name.includes("ghost")));
});
