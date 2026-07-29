import { z } from "zod";

export type FieldMap = Record<string, Record<string, unknown>>;

export interface WhereItem {
  type: string;
  attribute?: string;
  value?: unknown;
}

// Param names owned by the search tool itself — a field must not shadow them.
const RESERVED = new Set([
  "where",
  "textFilter",
  "select",
  "orderBy",
  "order",
  "maxSize",
  "offset",
  "primaryFilter",
  "id",
]);

// Field types that make good typed filters, in the order we prefer to keep them
// when capping. Text fields are intentionally excluded (covered by textFilter).
const FILTERABLE_PRIORITY: Record<string, number> = {
  enum: 0,
  bool: 1,
  link: 2,
  date: 3,
  datetime: 3,
  int: 4,
  float: 4,
  currency: 4,
};

const MAX_TYPED_FILTERS = 25;

interface Contribution {
  params: z.ZodRawShape;
  build: (args: Record<string, unknown>) => WhereItem[];
}

export interface EntityFilters {
  params: z.ZodRawShape;
  toConditions: (args: Record<string, unknown>) => WhereItem[];
}

function stringOptions(options: unknown): string[] {
  return Array.isArray(options) ? options.filter((option): option is string => typeof option === "string" && option !== "") : [];
}

// Option values renamed in EspoCRM's Label Manager: the label is what users (and
// therefore prompts) call the option, while the API still speaks the stored value.
type OptionLabels = Record<string, string>;

function optionLabels(definition: Record<string, unknown>): OptionLabels {
  const labels = definition.optionLabels;
  if (typeof labels !== "object" || labels === null) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(labels).filter(
      ([value, label]) => typeof label === "string" && label !== "" && label !== value,
    ),
  ) as OptionLabels;
}

function labelDescription(options: string[], labels: OptionLabels): string {
  const pairs = options
    .filter((option) => labels[option] !== undefined)
    .map((option) => `"${labels[option]}" = ${option}`);

  return pairs.length === 0 ? "" : `UI labels: ${pairs.join(", ")}.`;
}

// Inputs take either form; the value is what reaches EspoCRM.
function inputLabelDescription(options: string[], labels: OptionLabels): string {
  const described = labelDescription(options, labels);

  return described === "" ? "" : `${described} Either form is accepted.`;
}

// A label only stands in for its value when it is unambiguous: labels that
// duplicate another option's stored value or another option's label are dropped.
function valuesByLabel(options: string[], labels: OptionLabels): Record<string, string> {
  const labelled = options.filter((option) => labels[option] !== undefined);
  const unambiguous = labelled.filter(
    (option) =>
      !options.includes(labels[option]!) &&
      labelled.every((other) => other === option || labels[other] !== labels[option]),
  );

  return Object.fromEntries(unambiguous.map((option) => [labels[option]!, option]));
}

function enumSchema(options: string[], labels: OptionLabels): z.ZodTypeAny {
  const values = z.enum(options as [string, ...string[]]);
  const byLabel = valuesByLabel(options, labels);
  if (Object.keys(byLabel).length === 0) {
    return values;
  }

  return z.preprocess(
    (input) => (typeof input === "string" && byLabel[input] !== undefined ? byLabel[input] : input),
    values,
  );
}

function describedSchema(schema: z.ZodTypeAny, note: string): z.ZodTypeAny {
  return note === "" ? schema : schema.describe(note);
}

function describedJson(json: Record<string, unknown>, note: string): Record<string, unknown> {
  return note === "" ? json : { ...json, description: note };
}

function sentences(...parts: string[]): string {
  return parts.filter((part) => part !== "").join(" ");
}

function rangeContribution(name: string, makeSchema: () => z.ZodTypeAny, unit: string): Contribution | null {
  const from = `${name}From`;
  const to = `${name}To`;
  if (RESERVED.has(from) || RESERVED.has(to)) {
    return null;
  }

  return {
    params: {
      [from]: makeSchema().optional().describe(`${name} on or after (${unit}).`),
      [to]: makeSchema().optional().describe(`${name} on or before (${unit}).`),
    },
    build: (args) => {
      const conditions: WhereItem[] = [];
      if (args[from] !== undefined) {
        conditions.push({ type: "greaterThanOrEquals", attribute: name, value: args[from] });
      }
      if (args[to] !== undefined) {
        conditions.push({ type: "lessThanOrEquals", attribute: name, value: args[to] });
      }

      return conditions;
    },
  };
}

function contributionFor(name: string, definition: Record<string, unknown>): Contribution | null {
  const type = typeof definition.type === "string" ? definition.type : "";

  switch (type) {
    case "enum": {
      const options = stringOptions(definition.options);
      if (options.length === 0 || RESERVED.has(name)) {
        return null;
      }
      const labels = optionLabels(definition);

      return {
        params: {
          [name]: enumSchema(options, labels)
            .optional()
            .describe(sentences(`Filter by ${name}.`, inputLabelDescription(options, labels))),
        },
        build: (args) => (args[name] === undefined ? [] : [{ type: "equals", attribute: name, value: args[name] }]),
      };
    }
    case "bool": {
      if (RESERVED.has(name)) {
        return null;
      }

      return {
        params: { [name]: z.boolean().optional().describe(`Filter by ${name}.`) },
        build: (args) =>
          args[name] === undefined ? [] : [{ type: args[name] === true ? "isTrue" : "isFalse", attribute: name }],
      };
    }
    case "link": {
      const param = `${name}Id`;
      if (RESERVED.has(param)) {
        return null;
      }

      return {
        params: { [param]: z.string().optional().describe(`Filter by related ${name} id.`) },
        build: (args) => (args[param] === undefined ? [] : [{ type: "equals", attribute: param, value: args[param] }]),
      };
    }
    case "date":
      return rangeContribution(name, () => z.string(), "ISO date");
    case "datetime":
      return rangeContribution(name, () => z.string(), "ISO date-time");
    case "int":
      return rangeContribution(name, () => z.number().int(), "integer");
    case "float":
    case "currency":
      return rangeContribution(name, () => z.number(), "number");
    default:
      return null;
  }
}

// Builds typed filter parameters for an entity's high-signal fields, capped to
// keep the tool schema small, plus a translator to EspoCRM where conditions.
export function buildFilters(fields: FieldMap): EntityFilters {
  const candidates = Object.entries(fields)
    .map(([name, definition]) => ({
      name,
      definition,
      priority: FILTERABLE_PRIORITY[typeof definition.type === "string" ? definition.type : ""] ?? 99,
    }))
    .filter((candidate) => candidate.priority < 99)
    .sort((first, second) => first.priority - second.priority);

  const params: z.ZodRawShape = {};
  const contributions: Contribution[] = [];
  const usedNames = new Set<string>();

  for (const candidate of candidates) {
    if (contributions.length >= MAX_TYPED_FILTERS) {
      break;
    }
    const contribution = contributionFor(candidate.name, candidate.definition);
    if (contribution === null) {
      continue;
    }
    const names = Object.keys(contribution.params);
    if (names.some((name) => usedNames.has(name))) {
      continue;
    }
    names.forEach((name) => usedNames.add(name));
    Object.assign(params, contribution.params);
    contributions.push(contribution);
  }

  return {
    params,
    toConditions: (args) => contributions.flatMap((contribution) => contribution.build(args)),
  };
}

export interface WriteFieldSpec {
  name: string;
  required: boolean;
  zod: z.ZodTypeAny;
  json: Record<string, unknown>;
}

// System / audit fields are never settable through writes.
const WRITE_SKIP_NAMES = new Set(["id", "createdAt", "modifiedAt", "createdBy", "modifiedBy", "deleted"]);

function writeSpecFor(name: string, definition: Record<string, unknown>): WriteFieldSpec | null {
  if (WRITE_SKIP_NAMES.has(name) || definition.readOnly === true || definition.notStorable === true) {
    return null;
  }

  const type = typeof definition.type === "string" ? definition.type : "";
  const required = definition.required === true;

  switch (type) {
    case "varchar":
    case "text":
    case "url":
    case "phone":
      return { name, required, zod: z.string(), json: { type: "string" } };
    case "email":
      return { name, required, zod: z.string(), json: { type: "string", format: "email" } };
    case "enum": {
      const options = stringOptions(definition.options);
      if (options.length === 0) {
        return { name, required, zod: z.string(), json: { type: "string" } };
      }
      const labels = optionLabels(definition);
      const note = inputLabelDescription(options, labels);

      return {
        name,
        required,
        zod: describedSchema(enumSchema(options, labels), note),
        json: describedJson({ type: "string", enum: options }, note),
      };
    }
    case "multiEnum":
    case "array": {
      const options = stringOptions(definition.options);
      const labels = optionLabels(definition);
      const note = inputLabelDescription(options, labels);
      const itemZod = options.length === 0 ? z.string() : enumSchema(options, labels);
      const itemJson = options.length === 0 ? { type: "string" } : { type: "string", enum: options };

      return {
        name,
        required,
        zod: describedSchema(z.array(itemZod), note),
        json: describedJson({ type: "array", items: itemJson }, note),
      };
    }
    case "bool":
      return { name, required, zod: z.boolean(), json: { type: "boolean" } };
    case "int":
      return { name, required, zod: z.number().int(), json: { type: "integer" } };
    case "float":
    case "currency":
      return { name, required, zod: z.number(), json: { type: "number" } };
    case "date":
      return { name, required, zod: z.string(), json: { type: "string", format: "date" } };
    case "datetime":
      return { name, required, zod: z.string(), json: { type: "string", format: "date-time" } };
    case "link":
      return { name: `${name}Id`, required, zod: z.string(), json: { type: "string" } };
    default:
      return null;
  }
}

// Classifies an entity's settable fields once, rendering each as both a zod
// schema (for write tool inputs) and a JSON Schema property (for OpenAPI bodies)
// so the two can never diverge. Required fields sort first.
export function writableFields(fields: FieldMap): WriteFieldSpec[] {
  const specs: WriteFieldSpec[] = [];
  const usedNames = new Set<string>();

  const entries = Object.entries(fields).sort(
    (first, second) => Number(second[1].required === true) - Number(first[1].required === true),
  );

  for (const [name, definition] of entries) {
    const spec = writeSpecFor(name, definition);
    if (spec === null || usedNames.has(spec.name)) {
      continue;
    }
    usedNames.add(spec.name);
    specs.push(spec);
  }

  return specs;
}

// Renders an entity's fields as a JSON Schema object for OpenAPI components,
// from the same metadata field definitions the filters use.
export function entityObjectSchema(fields: FieldMap): Record<string, unknown> {
  const properties: Record<string, unknown> = { id: { type: "string" } };
  const required: string[] = [];

  for (const [name, definition] of Object.entries(fields)) {
    Object.assign(properties, fieldProperties(name, definition));
    if (definition.required === true) {
      required.push(name);
    }
  }

  return required.length === 0
    ? { type: "object", properties }
    : { type: "object", properties, required };
}

function fieldProperties(name: string, definition: Record<string, unknown>): Record<string, unknown> {
  const type = typeof definition.type === "string" ? definition.type : "";

  switch (type) {
    case "varchar":
    case "text":
    case "url":
    case "phone":
      return { [name]: { type: "string" } };
    case "email":
      return { [name]: { type: "string", format: "email" } };
    case "enum": {
      const options = stringOptions(definition.options);
      if (options.length === 0) {
        return { [name]: { type: "string" } };
      }

      return {
        [name]: describedJson(
          { type: "string", enum: options },
          labelDescription(options, optionLabels(definition)),
        ),
      };
    }
    case "bool":
      return { [name]: { type: "boolean" } };
    case "int":
      return { [name]: { type: "integer" } };
    case "float":
    case "currency":
      return { [name]: { type: "number" } };
    case "date":
      return { [name]: { type: "string", format: "date" } };
    case "datetime":
      return { [name]: { type: "string", format: "date-time" } };
    case "link":
      return { [`${name}Id`]: { type: "string" }, [`${name}Name`]: { type: "string" } };
    default:
      return {};
  }
}
