import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

export class InMemoryClientStore implements OAuthRegisteredClientsStore {
  private readonly memoizedClients = new Map<string, OAuthClientInformationFull>();

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    return this.memoizedClients.get(clientId);
  }

  registerClient(client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">): OAuthClientInformationFull {
    const full = client as OAuthClientInformationFull;
    this.memoizedClients.set(full.client_id, full);

    return full;
  }
}
