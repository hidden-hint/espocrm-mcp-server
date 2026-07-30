import { test } from "node:test"
import assert from "node:assert/strict"
import { buildOpenApiDocument } from "../src/openapi.js"
import { createContext, makeConfig } from "./testing/fixtures.js"

test("buildOpenApiDocument produces a 3.1 document with security schemes and server URL", async (): Promise<void> => {
  const { context } = createContext({})
  const doc = (await buildOpenApiDocument(context, makeConfig({ entityTypes: ["Lead"] }))) as any
  assert.equal(doc.openapi, "3.1.0")
  assert.deepEqual(doc.servers, [{ url: "https://crm.example.test/api/v1" }])
  assert.ok(doc.components.securitySchemes.ApiKey)
  assert.ok(doc.components.securitySchemes.EspoAuthorization)
})

test("buildOpenApiDocument types entity schemas from live metadata plus StreamNote", async (): Promise<void> => {
  const { context } = createContext({})
  const doc = (await buildOpenApiDocument(context, makeConfig({ entityTypes: ["Lead"] }))) as any
  assert.ok(doc.components.schemas.StreamNote)
  assert.ok(doc.components.schemas.Lead)
  assert.deepEqual(doc.components.schemas.Lead.required, ["status"])
})

test("buildOpenApiDocument documents renamed option labels on both the record and the write body", async (): Promise<void> => {
  const { context } = createContext({})
  const doc = (await buildOpenApiDocument(context, makeConfig({ entityTypes: ["Lead"], readOnly: false }))) as any
  assert.deepEqual(doc.components.schemas.Lead.properties.status, {
    type: "string",
    enum: ["New", "Assigned", "Dead"],
    description: 'UI labels: "Backlog" = New, "In Talks" = Assigned.',
  })
  const body = doc.paths["/Lead"].post.requestBody.content["application/json"].schema
  assert.match(body.properties.status.description, /"In Talks" = Assigned\. Either form is accepted\./)
})

test("buildOpenApiDocument emits search, item, and stream paths per entity", async (): Promise<void> => {
  const { context } = createContext({})
  const doc = (await buildOpenApiDocument(context, makeConfig({ entityTypes: ["Lead"] }))) as any
  assert.ok(doc.paths["/Lead"].get)
  assert.ok(doc.paths["/Lead/{id}"].get)
  assert.ok(doc.paths["/Lead/{id}/stream"].get)
})

test("buildOpenApiDocument omits write operations in read-only mode", async (): Promise<void> => {
  const { context } = createContext({})
  const doc = (await buildOpenApiDocument(context, makeConfig({ entityTypes: ["Lead"], readOnly: true }))) as any
  assert.equal(doc.paths["/Lead"].post, undefined)
  assert.equal(doc.paths["/Lead/{id}"].patch, undefined)
  assert.equal(doc.paths["/Lead/{id}"].delete, undefined)
})

test("buildOpenApiDocument includes write operations when writes are enabled", async (): Promise<void> => {
  const { context } = createContext({})
  const doc = (await buildOpenApiDocument(context, makeConfig({ entityTypes: ["Lead"], readOnly: false }))) as any
  assert.ok(doc.paths["/Lead"].post)
  assert.ok(doc.paths["/Lead/{id}"].patch)
  assert.ok(doc.paths["/Lead/{id}"].delete)
})

test("buildOpenApiDocument skips an unknown entity type", async (): Promise<void> => {
  const { context } = createContext({})
  const doc = (await buildOpenApiDocument(context, makeConfig({ entityTypes: ["Lead", "Ghost"] }))) as any
  assert.ok(doc.paths["/Lead"])
  assert.equal(doc.paths["/Ghost"], undefined)
  assert.equal(doc.components.schemas.Ghost, undefined)
})
