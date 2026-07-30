import { EspoApiError } from "../errors.js"
import { pruneUndefined } from "../util.js"
import type { EspoClient } from "./client.js"
import type { EntityOptionLabels, LabelService } from "./labels.js"

export interface EntityTypeInfo {
  entityType: string
  custom: boolean
}

export interface EntityDescription {
  entityType: string
  fields: Record<string, Record<string, unknown>>
  links: Record<string, Record<string, unknown>>
}

type Metadata = Record<string, unknown>

interface CacheEntry {
  data: Metadata
  fetchedAt: number
}

// Metadata is instance schema, not user data. Cached per base URL with a TTL.
const cache: Map<string, CacheEntry> = new Map<string, CacheEntry>()

export class MetadataService {
  constructor(
    private readonly client: EspoClient,
    private readonly ttlSeconds: number,
    private readonly labels: LabelService,
  ) {}

  async listEntityTypes(): Promise<EntityTypeInfo[]> {
    const scopes: Record<string, Record<string, unknown>> | undefined = (await this.metadata()).scopes as
      Record<string, Record<string, unknown>> | undefined

    return Object.entries(scopes ?? {})
      .filter(([, scope]: [string, Record<string, unknown>]): boolean => scope?.entity === true)
      .map(([entityType, scope]: [string, Record<string, unknown>]): { entityType: string; custom: boolean } => ({
        entityType,
        custom: scope?.isCustom === true,
      }))
      .sort((first: { entityType: string; custom: boolean }, second: { entityType: string; custom: boolean }): number =>
        first.entityType.localeCompare(second.entityType),
      )
  }

  async describeEntity(entityType: string): Promise<EntityDescription> {
    const entityDefs: Record<string, Record<string, unknown>> | undefined = (await this.metadata()).entityDefs as
      Record<string, Record<string, unknown>> | undefined
    const definition: Record<string, unknown> | undefined = entityDefs?.[entityType]
    if (definition === undefined) {
      throw new EspoApiError(404, `Unknown entity type '${entityType}'`)
    }

    return {
      entityType,
      fields: this.describeFields(
        definition.fields as Record<string, Record<string, unknown>> | undefined,
        await this.labels.optionLabels(entityType),
      ),
      links: this.describeLinks(definition.links as Record<string, Record<string, unknown>> | undefined),
    }
  }

  private describeFields(
    fields: Record<string, Record<string, unknown>> | undefined,
    optionLabels: EntityOptionLabels,
  ): EntityDescription["fields"] {
    return Object.fromEntries(
      Object.entries(fields ?? {}).map(
        ([name, field]: [string, Record<string, unknown>]): [string, Record<string, unknown>] => [
          name,
          pruneUndefined({
            type: field.type,
            required: field.required === true ? true : undefined,
            options: field.options,
            optionLabels: optionLabels[name],
          }),
        ],
      ),
    )
  }

  private describeLinks(links: Record<string, Record<string, unknown>> | undefined): EntityDescription["links"] {
    return Object.fromEntries(
      Object.entries(links ?? {}).map(
        ([name, link]: [string, Record<string, unknown>]): [string, Record<string, unknown>] => [
          name,
          pruneUndefined({ type: link.type, entity: link.entity, foreign: link.foreign }),
        ],
      ),
    )
  }

  private async metadata(): Promise<Metadata> {
    const cached: CacheEntry | undefined = cache.get(this.client.baseUrl)
    if (cached !== undefined && (Date.now() - cached.fetchedAt) / 1000 < this.ttlSeconds) {
      return cached.data
    }

    const data: Record<string, unknown> = await this.client.getMetadata()
    cache.set(this.client.baseUrl, { data, fetchedAt: Date.now() })

    return data
  }
}
