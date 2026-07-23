import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { getOAuthProtectedResourceMetadataUrl, mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type RequestHandler, type Response } from "express";
import type { Config } from "../config.js";
import { contextFromConfig, contextFromCredential } from "../context.js";
import { AuthError, ConfigError } from "../errors.js";
import type { EspoCredential } from "../espo/credential.js";
import { log } from "../logger.js";
import { buildOpenApiDocument } from "../openapi.js";
import { createLoginHandler } from "../oauth/login.js";
import { OAUTH_LOGIN_PATH } from "../oauth/loginPage.js";
import { createOauthProvider, resourceServerUrl } from "../oauth/provider.js";
import { buildServer } from "../server.js";
import type { ToolContext } from "../tools/types.js";

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

// Stateless: a fresh server + transport per request, bound to that caller's context.
async function handleMcpRequest(context: ToolContext, config: Config, request: Request, response: Response): Promise<void> {
  const server = await buildServer(context, config);
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

async function handleOpenApiRequest(context: ToolContext, config: Config, response: Response): Promise<void> {
  response.json(await buildOpenApiDocument(context, config));
}

function credentialFromAuth(request: Request): EspoCredential {
  return request.auth?.extra?.espoCredential as EspoCredential;
}

function registerApiKeyRoutes(app: express.Express, config: Config): void {
  app.post(config.httpPath, (request, response) => {
    handleMcpRequest(contextFromConfig(config), config, request, response).catch((error: unknown) =>
      respondError(response, error),
    );
  });

  app.get("/openapi.json", (request, response) => {
    handleOpenApiRequest(contextFromConfig(config), config, response).catch((error: unknown) =>
      respondError(response, error),
    );
  });
}

function registerOauthRoutes(app: express.Express, config: Config): void {
  const provider = createOauthProvider(config);
  const resourceUrl = resourceServerUrl(config);
  const bearer: RequestHandler = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceUrl),
  });

  app.use(mcpAuthRouter({ provider, issuerUrl: new URL(config.oauthIssuerUrl as string), resourceServerUrl: resourceUrl }));
  app.post(OAUTH_LOGIN_PATH, express.urlencoded({ extended: false }), createLoginHandler(provider, config));

  app.post(config.httpPath, bearer, (request, response) => {
    handleMcpRequest(contextFromCredential(credentialFromAuth(request), config), config, request, response).catch(
      (error: unknown) => respondError(response, error),
    );
  });

  app.get("/openapi.json", bearer, (request, response) => {
    handleOpenApiRequest(contextFromCredential(credentialFromAuth(request), config), config, response).catch(
      (error: unknown) => respondError(response, error),
    );
  });
}

export function createApp(config: Config): express.Express {
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  if (config.authMode === "oauth") {
    registerOauthRoutes(app, config);
  } else {
    registerApiKeyRoutes(app, config);
  }

  const methodNotAllowed = (_request: Request, response: Response): void => {
    response.status(405).json(jsonRpcError(-32000, "Method not allowed. This server is stateless; use POST."));
  };
  app.get(config.httpPath, methodNotAllowed);
  app.delete(config.httpPath, methodNotAllowed);

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
      if (config.authMode === "oauth") {
        log(`OAuth issuer ${config.oauthIssuerUrl}; protected resource ${resourceServerUrl(config).href}`);
      }
      log(`OpenAPI at http://0.0.0.0:${config.httpPort}/openapi.json`);
      resolve();
    });
  });
}
