import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";
import type { Config } from "../config.js";
import { contextFromRequest } from "../context.js";
import { AuthError, ConfigError } from "../errors.js";
import { log } from "../logger.js";
import { buildOpenApiDocument } from "../openapi.js";
import { buildServer } from "../server.js";

function jsonRpcError(code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}

function respondError(response: Response, error: unknown): void {
  if (error instanceof AuthError) {
    response.status(401).json(jsonRpcError(-32001, error.message));

    return;
  }
  if (error instanceof ConfigError) {
    response.status(500).json(jsonRpcError(-32002, error.message));

    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  log("request failed:", message);
  response.status(500).json(jsonRpcError(-32603, "Internal server error"));
}

// Stateless: a fresh server + transport per request, bound to that caller's credential.
async function handleMcpRequest(request: Request, response: Response, config: Config): Promise<void> {
  const server = await buildServer(contextFromRequest(request.headers, config), config);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  response.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(request, response, request.body);
}

async function handleOpenApiRequest(request: Request, response: Response, config: Config): Promise<void> {
  const document = await buildOpenApiDocument(contextFromRequest(request.headers, config), config);
  response.json(document);
}

export function createApp(config: Config): express.Express {
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  app.post(config.httpPath, (request, response) => {
    handleMcpRequest(request, response, config).catch((error: unknown) => respondError(response, error));
  });

  const methodNotAllowed = (_request: Request, response: Response): void => {
    response.status(405).json(jsonRpcError(-32000, "Method not allowed. This server is stateless; use POST."));
  };
  app.get(config.httpPath, methodNotAllowed);
  app.delete(config.httpPath, methodNotAllowed);

  app.get("/openapi.json", (request, response) => {
    handleOpenApiRequest(request, response, config).catch((error: unknown) => respondError(response, error));
  });

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  return app;
}

export async function runHttp(config: Config): Promise<void> {
  const app = createApp(config);

  await new Promise<void>((resolve) => {
    app.listen(config.httpPort, () => {
      log(`listening on http://0.0.0.0:${config.httpPort}${config.httpPath} → ${config.baseUrl} (${config.authMode})`);
      log(`OpenAPI at http://0.0.0.0:${config.httpPort}/openapi.json`);
      resolve();
    });
  });
}
