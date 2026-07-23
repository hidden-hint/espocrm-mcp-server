import type { Request, RequestHandler, Response } from "express";
import type { Config } from "../config.js";
import { EspoApiError } from "../errors.js";
import { log } from "../logger.js";
import { authenticateEspoUser } from "./espoLogin.js";
import { renderLoginPage } from "./loginPage.js";
import type { EspoOAuthServerProvider } from "./provider.js";

function field(request: Request, name: string): string {
  const value = (request.body as Record<string, unknown> | undefined)?.[name];

  return typeof value === "string" ? value : "";
}

async function handleLogin(
  provider: EspoOAuthServerProvider,
  config: Config,
  request: Request,
  response: Response,
): Promise<void> {
  const requestToken = field(request, "request");
  const username = field(request, "username");
  const password = field(request, "password");

  const authRequest = provider.unsealAuthRequest(requestToken);

  try {
    await authenticateEspoUser(config.baseUrl, username, password);
  } catch (error) {
    if (error instanceof EspoApiError) {
      response
        .status(401)
        .type("html")
        .send(renderLoginPage({ requestToken, error: "Invalid EspoCRM username or password." }));

      return;
    }

    throw error;
  }

  const location = new URL(authRequest.redirectUri);
  location.searchParams.set("code", provider.issueAuthorizationCode(authRequest, username, password));
  if (authRequest.state !== undefined) {
    location.searchParams.set("state", authRequest.state);
  }

  response.redirect(location.href);
}

export function createLoginHandler(provider: EspoOAuthServerProvider, config: Config): RequestHandler {
  return (request, response) => {
    handleLogin(provider, config, request, response).catch((error: unknown) => {
      log("oauth login failed:", error instanceof Error ? error.message : String(error));
      if (!response.headersSent) {
        response.status(400).type("html").send("Login request could not be processed. Restart the sign-in flow.");
      }
    });
  };
}
