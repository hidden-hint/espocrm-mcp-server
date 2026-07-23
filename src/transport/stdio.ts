import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Config } from "../config.js";
import { contextFromConfig } from "../context.js";
import { buildServer } from "../server.js";

export async function runStdio(config: Config): Promise<void> {
  const server = await buildServer(contextFromConfig(config), config);

  await server.connect(new StdioServerTransport());
}
