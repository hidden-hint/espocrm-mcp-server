import { test } from "node:test"
import assert from "node:assert/strict"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { EspoApiError } from "../../src/errors.js"
import { errorResult, guard, jsonResult } from "../../src/tools/result.js"

function textOf(result: CallToolResult): string {
  const first: CallToolResult["content"][number] | undefined = result.content[0]
  assert.equal(first?.type, "text")

  return (first as { text: string }).text
}

test("jsonResult pretty-prints data as a text content block", (): void => {
  const result: CallToolResult = jsonResult({ total: 1, list: [{ id: "a" }] })
  assert.equal(result.isError, undefined)
  assert.deepEqual(JSON.parse(textOf(result)), { total: 1, list: [{ id: "a" }] })
  assert.ok(textOf(result).includes("\n"))
})

test("errorResult marks the result as an error", (): void => {
  const result: CallToolResult = errorResult("boom")
  assert.equal(result.isError, true)
  assert.equal(textOf(result), "boom")
})

test("guard passes a successful handler result straight through", async (): Promise<void> => {
  const handler: (args: unknown) => Promise<CallToolResult> = guard(async (): Promise<CallToolResult> =>
    jsonResult({ ok: true }),
  )
  const result: CallToolResult = await handler({})
  assert.equal(result.isError, undefined)
  assert.deepEqual(JSON.parse(textOf(result)), { ok: true })
})

test("guard converts an EspoApiError into a tool error with a truncated body", async (): Promise<void> => {
  const longBody: string = "x".repeat(600)
  const handler: (args: unknown) => Promise<CallToolResult> = guard(async (): Promise<never> => {
    throw new EspoApiError(403, longBody)
  })
  const result: CallToolResult = await handler({})
  assert.equal(result.isError, true)
  assert.ok(textOf(result).startsWith("EspoCRM API error 403: "))
  assert.ok(textOf(result).endsWith("…"))
  assert.ok(textOf(result).length < 600)
})

test("guard converts a generic Error into a tool error with its message", async (): Promise<void> => {
  const handler: (args: unknown) => Promise<CallToolResult> = guard(async (): Promise<never> => {
    throw new Error("something broke")
  })
  const result: CallToolResult = await handler({})
  assert.equal(result.isError, true)
  assert.equal(textOf(result), "something broke")
})

test("guard stringifies a non-Error thrown value", async (): Promise<void> => {
  const handler: (args: unknown) => Promise<CallToolResult> = guard(async (): Promise<never> => {
    throw "raw string failure"
  })
  const result: CallToolResult = await handler({})
  assert.equal(result.isError, true)
  assert.equal(textOf(result), "raw string failure")
})
