import { test } from "node:test";
import assert from "node:assert/strict";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { InMemoryClientStore } from "../../src/oauth/clientStore.js";

function fullClient(clientId: string): OAuthClientInformationFull {
  return {
    client_id: clientId,
    client_id_issued_at: 1_700_000_000,
    redirect_uris: ["https://client.example/callback"],
    token_endpoint_auth_method: "none",
  };
}

test("registerClient stores a client that getClient then returns", () => {
  const store = new InMemoryClientStore();
  const registered = store.registerClient(fullClient("client-1"));
  assert.equal(registered.client_id, "client-1");
  assert.deepEqual(store.getClient("client-1"), fullClient("client-1"));
});

test("getClient returns undefined for an unknown client id", () => {
  assert.equal(new InMemoryClientStore().getClient("nope"), undefined);
});
