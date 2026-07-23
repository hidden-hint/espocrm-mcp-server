// All logging goes to stderr — stdout is reserved for the MCP stdio transport.
export function log(...parts: unknown[]): void {
  console.error("[espocrm-mcp]", ...parts);
}
