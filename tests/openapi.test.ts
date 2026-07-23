import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOpenApiDocument } from "../src/openapi.js";
import { createContext, makeConfig } from "./testing/fixtures.js";

test("buildOpenApiDocument produces a 3.1 document with security schemes and server URL", async () => {
  const { context } = createContext({});
  const doc = (await buildOpenApiDocument(context, makeConfig({ entityTypes: ["Lead"] }))) as any;
  assert.equal(doc.openapi, "3.1.0");
  assert.deepEqual(doc.servers, [{ url: "https://crm.example.test/api/v1" }]);
  assert.ok(doc.components.securitySchemes.ApiKey);
  assert.ok(doc.components.securitySchemes.EspoAuthorization);
});

test("buildOpenApiDocument types entity schemas from live metadata plus StreamNote", async () => {
  const { context } = createContext({});
  const doc = (await buildOpenApiDocument(context, makeConfig({ entityTypes: ["Lead"] }))) as any;
  assert.ok(doc.components.schemas.StreamNote);
  assert.ok(doc.components.schemas.Lead);
  assert.deepEqual(doc.components.schemas.Lead.required, ["status"]);
});

test("buildOpenApiDocument emits search, item, and stream paths per entity", async () => {
  const { context } = createContext({});
  const doc = (await buildOpenApiDocument(context, makeConfig({ entityTypes: ["Lead"] }))) as any;
  assert.ok(doc.paths["/Lead"].get);
  assert.ok(doc.paths["/Lead/{id}"].get);
  assert.ok(doc.paths["/Lead/{id}/stream"].get);
});

test("buildOpenApiDocument omits write operations in read-only mode", async () => {
  const { context } = createContext({});
  const doc = (await buildOpenApiDocument(context, makeConfig({ entityTypes: ["Lead"], readOnly: true }))) as any;
  assert.equal(doc.paths["/Lead"].post, undefined);
  assert.equal(doc.paths["/Lead/{id}"].patch, undefined);
  assert.equal(doc.paths["/Lead/{id}"].delete, undefined);
});

test("buildOpenApiDocument includes write operations when writes are enabled", async () => {
  const { context } = createContext({});
  const doc = (await buildOpenApiDocument(context, makeConfig({ entityTypes: ["Lead"], readOnly: false }))) as any;
  assert.ok(doc.paths["/Lead"].post);
  assert.ok(doc.paths["/Lead/{id}"].patch);
  assert.ok(doc.paths["/Lead/{id}"].delete);
});

test("buildOpenApiDocument skips an unknown entity type", async () => {
  const { context } = createContext({});
  const doc = (await buildOpenApiDocument(context, makeConfig({ entityTypes: ["Lead", "Ghost"] }))) as any;
  assert.ok(doc.paths["/Lead"]);
  assert.equal(doc.paths["/Ghost"], undefined);
  assert.equal(doc.components.schemas.Ghost, undefined);
});
