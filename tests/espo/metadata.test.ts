import { test } from "node:test";
import assert from "node:assert/strict";
import { EspoApiError } from "../../src/errors.js";
import { MetadataService } from "../../src/espo/metadata.js";
import { createFakeClient, SAMPLE_METADATA, uniqueBaseUrl } from "../testing/fixtures.js";

function metadataCalls(calls: { method: string }[]): number {
  return calls.filter((call) => call.method === "getMetadata").length;
}

test("listEntityTypes returns only entity scopes, sorted, with the custom flag", async () => {
  const { client } = createFakeClient(uniqueBaseUrl(), { metadata: SAMPLE_METADATA });
  const service = new MetadataService(client, 300);
  assert.deepEqual(await service.listEntityTypes(), [
    { entityType: "CDeal", custom: true },
    { entityType: "Contact", custom: false },
    { entityType: "Lead", custom: false },
  ]);
});

test("describeEntity prunes fields to type, required, and options", async () => {
  const { client } = createFakeClient(uniqueBaseUrl(), { metadata: SAMPLE_METADATA });
  const description = await new MetadataService(client, 300).describeEntity("Lead");
  assert.deepEqual(description.fields.status, { type: "enum", required: true, options: ["New", "Assigned", "Dead"] });
  assert.deepEqual(description.fields.name, { type: "varchar" });
  assert.ok(!("required" in description.fields.name!));
});

test("describeEntity prunes links to type, entity, and foreign", async () => {
  const { client } = createFakeClient(uniqueBaseUrl(), { metadata: SAMPLE_METADATA });
  const description = await new MetadataService(client, 300).describeEntity("Lead");
  assert.deepEqual(description.links.assignedUser, { type: "belongsTo", entity: "User", foreign: "leads" });
  assert.deepEqual(description.links.contacts, { type: "hasMany", entity: "Contact" });
});

test("describeEntity throws a 404 EspoApiError for an unknown entity type", async () => {
  const { client } = createFakeClient(uniqueBaseUrl(), { metadata: SAMPLE_METADATA });
  await assert.rejects(new MetadataService(client, 300).describeEntity("Ghost"), (error: unknown) => {
    assert.ok(error instanceof EspoApiError);
    assert.equal(error.status, 404);

    return true;
  });
});

test("metadata is fetched once and cached within the TTL", async () => {
  const { client, calls } = createFakeClient(uniqueBaseUrl(), { metadata: SAMPLE_METADATA });
  const service = new MetadataService(client, 300);
  await service.listEntityTypes();
  await service.describeEntity("Lead");
  assert.equal(metadataCalls(calls), 1);
});

test("a zero TTL forces a refetch on every access", async () => {
  const { client, calls } = createFakeClient(uniqueBaseUrl(), { metadata: SAMPLE_METADATA });
  const service = new MetadataService(client, 0);
  await service.listEntityTypes();
  await service.listEntityTypes();
  assert.equal(metadataCalls(calls), 2);
});

test("the cache is shared per base URL across service instances", async () => {
  const baseUrl = uniqueBaseUrl();
  const first = createFakeClient(baseUrl, { metadata: SAMPLE_METADATA });
  await new MetadataService(first.client, 300).listEntityTypes();
  assert.equal(metadataCalls(first.calls), 1);

  const second = createFakeClient(baseUrl, { metadata: SAMPLE_METADATA });
  await new MetadataService(second.client, 300).listEntityTypes();
  assert.equal(metadataCalls(second.calls), 0);
});
