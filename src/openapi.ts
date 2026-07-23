import type { Config } from "./config.js";
import { entityObjectSchema, writableFields } from "./espo/fields.js";
import { log } from "./logger.js";
import type { ToolContext } from "./tools/types.js";
import { VERSION } from "./version.js";

type Json = Record<string, unknown>;

function queryParam(name: string, schema: Json, description: string): Json {
  return { name, in: "query", required: false, schema, description };
}

function jsonResponse(schema: Json): Json {
  return { description: "Successful response", content: { "application/json": { schema } } };
}

function jsonBody(schema: Json): Json {
  return { required: true, content: { "application/json": { schema } } };
}

function writeProperties(fields: Parameters<typeof writableFields>[0]): { properties: Json; required: string[] } {
  const properties: Json = {};
  const required: string[] = [];
  for (const spec of writableFields(fields)) {
    properties[spec.name] = spec.json;
    if (spec.required) {
      required.push(spec.name);
    }
  }

  return { properties, required };
}

function createBodySchema(fields: Parameters<typeof writableFields>[0]): Json {
  const { properties, required } = writeProperties(fields);

  return required.length > 0 ? { type: "object", properties, required } : { type: "object", properties };
}

function updateBodySchema(fields: Parameters<typeof writableFields>[0]): Json {
  return { type: "object", properties: writeProperties(fields).properties };
}

const ID_PARAM: Json = { name: "id", in: "path", required: true, schema: { type: "string" } };

const SEARCH_PARAMS: Json[] = [
  queryParam("maxSize", { type: "integer", default: 20 }, "Page size."),
  queryParam("offset", { type: "integer" }, "Result offset for pagination."),
  queryParam("orderBy", { type: "string" }, "Field name to sort by."),
  queryParam("order", { type: "string", enum: ["asc", "desc"] }, "Sort direction."),
  queryParam("select", { type: "string" }, "Comma-separated field names to return."),
  queryParam("primaryFilter", { type: "string" }, "Named primary filter defined on the entity."),
  {
    name: "where",
    in: "query",
    required: false,
    style: "deepObject",
    explode: true,
    description: "EspoCRM filter conditions, serialized as where[i][type]=…&where[i][attribute]=…&where[i][value]=…",
    schema: {
      type: "array",
      items: {
        type: "object",
        properties: { type: { type: "string" }, attribute: { type: "string" }, value: {} },
        required: ["type"],
      },
    },
  },
];

const STREAM_NOTE_SCHEMA: Json = {
  type: "object",
  properties: {
    id: { type: "string" },
    type: { type: "string" },
    post: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    createdById: { type: "string" },
    createdByName: { type: "string" },
  },
};

// Generates an OpenAPI 3.1 document describing the EspoCRM REST operations this
// server proxies, with entity schemas typed from the instance's live metadata —
// the same field mapping the typed search filters are built from.
export async function buildOpenApiDocument(context: ToolContext, config: Config): Promise<Json> {
  const schemas: Json = { StreamNote: STREAM_NOTE_SCHEMA };
  const paths: Json = {};

  for (const entityType of config.entityTypes) {
    let fields;
    try {
      fields = (await context.metadata.describeEntity(entityType)).fields;
    } catch (error) {
      log(`openapi: skipping entity '${entityType}': ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    schemas[entityType] = entityObjectSchema(fields);
    const recordRef: Json = { $ref: `#/components/schemas/${entityType}` };
    const listSchema: Json = {
      type: "object",
      properties: { total: { type: "integer" }, list: { type: "array", items: recordRef } },
    };

    const collectionPath: Json = {
      get: {
        operationId: `search${entityType}`,
        summary: `Search ${entityType} records`,
        tags: [entityType],
        parameters: SEARCH_PARAMS,
        responses: { "200": jsonResponse(listSchema) },
      },
    };
    const itemPath: Json = {
      get: {
        operationId: `get${entityType}`,
        summary: `Get a ${entityType} record by id`,
        tags: [entityType],
        parameters: [ID_PARAM, queryParam("select", { type: "string" }, "Comma-separated field names to return.")],
        responses: { "200": jsonResponse(recordRef), "404": { description: "Record not found" } },
      },
    };

    if (!config.readOnly) {
      collectionPath.post = {
        operationId: `create${entityType}`,
        summary: `Create a ${entityType} record`,
        tags: [entityType],
        requestBody: jsonBody(createBodySchema(fields)),
        responses: { "200": jsonResponse(recordRef) },
      };
      itemPath.patch = {
        operationId: `update${entityType}`,
        summary: `Update a ${entityType} record`,
        tags: [entityType],
        parameters: [ID_PARAM],
        requestBody: jsonBody(updateBodySchema(fields)),
        responses: { "200": jsonResponse(recordRef) },
      };
      itemPath.delete = {
        operationId: `delete${entityType}`,
        summary: `Delete a ${entityType} record`,
        tags: [entityType],
        parameters: [ID_PARAM],
        responses: { "200": jsonResponse({ type: "boolean" }) },
      };
    }

    paths[`/${entityType}`] = collectionPath;
    paths[`/${entityType}/{id}`] = itemPath;
    paths[`/${entityType}/{id}/stream`] = {
      get: {
        operationId: `get${entityType}Stream`,
        summary: `Get the activity stream of a ${entityType} record`,
        tags: [entityType],
        parameters: [
          ID_PARAM,
          queryParam("maxSize", { type: "integer", default: 20 }, "Page size."),
          queryParam("offset", { type: "integer" }, "Result offset for pagination."),
        ],
        responses: {
          "200": jsonResponse({
            type: "object",
            properties: { total: { type: "integer" }, list: { type: "array", items: { $ref: "#/components/schemas/StreamNote" } } },
          }),
        },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "EspoCRM REST API",
      version: VERSION,
      description:
        "Typed projection of the EspoCRM REST API for the entity types exposed by this MCP server. " +
        "Entity schemas are generated from the instance's live metadata.",
    },
    servers: [{ url: `${config.baseUrl}/api/v1` }],
    security: [{ ApiKey: [] }, { EspoAuthorization: [] }],
    paths,
    components: {
      schemas,
      securitySchemes: {
        ApiKey: { type: "apiKey", in: "header", name: "X-Api-Key" },
        EspoAuthorization: { type: "apiKey", in: "header", name: "Espo-Authorization" },
      },
    },
  };
}
