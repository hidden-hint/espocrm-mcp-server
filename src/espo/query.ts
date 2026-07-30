// Serializes a nested params object into EspoCRM's PHP-style bracket query notation,
// e.g. { where: [{ type: "equals", attribute: "status" }] } becomes
// where[0][type]=equals&where[0][attribute]=status
export function applyQuery(params: URLSearchParams, value: unknown, prefix: string = ""): void {
  if (value === undefined || value === null) {
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item: unknown, index: number): void =>
      applyQuery(params, item, prefix === "" ? String(index) : `${prefix}[${index}]`),
    )

    return
  }

  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      applyQuery(params, nested, prefix === "" ? key : `${prefix}[${key}]`)
    }

    return
  }

  params.append(prefix, String(value))
}
