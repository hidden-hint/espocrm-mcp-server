import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { EspoApiError } from "../errors.js";
import { truncate } from "../util.js";

export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

// Wraps a tool handler so EspoCRM/API failures become MCP tool errors
// instead of crashing the request.
export function guard<A>(handler: (args: A) => Promise<CallToolResult>): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    try {
      return await handler(args);
    } catch (error) {
      if (error instanceof EspoApiError) {
        return errorResult(`EspoCRM API error ${error.status}: ${truncate(error.body, 500)}`);
      }

      return errorResult(error instanceof Error ? error.message : String(error));
    }
  };
}
