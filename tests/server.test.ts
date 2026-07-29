import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";
import { createContext, makeConfig } from "./testing/fixtures.js";

async function connectClient(overrides: Parameters<typeof makeConfig>[0], responses: Parameters<typeof createContext>[0]) {
  const { context, calls } = createContext(responses);
  const server = await buildServer(context, makeConfig(overrides));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);

  return { client, calls, close: () => Promise.all([client.close(), server.close()]) };
}

test("buildServer registers the read-only tool set over MCP", async () => {
  const { client, close } = await connectClient({ entityTypes: ["Lead"], readOnly: true }, {});
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.ok(names.includes("search_lead"));
    assert.ok(names.includes("get_lead"));
    assert.ok(!names.includes("create_lead"));
  } finally {
    await close();
  }
});

test("buildServer registers write tools when writes are enabled", async () => {
  const { client, close } = await connectClient({ entityTypes: ["Lead"], readOnly: false }, {});
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.ok(names.includes("create_lead"));
    assert.ok(names.includes("delete_lead"));
    assert.ok(names.includes("post_to_stream"));
  } finally {
    await close();
  }
});

test("a tool schema offers the stored enum values and documents their UI labels", async () => {
  const { client, close } = await connectClient({ entityTypes: ["Lead"], readOnly: false }, {});
  try {
    const update = (await client.listTools()).tools.find((tool) => tool.name === "update_lead")!;
    const status = (update.inputSchema.properties as Record<string, { enum: string[]; description: string }>).status!;
    assert.deepEqual(status.enum, ["New", "Assigned", "Dead"]);
    assert.match(status.description, /"In Talks" = Assigned/);
  } finally {
    await close();
  }
});

test("a tool call naming an option by its UI label writes the stored value", async () => {
  const { client, calls, close } = await connectClient({ entityTypes: ["Lead"], readOnly: false }, {});
  try {
    await client.callTool({ name: "update_lead", arguments: { id: "l1", status: "In Talks" } });
    const [, , body] = calls.at(-1)!.args as [string, string, Record<string, unknown>];
    assert.deepEqual(body, { status: "Assigned" });
  } finally {
    await close();
  }
});

test("a search filtering by a UI label queries the stored value", async () => {
  const { client, calls, close } = await connectClient({ entityTypes: ["Lead"], readOnly: true }, {});
  try {
    await client.callTool({ name: "search_lead", arguments: { status: "In Talks" } });
    const params = (calls.at(-1)!.args as [string, Record<string, unknown>])[1];
    assert.deepEqual(params.where, [{ type: "equals", attribute: "status", value: "Assigned" }]);
  } finally {
    await close();
  }
});

test("a registered tool executes end-to-end through the MCP transport", async () => {
  const { client, calls, close } = await connectClient(
    { entityTypes: ["Lead"], readOnly: true },
    { find: { total: 1, list: [{ id: "l1" }] } },
  );
  try {
    const result = (await client.callTool({ name: "search_lead", arguments: { status: "New" } })) as {
      content: { text: string }[];
    };
    assert.deepEqual(JSON.parse(result.content[0]!.text), { total: 1, list: [{ id: "l1" }] });
    assert.equal((calls.at(-1)!.args as [string, unknown])[0], "Lead");
  } finally {
    await close();
  }
});
