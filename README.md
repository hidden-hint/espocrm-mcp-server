# EspoCRM MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server for [EspoCRM](https://www.espocrm.com/). It exposes any EspoCRM instance to MCP clients (Claude Desktop, Claude Code, …) over EspoCRM's **public REST API** — so it works against any version or customization without modifying the CRM.

Because it talks only to the REST API, it is not a derivative of the AGPL-licensed EspoCRM application and ships under the MIT license.

## Design

- **Stateless credential relay.** The server holds no privileged key in multi-user mode. Each request carries the caller's own EspoCRM credential; the server forwards it and EspoCRM enforces **that user's ACL**. A sales rep sees exactly their own leads — the same slice they'd see in the web UI.
- **Metadata-driven.** Entity types, fields, and enum options are read from `/api/v1/Metadata` at runtime, so the generic tools adapt to any instance's custom entities and fields.
- **Two transports.** `stdio` for local single-user use; Streamable HTTP for a shared, containerized deployment.

## Tools

Search and fetch tools are **generated per entity type** from the `MCP_ENTITY_TYPES` allowlist — the model picks `search_lead` directly rather than a generic tool with an `entityType` argument, which improves tool-selection accuracy. A few cross-cutting helpers stay generic so the tool count doesn't multiply per entity.

**Generic helpers**

| Tool | Description |
|------|-------------|
| `list_entity_types` | Discover the entity types on the instance |
| `describe_entity` | Fields (types, enum options) and relationships of an entity |
| `get_stream` | A record's activity stream (posts, emails, status changes) |

**Per entity** (for each type in `MCP_ENTITY_TYPES`; default `Lead, Contact, Account, Opportunity`)

| Tool | Description |
|------|-------------|
| `search_<entity>` | Filtered search — **typed filter parameters generated from the entity's metadata**, plus a generic `where` escape hatch, text search, paging, sorting |
| `get_<entity>` | Fetch one record by id |

Each `search_<entity>` exposes the entity's high-signal fields as typed parameters, derived from `/Metadata` at runtime:

- **enum** fields → a parameter constrained to the actual options (e.g. `status: "New" | "Assigned" | …`)
- **bool** fields → a boolean parameter
- **link** fields → a `<field>Id` string parameter
- **date / datetime / number / currency** fields → `<field>From` / `<field>To` range parameters

Typed parameters are ANDed with the optional `where` array (raw EspoCRM conditions) for anything not covered. The typed set is capped to keep the tool schema small; text fields are covered by `textFilter`.

So the default allowlist yields `search_lead`, `get_lead`, `search_contact`, `get_contact`, … alongside the three helpers. Curate `MCP_ENTITY_TYPES` deliberately — a tool per entity per operation grows quickly, and MCP clients degrade with very large tool counts.

All results are scoped to the authenticated user's access rights.

### Write tools (opt-in)

Write tools are registered **only when `MCP_READ_ONLY=false`** — off by default. They are still ACL-checked per user by EspoCRM; the flag is a hard global off-switch on top of that.

**Generic**

| Tool | Description |
|------|-------------|
| `post_to_stream` | Post a text note to a record's activity stream |

**Per entity** (for each type in `MCP_ENTITY_TYPES`)

| Tool | Description |
|------|-------------|
| `create_<entity>` | Create a record. Body is typed from metadata; required fields are required, links are `<field>Id` |
| `update_<entity>` | Partial update by id — only the fields you pass are changed |
| `delete_<entity>` | Delete by id (moves to EspoCRM's recycle bin) |

Create/update bodies exclude system and read-only fields (`id`, `createdAt`, `modifiedBy`, anything `readOnly`/`notStorable`) and are built from the same metadata mapping as the search filters and the OpenAPI request bodies.

## OpenAPI

The server generates an **OpenAPI 3.1** document describing the EspoCRM REST operations it proxies for the allowlisted entities, with entity schemas typed from the same live metadata that drives the search filters (enum options, `date-time`/`email` formats, link `…Id`/`…Name` pairs, required fields). Tools and spec share one source of truth, so they never drift — including writes: when `MCP_READ_ONLY=false`, the spec gains the matching `POST`/`PATCH`/`DELETE` operations with request bodies from the same field mapping.

```bash
# Live endpoint (http transport)
curl http://localhost:3000/openapi.json

# Snapshot for codegen / commit
node dist/index.js --print-openapi > espocrm.openapi.json   # needs ESPOCRM_API_KEY
```

Feed the snapshot to `openapi-generator` for typed client SDKs, or into API docs tooling.

## Quick start

### Local (stdio, single user)

```bash
npm install
npm run build

ESPOCRM_BASE_URL=https://crm.example.com \
ESPOCRM_API_KEY=your-api-user-key \
node dist/index.js
```

Wire it into Claude Desktop (`claude_desktop_config.json`):

```jsonc
{
  "mcpServers": {
    "espocrm": {
      "command": "node",
      "args": ["/absolute/path/to/espocrm-mcp-server/dist/index.js"],
      "env": {
        "ESPOCRM_BASE_URL": "https://crm.example.com",
        "ESPOCRM_API_KEY": "your-api-user-key"
      }
    }
  }
}
```

### Remote (HTTP, per-user ACL via Docker)

```bash
ESPOCRM_BASE_URL=https://crm.example.com docker compose up --build
```

The container runs in `passthrough` mode: each MCP client sends its own credential. Connect from Claude Code, forwarding the user's key/token as a header:

```bash
# Per-user EspoCRM auth token (recommended — enforces that user's ACL)
claude mcp add --transport http espocrm https://mcp.example.com/mcp \
  --header "Espo-Authorization: $(printf '%s:%s' "$USERNAME" "$TOKEN" | base64)"

# Or a per-user API key
claude mcp add --transport http espocrm https://mcp.example.com/mcp \
  --header "X-Api-Key: <user-api-key>"
```

> **Note.** EspoCRM auth tokens idle-expire after `authTokenMaxIdleTime` hours (default 48). For a long-lived MCP connection, raise or disable that setting on the instance and mint dedicated per-user tokens.

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `ESPOCRM_BASE_URL` | — (required) | Target EspoCRM base URL |
| `ESPOCRM_AUTH_MODE` | `apiKey` | `apiKey` (shared) or `passthrough` (per-user; http only) |
| `ESPOCRM_API_KEY` | — | Required for `apiKey` mode |
| `MCP_PASSTHROUGH_AS` | `apiKey` | How to forward a bare `Authorization: Bearer` header |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `MCP_HTTP_PORT` | `3000` | HTTP port |
| `MCP_HTTP_PATH` | `/mcp` | HTTP endpoint path |
| `MCP_READ_ONLY` | `true` | Reserved for Phase 2 write tools |
| `MCP_ENTITY_TYPES` | `Lead,Contact,Account,Opportunity` | Entity types exposed as dedicated `search_<entity>` / `get_<entity>` tools |
| `ESPOCRM_METADATA_TTL` | `300` | Metadata cache lifetime (seconds) |

## Auth modes

- **`apiKey`** — a single shared EspoCRM API key. Everyone connected sees the same scope. Fine for personal/stdio use.
- **`passthrough`** — the per-user answer. The server forwards each caller's `X-Api-Key`, `Espo-Authorization`, or `Authorization: Bearer` header to EspoCRM. No shared super-key; ACL is per user.
- **OAuth** — planned. Requires EspoCRM to act as an OAuth authorization server; tracked as a joint roadmap item.

## Roadmap

1. ✅ **MVP** — read-only tools, stdio + HTTP, apiKey + passthrough auth, metadata cache.
2. ✅ **Typed per-entity tools + OpenAPI** — metadata-typed search filters, generated OpenAPI 3.1.
3. ✅ **Writes** — `create_<entity>`, `update_<entity>`, `delete_<entity>`, `post_to_stream`, gated by `MCP_READ_ONLY`.
4. **Tool selection / curation** — let the operator choose exactly which tools are exposed, not just which entities. A large tool surface bloats context and degrades model tool-selection, so the person running the server should enable only what they need. Under consideration: per-operation selection (e.g. expose only `search`/`get`), an explicit tool allow/deny list (`MCP_TOOLS`), and per-entity operation sets. Composes with the existing `MCP_ENTITY_TYPES` and `MCP_READ_ONLY` levers.
5. **Relationships** — `link_records` / `unlink_records`, `linkMultiple` fields in write bodies.
6. **OAuth + richness** — MCP OAuth, attachments, mass actions, MCP resources & prompts.
7. **Hardening** — rate limiting, structured logging/tracing, portal support.

## Development

```bash
npm install
npm run typecheck
npm run build
```

## License

MIT
