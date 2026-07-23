#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { contextFromConfig } from "./context.js";
import { log } from "./logger.js";
import { buildOpenApiDocument } from "./openapi.js";
import { runHttp } from "./transport/http.js";
import { runStdio } from "./transport/stdio.js";
import { SERVER_NAME, VERSION } from "./version.js";

async function printOpenApi(): Promise<void> {
  const config = loadConfig(process.env);
  const document = await buildOpenApiDocument(contextFromConfig(config), config);
  process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
}

async function run(): Promise<void> {
  const config = loadConfig(process.env);

  if (config.transport === "stdio") {
    await runStdio(config);
    log(`${SERVER_NAME} ${VERSION} started (stdio) → ${config.baseUrl}`);

    return;
  }

  await runHttp(config);
}

async function main(): Promise<void> {
  if (process.argv.includes("--print-openapi")) {
    await printOpenApi();

    return;
  }

  await run();
}

main().catch((error: unknown) => {
  log("fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
