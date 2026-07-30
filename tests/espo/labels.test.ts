import { test } from "node:test"
import assert from "node:assert/strict"
import type { EspoClient } from "../../src/espo/client.js"
import { LabelService } from "../../src/espo/labels.js"
import { EspoApiError } from "../../src/errors.js"
import { SAMPLE_I18N, uniqueBaseUrl } from "../testing/fixtures.js"
import type { EntityOptionLabels } from "../../src/espo/labels.js"

interface FakeI18nClient {
  client: EspoClient
  calls: string[]
}

function respondingClient(
  baseUrl: string,
  credentialFingerprint: string,
  i18n: Record<string, unknown>,
): FakeI18nClient {
  const calls: string[] = []

  const client: EspoClient = {
    baseUrl,
    credentialFingerprint,
    getI18n: (): Promise<Record<string, unknown>> => {
      calls.push("getI18n")

      return Promise.resolve(i18n)
    },
  } as unknown as EspoClient

  return { client, calls }
}

function failingClient(baseUrl: string): FakeI18nClient {
  const calls: string[] = []

  const client: EspoClient = {
    baseUrl,
    credentialFingerprint: "fingerprint",
    getI18n: (): Promise<never> => {
      calls.push("getI18n")

      return Promise.reject(new EspoApiError(403, "Forbidden"))
    },
  } as unknown as EspoClient

  return { client, calls }
}

test("optionLabels returns the labels of an entity's translated options", async (): Promise<void> => {
  const { client } = respondingClient(uniqueBaseUrl(), "fingerprint", SAMPLE_I18N)
  assert.deepEqual(await new LabelService(client, 300).optionLabels("Lead"), {
    status: { New: "Backlog", Assigned: "In Talks" },
    tags: { hot: "Burning" },
  })
})

test("optionLabels drops labels identical to the stored value", async (): Promise<void> => {
  const { client } = respondingClient(uniqueBaseUrl(), "fingerprint", SAMPLE_I18N)
  const labels: EntityOptionLabels = await new LabelService(client, 300).optionLabels("Lead")
  assert.ok(!("Dead" in labels.status!))
})

test("optionLabels returns an empty map for an entity with no translated options", async (): Promise<void> => {
  const { client } = respondingClient(uniqueBaseUrl(), "fingerprint", SAMPLE_I18N)
  const service: LabelService = new LabelService(client, 300)
  assert.deepEqual(await service.optionLabels("Contact"), {})
  assert.deepEqual(await service.optionLabels("Ghost"), {})
})

test("optionLabels ignores non-string label entries", async (): Promise<void> => {
  const { client } = respondingClient(uniqueBaseUrl(), "fingerprint", {
    Lead: { options: { status: { New: 42, Assigned: "In Talks" }, source: "not-a-map" } },
  })
  assert.deepEqual(await new LabelService(client, 300).optionLabels("Lead"), {
    status: { Assigned: "In Talks" },
  })
})

test("the language document is fetched once and cached within the TTL", async (): Promise<void> => {
  const { client, calls } = respondingClient(uniqueBaseUrl(), "fingerprint", SAMPLE_I18N)
  const service: LabelService = new LabelService(client, 300)
  await service.optionLabels("Lead")
  await service.optionLabels("Contact")
  assert.equal(calls.length, 1)
})

test("a zero TTL forces a refetch on every access", async (): Promise<void> => {
  const { client, calls } = respondingClient(uniqueBaseUrl(), "fingerprint", SAMPLE_I18N)
  const service: LabelService = new LabelService(client, 0)
  await service.optionLabels("Lead")
  await service.optionLabels("Lead")
  assert.equal(calls.length, 2)
})

test("the cache is shared per base URL and credential across service instances", async (): Promise<void> => {
  const baseUrl: string = uniqueBaseUrl()
  const first: FakeI18nClient = respondingClient(baseUrl, "fingerprint-a", SAMPLE_I18N)
  await new LabelService(first.client, 300).optionLabels("Lead")
  assert.equal(first.calls.length, 1)

  const second: FakeI18nClient = respondingClient(baseUrl, "fingerprint-a", SAMPLE_I18N)
  await new LabelService(second.client, 300).optionLabels("Lead")
  assert.equal(second.calls.length, 0)
})

test("callers with different credentials never share the ACL-filtered language document", async (): Promise<void> => {
  const baseUrl: string = uniqueBaseUrl()
  const first: FakeI18nClient = respondingClient(baseUrl, "fingerprint-a", SAMPLE_I18N)
  await new LabelService(first.client, 300).optionLabels("Lead")

  const second: FakeI18nClient = respondingClient(baseUrl, "fingerprint-b", SAMPLE_I18N)
  await new LabelService(second.client, 300).optionLabels("Lead")
  assert.equal(second.calls.length, 1)
})

test("a failing I18n request yields no labels instead of throwing, and is not retried within the TTL", async (): Promise<void> => {
  const { client, calls } = failingClient(uniqueBaseUrl())
  const service: LabelService = new LabelService(client, 300)
  assert.deepEqual(await service.optionLabels("Lead"), {})
  assert.deepEqual(await service.optionLabels("Lead"), {})
  assert.equal(calls.length, 1)
})
