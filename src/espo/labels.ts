import { log } from "../logger.js";
import type { EspoClient } from "./client.js";

// Field name -> stored option value -> the label users see in the EspoCRM UI.
export type EntityOptionLabels = Record<string, Record<string, string>>;

type Language = Record<string, unknown>;

interface CacheEntry {
  data: Language;
  fetchedAt: number;
}

// The language document is ACL-filtered and rendered in the caller's own
// language, so — unlike metadata — it is cached per base URL *and* credential
// and never shared between callers.
const cache = new Map<string, CacheEntry>();

function translatedLabels(labels: unknown): Record<string, string> {
  if (typeof labels !== "object" || labels === null) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(labels).filter(
      ([value, label]) => typeof label === "string" && label !== "" && label !== value,
    ),
  ) as Record<string, string>;
}

// EspoCRM's Label Manager renames the *labels* of enum options while the stored
// values stay as they are, so a status shown as "In Talks" is still written as
// "Assigned". /Metadata carries only the values; the labels live in /I18n.
export class LabelService {
  constructor(
    private readonly client: EspoClient,
    private readonly ttlSeconds: number,
  ) {}

  async optionLabels(entityType: string): Promise<EntityOptionLabels> {
    const scope = (await this.language())[entityType] as Record<string, unknown> | undefined;
    const options = scope?.options;
    if (typeof options !== "object" || options === null) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(options)
        .map(([field, labels]) => [field, translatedLabels(labels)] as const)
        .filter(([, labels]) => Object.keys(labels).length > 0),
    );
  }

  private async language(): Promise<Language> {
    const key = `${this.client.baseUrl}|${this.client.credentialFingerprint}`;
    const cached = cache.get(key);
    if (cached !== undefined && (Date.now() - cached.fetchedAt) / 1000 < this.ttlSeconds) {
      return cached.data;
    }

    const data = await this.fetchLanguage();
    cache.set(key, { data, fetchedAt: Date.now() });

    return data;
  }

  // Labels are a convenience: an instance that will not serve /I18n keeps working
  // with the stored values alone, so a failure is logged and cached, not thrown.
  private async fetchLanguage(): Promise<Language> {
    try {
      return await this.client.getI18n();
    } catch (error) {
      log(`option labels unavailable (/I18n): ${error instanceof Error ? error.message : String(error)}`);

      return {};
    }
  }
}
