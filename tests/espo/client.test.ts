import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EspoApiError } from "../../src/errors.js";
import { EspoClient } from "../../src/espo/client.js";

const realFetch = globalThis.fetch;

interface CapturedRequest {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function stubFetch(response: { ok: boolean; status: number; body: string }): { calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  globalThis.fetch = ((url: URL, init: { method: string; headers: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });

    return Promise.resolve({
      ok: response.ok,
      status: response.status,
      text: () => Promise.resolve(response.body),
    });
  }) as unknown as typeof fetch;

  return { calls };
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

const CRED = { kind: "apiKey", apiKey: "secret" } as const;

test("the constructor strips trailing slashes from the base URL", () => {
  assert.equal(new EspoClient("https://crm.example.test///", CRED).baseUrl, "https://crm.example.test");
});

test("find issues a GET to /api/v1/<entity> with serialized query params", async () => {
  const { calls } = stubFetch({ ok: true, status: 200, body: JSON.stringify({ total: 2, list: [] }) });
  const result = await new EspoClient("https://crm.example.test", CRED).find("Lead", { maxSize: 20 });
  assert.deepEqual(result, { total: 2, list: [] });
  const call = calls[0]!;
  assert.equal(call.method, "GET");
  assert.equal(call.url.pathname, "/api/v1/Lead");
  assert.equal(call.url.searchParams.get("maxSize"), "20");
});

test("requests carry Accept, Content-Type, and the credential header", async () => {
  const { calls } = stubFetch({ ok: true, status: 200, body: "{}" });
  await new EspoClient("https://crm.example.test", CRED).find("Lead", {});
  assert.equal(calls[0]!.headers.Accept, "application/json");
  assert.equal(calls[0]!.headers["Content-Type"], "application/json");
  assert.equal(calls[0]!.headers["X-Api-Key"], "secret");
});

test("getRecord encodes the entity type and id into the path", async () => {
  const { calls } = stubFetch({ ok: true, status: 200, body: "{}" });
  await new EspoClient("https://crm.example.test", CRED).getRecord("C Opportunity", "id/1", {});
  assert.equal(calls[0]!.url.pathname, "/api/v1/C%20Opportunity/id%2F1");
});

test("getStream targets the /stream sub-resource", async () => {
  const { calls } = stubFetch({ ok: true, status: 200, body: JSON.stringify({ total: 0, list: [] }) });
  await new EspoClient("https://crm.example.test", CRED).getStream("Lead", "abc", {});
  assert.equal(calls[0]!.url.pathname, "/api/v1/Lead/abc/stream");
});

test("getMetadata issues a GET to /api/v1/Metadata", async () => {
  const { calls } = stubFetch({ ok: true, status: 200, body: "{}" });
  await new EspoClient("https://crm.example.test", CRED).getMetadata();
  assert.equal(calls[0]!.method, "GET");
  assert.equal(calls[0]!.url.pathname, "/api/v1/Metadata");
});

test("getAppUser issues a GET to /api/v1/App/user carrying the credential", async () => {
  const { calls } = stubFetch({ ok: true, status: 200, body: JSON.stringify({ token: "auth-token" }) });
  const result = await new EspoClient("https://crm.example.test", {
    kind: "espoAuthorization",
    value: "dXNlcjpwYXNz",
  }).getAppUser();
  assert.deepEqual(result, { token: "auth-token" });
  assert.equal(calls[0]!.method, "GET");
  assert.equal(calls[0]!.url.pathname, "/api/v1/App/user");
  assert.equal(calls[0]!.headers["Espo-Authorization"], "dXNlcjpwYXNz");
});

test("create issues a POST with a JSON body", async () => {
  const { calls } = stubFetch({ ok: true, status: 200, body: JSON.stringify({ id: "new" }) });
  const result = await new EspoClient("https://crm.example.test", CRED).create("Lead", { name: "Ann" });
  assert.deepEqual(result, { id: "new" });
  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.body, JSON.stringify({ name: "Ann" }));
});

test("update issues a PATCH to the item path", async () => {
  const { calls } = stubFetch({ ok: true, status: 200, body: "{}" });
  await new EspoClient("https://crm.example.test", CRED).update("Lead", "abc", { name: "Bob" });
  assert.equal(calls[0]!.method, "PATCH");
  assert.equal(calls[0]!.url.pathname, "/api/v1/Lead/abc");
  assert.equal(calls[0]!.body, JSON.stringify({ name: "Bob" }));
});

test("deleteRecord issues a DELETE with no body and returns null on an empty response", async () => {
  const { calls } = stubFetch({ ok: true, status: 200, body: "" });
  const result = await new EspoClient("https://crm.example.test", CRED).deleteRecord("Lead", "abc");
  assert.equal(result, null);
  assert.equal(calls[0]!.method, "DELETE");
  assert.equal(calls[0]!.body, undefined);
});

test("a non-ok response throws EspoApiError carrying the status and body", async () => {
  stubFetch({ ok: false, status: 403, body: "Forbidden" });
  await assert.rejects(new EspoClient("https://crm.example.test", CRED).find("Lead", {}), (error: unknown) => {
    assert.ok(error instanceof EspoApiError);
    assert.equal(error.status, 403);
    assert.equal(error.body, "Forbidden");

    return true;
  });
});

test("an espoAuthorization credential is sent as the Espo-Authorization header", async () => {
  const { calls } = stubFetch({ ok: true, status: 200, body: "{}" });
  await new EspoClient("https://crm.example.test", { kind: "espoAuthorization", value: "token" }).find("Lead", {});
  assert.equal(calls[0]!.headers["Espo-Authorization"], "token");
});
