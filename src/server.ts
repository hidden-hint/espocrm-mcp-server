import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./config.js";
import { collectTools } from "./tools/registry.js";
import type { ToolContext } from "./tools/types.js";
import { SERVER_NAME, VERSION } from "./version.js";

// Builds a server instance bound to one request context. In http mode this is
// called per request so each server's tools carry that caller's credential, and
// its per-entity tool schemas reflect that instance's metadata.
export async function buildServer(context: ToolContext, config: Config): Promise<McpServer> {
  const server = new McpServer(
    { name: SERVER_NAME, version: VERSION },
    { capabilities: { tools: {} } },
  );

  for (const tool of await collectTools(context, config)) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
      tool.handler,
    );
  }

  return server;
}
