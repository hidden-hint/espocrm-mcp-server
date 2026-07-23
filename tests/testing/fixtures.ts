import type { Config } from "../../src/config.js";
import type { EspoClient, ListResult } from "../../src/espo/client.js";
import { MetadataService } from "../../src/espo/metadata.js";
import type { ToolContext } from "../../src/tools/types.js";

const BASE_CONFIG: Config = {
  baseUrl: "https://crm.example.test",
  authMode: "apiKey",
  apiKey: "test-key",
  passthroughAs: "apiKey",
  transport: "http",
  httpPort: 3000,
  httpPath: "/mcp",
  readOnly: true,
  entityTypes: ["Lead"],
  metadataTtlSeconds: 300,
};

export function makeConfig(overrides: Partial<Config>): Config {
  return { ...BASE_CONFIG, ...overrides };
}

export interface RecordedCall {
  method: string;
  args: unknown[];
}

export interface FakeClientResponses {
  find: ListResult;
  getRecord: Record<string, unknown>;
  getStream: ListResult;
  create: Record<string, unknown>;
  update: Record<string, unknown>;
  deleteRecord: unknown;
  metadata: Record<string, unknown>;
}

export interface FakeClient {
  client: EspoClient;
  calls: RecordedCall[];
  lastCall: () => RecordedCall;
}

const DEFAULT_RESPONSES: FakeClientResponses = {
  find: { total: 0, list: [] },
  getRecord: { id: "record-1" },
  getStream: { total: 0, list: [] },
  create: { id: "created-1" },
  update: { id: "updated-1" },
  deleteRecord: null,
  metadata: {},
};

let baseUrlSequence = 0;

export function uniqueBaseUrl(): string {
  baseUrlSequence += 1;

  return `https://crm-${baseUrlSequence}.example.test`;
}

export function createFakeClient(
  baseUrl: string,
  overrides: Partial<FakeClientResponses>,
): FakeClient {
  const responses = { ...DEFAULT_RESPONSES, ...overrides };
  const calls: RecordedCall[] = [];

  const record = <T>(method: string, value: () => T) =>
    (...args: unknown[]): Promise<T> => {
      calls.push({ method, args });

      return Promise.resolve(value());
    };

  const client = {
    baseUrl,
    find: record("find", () => responses.find),
    getRecord: record("getRecord", () => responses.getRecord),
    getStream: record("getStream", () => responses.getStream),
    getMetadata: record("getMetadata", () => responses.metadata),
    create: record("create", () => responses.create),
    update: record("update", () => responses.update),
    deleteRecord: record("deleteRecord", () => responses.deleteRecord),
  } as unknown as EspoClient;

  return { client, calls, lastCall: () => calls[calls.length - 1]! };
}

export function createContext(overrides: Partial<FakeClientResponses>): {
  context: ToolContext;
  calls: RecordedCall[];
} {
  const { client, calls } = createFakeClient(uniqueBaseUrl(), {
    metadata: SAMPLE_METADATA,
    ...overrides,
  });

  return { context: { espo: client, metadata: new MetadataService(client, 300) }, calls };
}

// A representative EspoCRM /Metadata payload covering every field rendering the
// field mapping classifies: enum (with options), bool, link, currency, datetime,
// date, int, multiEnum, email, url, text/varchar, plus readOnly / notStorable /
// audit fields that writes must skip.
export const SAMPLE_METADATA: Record<string, unknown> = {
  scopes: {
    Lead: { entity: true, isCustom: false },
    Contact: { entity: true, isCustom: false },
    CDeal: { entity: true, isCustom: true },
    Settings: { entity: false },
    EmailTemplate: {},
  },
  entityDefs: {
    Lead: {
      fields: {
        name: { type: "varchar" },
        status: { type: "enum", options: ["New", "Assigned", "Dead"], required: true },
        source: { type: "enum", options: [] },
        emailAddress: { type: "email" },
        website: { type: "url" },
        phoneNumber: { type: "phone" },
        description: { type: "text" },
        amount: { type: "currency" },
        opportunityAmount: { type: "float" },
        numberOfEmployees: { type: "int" },
        doNotCall: { type: "bool" },
        assignedUser: { type: "link" },
        createdAt: { type: "datetime" },
        birthday: { type: "date" },
        tags: { type: "multiEnum", options: ["hot", "cold"] },
        aliases: { type: "array" },
        id: { type: "varchar" },
        modifiedAt: { type: "datetime" },
        internalCode: { type: "varchar", notStorable: true },
        computedScore: { type: "int", readOnly: true },
        mysteryField: { type: "unmapped" },
      },
      links: {
        assignedUser: { type: "belongsTo", entity: "User", foreign: "leads" },
        contacts: { type: "hasMany", entity: "Contact" },
      },
    },
    Contact: {
      fields: { name: { type: "varchar" } },
      links: {},
    },
  },
};
