import { test } from "node:test"
import assert from "node:assert/strict"
import { EspoApiError } from "../../src/errors.js"
import type { EspoClient } from "../../src/espo/client.js"
import { LabelService } from "../../src/espo/labels.js"
import { MetadataService } from "../../src/espo/metadata.js"
import { createFakeClient, SAMPLE_I18N, SAMPLE_METADATA, uniqueBaseUrl } from "../testing/fixtures.js"
import type { EntityDescription } from "../../src/espo/metadata.js"
import type { FakeClient } from "../testing/fixtures.js"

function metadataService(client: EspoClient, ttlSeconds: number): MetadataService {
  return new MetadataService(client, ttlSeconds, new LabelService(client, ttlSeconds))
}

function metadataCalls(calls: { method: string }[]): number {
  return calls.filter((call: { method: string }): boolean => call.method === "getMetadata").length
}

test("listEntityTypes returns only entity scopes, sorted, with the custom flag", async (): Promise<void> => {
  const { client } = createFakeClient(uniqueBaseUrl(), { metadata: SAMPLE_METADATA })
  const service: MetadataService = metadataService(client, 300)
  assert.deepEqual(await service.listEntityTypes(), [
    { entityType: "CDeal", custom: true },
    { entityType: "Contact", custom: false },
    { entityType: "Lead", custom: false },
  ])
})

test("describeEntity prunes fields to type, required, and options", async (): Promise<void> => {
  const { client } = createFakeClient(uniqueBaseUrl(), { metadata: SAMPLE_METADATA })
  const description: EntityDescription = await metadataService(client, 300).describeEntity("Lead")
  assert.deepEqual(description.fields.status, { type: "enum", required: true, options: ["New", "Assigned", "Dead"] })
  assert.deepEqual(description.fields.name, { type: "varchar" })
  assert.ok(!("required" in description.fields.name!))
})

test("describeEntity attaches the UI labels of options renamed in the Label Manager", async (): Promise<void> => {
  const { client } = createFakeClient(uniqueBaseUrl(), { metadata: SAMPLE_METADATA, i18n: SAMPLE_I18N })
  const description: EntityDescription = await metadataService(client, 300).describeEntity("Lead")
  assert.deepEqual(description.fields.status, {
    type: "enum",
    required: true,
    options: ["New", "Assigned", "Dead"],
    optionLabels: { New: "Backlog", Assigned: "In Talks" },
  })
  assert.ok(!("optionLabels" in description.fields.name!))
})

test("describeEntity omits optionLabels for a field whose options are not translated", async (): Promise<void> => {
  const { client } = createFakeClient(uniqueBaseUrl(), { metadata: SAMPLE_METADATA, i18n: SAMPLE_I18N })
  const description: EntityDescription = await metadataService(client, 300).describeEntity("Lead")
  assert.ok(!("optionLabels" in description.fields.source!))
})

test("describeEntity prunes links to type, entity, and foreign", async (): Promise<void> => {
  const { client } = createFakeClient(uniqueBaseUrl(), { metadata: SAMPLE_METADATA })
  const description: EntityDescription = await metadataService(client, 300).describeEntity("Lead")
  assert.deepEqual(description.links.assignedUser, { type: "belongsTo", entity: "User", foreign: "leads" })
  assert.deepEqual(description.links.contacts, { type: "hasMany", entity: "Contact" })
})

test("describeEntity throws a 404 EspoApiError for an unknown entity type", async (): Promise<void> => {
  const { client } = createFakeClient(uniqueBaseUrl(), { metadata: SAMPLE_METADATA })
  await assert.rejects(metadataService(client, 300).describeEntity("Ghost"), (error: unknown): true => {
    assert.ok(error instanceof EspoApiError)
    assert.equal(error.status, 404)

    return true
  })
})

test("metadata is fetched once and cached within the TTL", async (): Promise<void> => {
  const { client, calls } = createFakeClient(uniqueBaseUrl(), { metadata: SAMPLE_METADATA })
  const service: MetadataService = metadataService(client, 300)
  await service.listEntityTypes()
  await service.describeEntity("Lead")
  assert.equal(metadataCalls(calls), 1)
})

test("a zero TTL forces a refetch on every access", async (): Promise<void> => {
  const { client, calls } = createFakeClient(uniqueBaseUrl(), { metadata: SAMPLE_METADATA })
  const service: MetadataService = metadataService(client, 0)
  await service.listEntityTypes()
  await service.listEntityTypes()
  assert.equal(metadataCalls(calls), 2)
})

test("the cache is shared per base URL across service instances", async (): Promise<void> => {
  const baseUrl: string = uniqueBaseUrl()
  const first: FakeClient = createFakeClient(baseUrl, { metadata: SAMPLE_METADATA })
  await metadataService(first.client, 300).listEntityTypes()
  assert.equal(metadataCalls(first.calls), 1)

  const second: FakeClient = createFakeClient(baseUrl, { metadata: SAMPLE_METADATA })
  await metadataService(second.client, 300).listEntityTypes()
  assert.equal(metadataCalls(second.calls), 0)
})
