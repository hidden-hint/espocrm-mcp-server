# EspoCRM MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server for [EspoCRM](https://www.espocrm.com/). It exposes any EspoCRM instance to MCP clients (Claude Desktop, Claude Code, …) over EspoCRM's **public REST API** — so it works against any version or customization without modifying the CRM.

Because it talks only to the REST API, it is not a derivative of the AGPL-licensed EspoCRM application and ships under the MIT license.

## Design

- **Stateless per-user auth.** In `oauth` mode the server stores no EspoCRM credential and keeps no session store. Each caller logs in with their own EspoCRM username/password and every request carries a token that *contains* that user's (encrypted) EspoCRM credential; the server unwraps it and EspoCRM enforces **that user's ACL**. A sales rep sees exactly their own leads — the same slice they'd see in the web UI.
- **Metadata-driven.** Entity types, fields, and enum options are read from `/api/v1/Metadata` at runtime, so the generic tools adapt to any instance's custom entities and fields.
- **Two transports.** `stdio` for local single-user use; Streamable HTTP (with built-in OAuth 2.1) for a shared, containerized deployment.

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
# Live endpoint (http transport). In oauth mode it requires a bearer token:
#   curl -H "Authorization: Bearer <access-token>" http://localhost:3000/openapi.json
curl http://localhost:3000/openapi.json

# Snapshot for codegen / commit (run in apiKey mode; needs ESPOCRM_API_KEY)
node dist/index.js --print-openapi > espocrm.openapi.json
```

Feed the snapshot to `openapi-generator` for typed client SDKs, or into API docs tooling.

## Build

```bash
npm install
npm run build          # compiles to dist/
```

You need an EspoCRM instance reachable over HTTPS and at least one credential (see [Authentication](#authentication)).

## Authentication

The server contains **no authorization logic of its own** — EspoCRM always enforces the ACL. There are two modes:

| Mode | `ESPOCRM_AUTH_MODE` | Who the caller acts as | Transports | Per-user ACL |
|------|---------------------|------------------------|------------|--------------|
| Shared key | `apiKey` (default) | One API User, for everyone | stdio, http | No |
| OAuth 2.1 | `oauth` | Each user, via their own login | http only | Yes |

- **`apiKey`** — the server holds one EspoCRM API key (`ESPOCRM_API_KEY`) and uses it for every request. Simplest; ideal for a single user over stdio (Claude Desktop, local Claude Code). Everyone who can reach the server acts as that one EspoCRM identity. Create the key in EspoCRM under *Administration → API Users*.
- **`oauth`** — the server is an OAuth 2.1 Authorization Server **and** Resource Server. Each user logs in with their **EspoCRM username and password** on a page the server hosts; the server exchanges that for the user's EspoCRM auth token and issues its own access/refresh tokens. Requires `MCP_TRANSPORT=http`.

### How the OAuth flow works

Stock MCP clients (Claude Code, Claude Desktop, …) drive this automatically — you only give them the URL. Under the hood:

1. The client `POST`s to `/mcp` with no token and gets **401** with a `WWW-Authenticate` header pointing at `/.well-known/oauth-protected-resource/mcp`.
2. It discovers the Authorization Server, registers via Dynamic Client Registration, and opens `/authorize`.
3. The server shows a **login page**; the user enters their EspoCRM username + password. The server validates them against EspoCRM (`GET /api/v1/App/user`) and redirects back with an authorization code (PKCE-protected).
4. The client exchanges the code at `/token` for an **access token** (default 1 h) and a **refresh token**.
5. The client calls `/mcp` with `Authorization: Bearer <access token>`; EspoCRM enforces that user's ACL.

**Tokens are self-contained and encrypted.** The access token carries the user's EspoCRM auth token, and the refresh token carries the credential needed to silently mint a fresh one when EspoCRM's token idle-expires (`authTokenMaxIdleTime`, default 48 h). Both are sealed with `MCP_OAUTH_ENCRYPTION_KEY` (AES-256-GCM), so the server keeps **no session state** — but treat that key as a secret, and always run behind TLS (passwords transit the login page).

> **Limitations.** Token revocation is not yet implemented, so a token is valid until it expires — keep `MCP_ACCESS_TOKEN_TTL` modest. The Dynamic Client Registration store is in-memory, so clients re-register automatically after a server restart.

## Connecting an AI client

### Claude Desktop (stdio, shared key)

Edit `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`; Windows: `%APPDATA%\Claude\claude_desktop_config.json`):

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

Restart Claude Desktop. This runs the server on stdio in `apiKey` mode — everyone using this desktop acts as that one API key. To enable write tools, add `"MCP_READ_ONLY": "false"` to `env`.

### Claude Code — local (stdio, shared key)

```bash
claude mcp add espocrm \
  --env ESPOCRM_BASE_URL=https://crm.example.com \
  --env ESPOCRM_API_KEY=your-api-user-key \
  -- node /absolute/path/to/espocrm-mcp-server/dist/index.js
```

### Claude Code — remote (HTTP, per-user OAuth)

Run the server over HTTP in `oauth` mode first (see [Deploying](#deploying-the-http-server-oauth)), then add it **with no credential** — the client runs the OAuth login flow itself:

```bash
claude mcp add --transport http espocrm https://mcp.crm.example.com/mcp
```

The first time you use it, Claude Code opens a browser to the server's login page; sign in with your EspoCRM username and password. Each user does this once and thereafter acts under their own ACL. No API keys or headers to distribute.

### Other MCP clients (Cursor, VS Code, …)

Most MCP clients accept the same two shapes in their config file (Cursor: `~/.cursor/mcp.json`; VS Code: `.vscode/mcp.json`).

Stdio (shared key):

```json
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

Remote HTTP (per-user OAuth) — no credential needed; the client runs the login flow:

```json
{
  "mcpServers": {
    "espocrm": {
      "url": "https://mcp.crm.example.com/mcp"
    }
  }
}
```

VS Code uses a top-level `"servers"` key instead of `"mcpServers"`; the per-server shape is the same. The client must support MCP OAuth (most current ones do).

## Deploying the HTTP server (OAuth)

`docker-compose.yml` is preconfigured for `oauth` mode (`ESPOCRM_AUTH_MODE=oauth`, `MCP_TRANSPORT=http`). It needs the public URL and an encryption key:

```bash
export ESPOCRM_BASE_URL=https://crm.example.com
export MCP_OAUTH_ISSUER_URL=https://mcp.crm.example.com     # the public URL of THIS server
export MCP_OAUTH_ENCRYPTION_KEY=$(openssl rand -base64 32)  # keep this secret and stable
docker compose up --build
```

Put it behind **TLS** (a reverse proxy) — passwords are entered on the login page, and `MCP_OAUTH_ISSUER_URL` must be the `https://` URL clients reach. The MCP endpoint is **POST-only and stateless** — `GET`/`DELETE` return 405.

Without Docker:

```bash
ESPOCRM_BASE_URL=https://crm.example.com \
ESPOCRM_AUTH_MODE=oauth \
MCP_TRANSPORT=http \
MCP_OAUTH_ISSUER_URL=https://mcp.crm.example.com \
MCP_OAUTH_ENCRYPTION_KEY=$(openssl rand -base64 32) \
node dist/index.js
```

Verify the OAuth surface is live:

```bash
curl https://mcp.crm.example.com/.well-known/oauth-protected-resource/mcp   # → JSON with authorization_servers
curl -i -X POST https://mcp.crm.example.com/mcp -d '{}' -H 'Content-Type: application/json'   # → 401 + WWW-Authenticate
```

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `ESPOCRM_BASE_URL` | — (required) | Target EspoCRM base URL |
| `ESPOCRM_AUTH_MODE` | `apiKey` | `apiKey` (shared) or `oauth` (per-user; http only) |
| `ESPOCRM_API_KEY` | — | Required for `apiKey` mode |
| `MCP_OAUTH_ISSUER_URL` | — | Required for `oauth` mode — the public HTTPS URL of this server (issuer / resource identifier) |
| `MCP_OAUTH_ENCRYPTION_KEY` | — | Required for `oauth` mode — 32-byte key sealing the tokens (`openssl rand -base64 32`) |
| `MCP_ACCESS_TOKEN_TTL` | `3600` | Access-token lifetime in seconds (`oauth` mode) |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `MCP_HTTP_PORT` | `3000` | HTTP port |
| `MCP_HTTP_PATH` | `/mcp` | HTTP endpoint path |
| `MCP_READ_ONLY` | `true` | Set `false` to register write tools (`create`/`update`/`delete`/`post_to_stream`) |
| `MCP_ENTITY_TYPES` | `Lead,Contact,Account,Opportunity` | Entity types exposed as dedicated `search_<entity>` / `get_<entity>` tools |
| `ESPOCRM_METADATA_TTL` | `300` | Metadata cache lifetime (seconds) |

See [Authentication](#authentication) for how the modes and the OAuth flow work.

## Roadmap

1. ✅ **MVP** — read-only tools, stdio + HTTP, metadata cache.
2. ✅ **Typed per-entity tools + OpenAPI** — metadata-typed search filters, generated OpenAPI 3.1.
3. ✅ **Writes** — `create_<entity>`, `update_<entity>`, `delete_<entity>`, `post_to_stream`, gated by `MCP_READ_ONLY`.
4. ✅ **MCP OAuth** — OAuth 2.1 AS + RS; per-user login against EspoCRM, encrypted self-contained tokens, refresh. (Remaining: token revocation, persistent client store.)
5. **Tool selection / curation** — let the operator choose exactly which tools are exposed, not just which entities. A large tool surface bloats context and degrades model tool-selection, so the person running the server should enable only what they need. Under consideration: per-operation selection (e.g. expose only `search`/`get`), an explicit tool allow/deny list (`MCP_TOOLS`), and per-entity operation sets. Composes with the existing `MCP_ENTITY_TYPES` and `MCP_READ_ONLY` levers.
6. **Relationships** — `link_records` / `unlink_records`, `linkMultiple` fields in write bodies.
7. **Richness** — attachments, mass actions, MCP resources & prompts.
8. **Hardening** — token revocation, structured logging/tracing, portal support.

## Development

```bash
npm install
npm run typecheck
npm run build
```

## License

MIT
