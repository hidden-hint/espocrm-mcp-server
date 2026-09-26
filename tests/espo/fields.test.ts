import { test } from "node:test"
import assert from "node:assert/strict"
import { z } from "zod"
import type { FieldMap, ParamShape } from "../../src/espo/fields.js"
import { buildFilters, entityObjectSchema, writableFields } from "../../src/espo/fields.js"
import type { WriteFieldSpec } from "../../src/espo/fields.js"

// Unwraps the optional / label-normalizing wrappers a param schema may carry to
// assert on the set of values the JSON Schema will actually offer the model.
function enumValues(schema: z.ZodType): string[] {
  if (schema instanceof z.ZodOptional) {
    return enumValues(schema.unwrap() as z.ZodType)
  }
  if (schema instanceof z.ZodPipe) {
    return enumValues(schema.out as z.ZodType)
  }
  if (schema instanceof z.ZodArray) {
    return enumValues(schema.element as z.ZodType)
  }
  assert.ok(schema instanceof z.ZodEnum, "expected an enum schema")

  return schema.options.map(String)
}

const LEAD_FIELDS: FieldMap = {
  name: { type: "varchar" },
  status: { type: "enum", options: ["New", "Assigned", "Dead"], required: true },
  source: { type: "enum", options: [] },
  emailAddress: { type: "email" },
  website: { type: "url" },
  description: { type: "text" },
  amount: { type: "currency" },
  numberOfEmployees: { type: "int" },
  doNotCall: { type: "bool" },
  assignedUser: { type: "link" },
  createdAt: { type: "datetime" },
  birthday: { type: "date" },
  tags: { type: "multiEnum", options: ["hot", "cold"] },
  computedScore: { type: "int", readOnly: true },
  internalCode: { type: "varchar", notStorable: true },
  mystery: { type: "unmapped" },
}

// EspoCRM's Label Manager renames the *labels* of enum options while the stored
// values stay untouched, so "In Talks" is what a user sees for the value "Assigned".
const TRANSLATED_FIELDS: FieldMap = {
  status: {
    type: "enum",
    options: ["New", "Assigned", "Dead"],
    required: true,
    optionLabels: { New: "Backlog", Assigned: "In Talks" },
  },
  tags: { type: "multiEnum", options: ["hot", "cold"], optionLabels: { hot: "Burning" } },
}

test("buildFilters emits typed params for enum, bool, link, and range fields", (): void => {
  const params: ParamShape = buildFilters(LEAD_FIELDS).params
  const keys: string[] = Object.keys(params)
  assert.ok(keys.includes("status"))
  assert.ok(keys.includes("doNotCall"))
  assert.ok(keys.includes("assignedUserId"))
  assert.ok(keys.includes("amountFrom") && keys.includes("amountTo"))
  assert.ok(keys.includes("numberOfEmployeesFrom") && keys.includes("numberOfEmployeesTo"))
  assert.ok(keys.includes("birthdayFrom") && keys.includes("birthdayTo"))
  assert.ok(keys.includes("createdAtFrom") && keys.includes("createdAtTo"))
})

test("buildFilters excludes text fields, optionless enums, and unmapped types", (): void => {
  const keys: string[] = Object.keys(buildFilters(LEAD_FIELDS).params)
  for (const excluded of ["name", "emailAddress", "website", "description", "source", "tags", "mystery"]) {
    assert.ok(!keys.includes(excluded), `expected ${excluded} to be excluded`)
  }
})

test("buildFilters translates an enum selection into an equals condition", (): void => {
  assert.deepEqual(buildFilters(LEAD_FIELDS).toConditions({ status: "New" }), [
    { type: "equals", attribute: "status", value: "New" },
  ])
})

test("buildFilters translates a boolean into isTrue / isFalse", (): void => {
  assert.deepEqual(buildFilters(LEAD_FIELDS).toConditions({ doNotCall: true }), [
    { type: "isTrue", attribute: "doNotCall" },
  ])
  assert.deepEqual(buildFilters(LEAD_FIELDS).toConditions({ doNotCall: false }), [
    { type: "isFalse", attribute: "doNotCall" },
  ])
})

test("buildFilters translates a link id into an equals condition on <field>Id", (): void => {
  assert.deepEqual(buildFilters(LEAD_FIELDS).toConditions({ assignedUserId: "user-1" }), [
    { type: "equals", attribute: "assignedUserId", value: "user-1" },
  ])
})

test("buildFilters translates a range into greaterThanOrEquals / lessThanOrEquals", (): void => {
  assert.deepEqual(buildFilters(LEAD_FIELDS).toConditions({ amountFrom: 10, amountTo: 20 }), [
    { type: "greaterThanOrEquals", attribute: "amount", value: 10 },
    { type: "lessThanOrEquals", attribute: "amount", value: 20 },
  ])
})

test("buildFilters returns no conditions when no filter args are set", (): void => {
  assert.deepEqual(buildFilters(LEAD_FIELDS).toConditions({}), [])
})

test("buildFilters does not let enum/bool/link fields shadow reserved parameter names", (): void => {
  const fields: FieldMap = {
    orderBy: { type: "enum", options: ["a", "b"] },
    select: { type: "bool" },
    maxSize: { type: "enum", options: ["x"] },
    id: { type: "enum", options: ["y"] },
  }
  assert.deepEqual(Object.keys(buildFilters(fields).params), [])
})

test("buildFilters caps the number of typed filters at 25", (): void => {
  const fields: FieldMap = {}
  for (let index: number = 0; index < 40; index += 1) {
    fields[`enum${index}`] = { type: "enum", options: ["a"] }
  }
  assert.equal(Object.keys(buildFilters(fields).params).length, 25)
})

test("buildFilters prioritizes enum/bool/link over numeric ranges when capping", (): void => {
  const fields: FieldMap = {}
  for (let index: number = 0; index < 30; index += 1) {
    fields[`num${index}`] = { type: "int" }
  }
  fields.priorityEnum = { type: "enum", options: ["a"] }
  const keys: string[] = Object.keys(buildFilters(fields).params)
  assert.ok(keys.includes("priorityEnum"))
})

test("an enum filter documents the UI label of every renamed option", (): void => {
  const description: string = buildFilters(TRANSLATED_FIELDS).params.status?.description ?? ""
  assert.match(description, /"Backlog" = New/)
  assert.match(description, /"In Talks" = Assigned/)
  assert.ok(!description.includes("Dead"), "untranslated options need no label note")
})

test("an enum filter still exposes only the stored values as its allowed set", (): void => {
  const status: z.ZodType = buildFilters(TRANSLATED_FIELDS).params.status!
  assert.deepEqual(enumValues(status), ["New", "Assigned", "Dead"])
})

test("an enum filter accepts a UI label and normalizes it to the stored value", (): void => {
  const status: z.ZodType = buildFilters(TRANSLATED_FIELDS).params.status!
  assert.equal(status.parse("In Talks"), "Assigned")
  assert.equal(status.parse("Assigned"), "Assigned")
  assert.throws(() => status.parse("Nonexistent"))
})

test("an untranslated enum filter carries no label note", (): void => {
  assert.equal(buildFilters(LEAD_FIELDS).params.status?.description, "Filter by status.")
})

test("a UI label that collides with another option's stored value is not treated as an alias", (): void => {
  const fields: FieldMap = { stage: { type: "enum", options: ["A", "B"], optionLabels: { A: "B" } } }
  assert.equal(buildFilters(fields).params.stage?.parse("B"), "B")
})

test("a UI label shared by two options is not treated as an alias", (): void => {
  const fields: FieldMap = { stage: { type: "enum", options: ["A", "B"], optionLabels: { A: "Same", B: "Same" } } }
  assert.throws(() => buildFilters(fields).params.stage?.parse("Same"))
})

test("writableFields skips audit, readOnly, notStorable, and unmapped fields", (): void => {
  const names: string[] = writableFields(LEAD_FIELDS).map((spec: WriteFieldSpec): string => spec.name)
  for (const excluded of ["id", "createdAt", "computedScore", "internalCode", "mystery"]) {
    assert.ok(!names.includes(excluded), `expected ${excluded} to be excluded`)
  }
})

test("writableFields renders a link as <field>Id", (): void => {
  const names: string[] = writableFields(LEAD_FIELDS).map((spec: WriteFieldSpec): string => spec.name)
  assert.ok(names.includes("assignedUserId"))
  assert.ok(!names.includes("assignedUser"))
})

test("writableFields sorts required fields first and flags them", (): void => {
  const specs: WriteFieldSpec[] = writableFields(LEAD_FIELDS)
  assert.equal(specs[0]?.name, "status")
  assert.equal(specs[0]?.required, true)
  assert.equal(specs.find((spec: WriteFieldSpec): boolean => spec.name === "name")?.required, false)
})

test("writableFields renders enum options as a JSON Schema enum, empty options as a plain string", (): void => {
  const specs: WriteFieldSpec[] = writableFields(LEAD_FIELDS)
  assert.deepEqual(specs.find((spec: WriteFieldSpec): boolean => spec.name === "status")?.json, {
    type: "string",
    enum: ["New", "Assigned", "Dead"],
  })
  assert.deepEqual(specs.find((spec: WriteFieldSpec): boolean => spec.name === "source")?.json, { type: "string" })
})

test("writableFields maps scalar and formatted types to JSON Schema", (): void => {
  const specs: WriteFieldSpec[] = writableFields(LEAD_FIELDS)
  const json: (name: string) => Record<string, unknown> | undefined = (
    name: string,
  ): Record<string, unknown> | undefined => specs.find((spec: WriteFieldSpec): boolean => spec.name === name)?.json
  assert.deepEqual(json("emailAddress"), { type: "string", format: "email" })
  assert.deepEqual(json("amount"), { type: "number" })
  assert.deepEqual(json("doNotCall"), { type: "boolean" })
  assert.deepEqual(json("birthday"), { type: "string", format: "date" })
  assert.deepEqual(json("tags"), { type: "array", items: { type: "string", enum: ["hot", "cold"] } })
})

test("writableFields documents UI labels while keeping stored values in the JSON Schema enum", (): void => {
  const status: WriteFieldSpec = writableFields(TRANSLATED_FIELDS).find(
    (spec: WriteFieldSpec): boolean => spec.name === "status",
  )!
  assert.deepEqual(status.json, {
    type: "string",
    enum: ["New", "Assigned", "Dead"],
    description: 'UI labels: "Backlog" = New, "In Talks" = Assigned. Either form is accepted.',
  })
  assert.deepEqual(enumValues(status.zod), ["New", "Assigned", "Dead"])
})

test("a write field accepts a UI label and normalizes it to the stored value", (): void => {
  const status: WriteFieldSpec = writableFields(TRANSLATED_FIELDS).find(
    (spec: WriteFieldSpec): boolean => spec.name === "status",
  )!
  assert.equal(status.zod.parse("In Talks"), "Assigned")
  assert.equal(status.zod.parse("Dead"), "Dead")
})

test("a multiEnum write field accepts UI labels for its items", (): void => {
  const tags: WriteFieldSpec = writableFields(TRANSLATED_FIELDS).find(
    (spec: WriteFieldSpec): boolean => spec.name === "tags",
  )!
  assert.deepEqual(tags.zod.parse(["Burning", "cold"]), ["hot", "cold"])
  assert.deepEqual(tags.json, {
    type: "array",
    items: { type: "string", enum: ["hot", "cold"] },
    description: 'UI labels: "Burning" = hot. Either form is accepted.',
  })
})

test("an untranslated write field carries no label description", (): void => {
  const specs: WriteFieldSpec[] = writableFields(LEAD_FIELDS)
  assert.equal(specs.find((spec: WriteFieldSpec): boolean => spec.name === "status")?.zod.description, undefined)
})

test("entityObjectSchema documents UI labels on a translated enum property", (): void => {
  const schema: { properties: Record<string, unknown> } = entityObjectSchema(TRANSLATED_FIELDS) as {
    properties: Record<string, unknown>
  }
  assert.deepEqual(schema.properties.status, {
    type: "string",
    enum: ["New", "Assigned", "Dead"],
    description: 'UI labels: "Backlog" = New, "In Talks" = Assigned.',
  })
})

test("entityObjectSchema always includes an id and lists required fields", (): void => {
  const schema = entityObjectSchema(LEAD_FIELDS) as {
    type: string
    properties: Record<string, unknown>
    required?: string[]
  }
  assert.equal(schema.type, "object")
  assert.deepEqual(schema.properties.id, { type: "string" })
  assert.deepEqual(schema.required, ["status"])
})

test("entityObjectSchema expands a link into <field>Id and <field>Name", (): void => {
  const schema: { properties: Record<string, unknown> } = entityObjectSchema(LEAD_FIELDS) as {
    properties: Record<string, unknown>
  }
  assert.deepEqual(schema.properties.assignedUserId, { type: "string" })
  assert.deepEqual(schema.properties.assignedUserName, { type: "string" })
})

test("entityObjectSchema omits the required key when nothing is required", (): void => {
  const schema: Record<string, unknown> = entityObjectSchema({ name: { type: "varchar" } }) as Record<string, unknown>
  assert.ok(!("required" in schema))
  assert.deepEqual((schema.properties as Record<string, unknown>).name, { type: "string" })
})
