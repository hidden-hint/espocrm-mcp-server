import { test } from "node:test";
import assert from "node:assert/strict";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { EspoApiError } from "../../src/errors.js";
import { errorResult, guard, jsonResult } from "../../src/tools/result.js";

function textOf(result: CallToolResult): string {
  const first = result.content[0];
  assert.equal(first?.type, "text");

  return (first as { text: string }).text;
}

test("jsonResult pretty-prints data as a text content block", () => {
  const result = jsonResult({ total: 1, list: [{ id: "a" }] });
  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(textOf(result)), { total: 1, list: [{ id: "a" }] });
  assert.ok(textOf(result).includes("\n"));
});

test("errorResult marks the result as an error", () => {
  const result = errorResult("boom");
  assert.equal(result.isError, true);
  assert.equal(textOf(result), "boom");
});

test("guard passes a successful handler result straight through", async () => {
  const handler = guard(async () => jsonResult({ ok: true }));
  const result = await handler({});
  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(textOf(result)), { ok: true });
});

test("guard converts an EspoApiError into a tool error with a truncated body", async () => {
  const longBody = "x".repeat(600);
  const handler = guard(async () => {
    throw new EspoApiError(403, longBody);
  });
  const result = await handler({});
  assert.equal(result.isError, true);
  assert.ok(textOf(result).startsWith("EspoCRM API error 403: "));
  assert.ok(textOf(result).endsWith("…"));
  assert.ok(textOf(result).length < 600);
});

test("guard converts a generic Error into a tool error with its message", async () => {
  const handler = guard(async () => {
    throw new Error("something broke");
  });
  const result = await handler({});
  assert.equal(result.isError, true);
  assert.equal(textOf(result), "something broke");
});

test("guard stringifies a non-Error thrown value", async () => {
  const handler = guard(async () => {
    throw "raw string failure";
  });
  const result = await handler({});
  assert.equal(result.isError, true);
  assert.equal(textOf(result), "raw string failure");
});
