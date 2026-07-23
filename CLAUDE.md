# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run build          # tsc → dist/ (excludes tests; they live outside src/)
npm run typecheck      # tsc -p tsconfig.test.json --noEmit (checks src + tests)
npm run dev            # tsc --watch
npm start              # node dist/index.js (runs the built server)
npm test               # node --import tsx --test tests/**/*.test.ts
npm run test:watch     # same, in watch mode
npm run test:coverage  # same, with --experimental-test-coverage
```

Tests use the **Node built-in test runner** (`node:test`) run through `tsx` (no Jest/Vitest). They live in a `tests/` tree that **mirrors `src/`**, so `tests/espo/fields.test.ts` covers `src/espo/fields.ts`. Shared fakes (a recording `EspoClient`, a representative `/Metadata` document, a `Config` builder) are in `tests/testing/fixtures.ts`. No linter is configured; `npm run typecheck` (under `strict` + `noUncheckedIndexedAccess`) and `npm test` are the automated checks. Run both after any change.

Tests never reach `dist`: the build uses `tsconfig.json` (`rootDir: src`), which excludes `tests/` automatically. `typecheck` uses `tsconfig.test.json`, which additionally includes `tests/`.

CI (`.github/workflows/ci.yml`) runs `typecheck`, `test`, and `build` on every push and pull request to `master` (Node 22.x and 24.x).

### Test-driven development is mandatory

**Every change to behaviour must be test-driven — no exceptions.** Follow the red-green-refactor cycle:

1. **Red** — write a failing test in the mirrored `tests/` file that specifies the new or changed behaviour, and run `npm test` to watch it fail for the right reason.
2. **Green** — write the minimum production code in `src/` to make it pass.
3. **Refactor** — clean up with the tests green.

Rules that follow from this:

- A bug fix starts with a test that reproduces the bug (fails before the fix, passes after). A new feature starts with tests describing it.
- Assert the **intended** contract, never whatever the code happens to do today. When a test and a comment/spec disagree, the code is wrong — fix the code, don't encode the bug (see the `toolSlug` acronym handling for a worked example).
- Do not add or change a function, tool, field-type mapping, or config option without a corresponding test. Coverage should not regress.
- `npm run typecheck` **and** `npm test` must both pass before any change is considered done.

Run the server locally (stdio), or emit the OpenAPI snapshot:

```bash
ESPOCRM_BASE_URL=https://crm.example.com ESPOCRM_API_KEY=key node dist/index.js
node dist/index.js --print-openapi > espocrm.openapi.json   # needs ESPOCRM_API_KEY
```

`docker compose up --build` runs the HTTP transport in `oauth` mode (needs `MCP_OAUTH_ISSUER_URL` + `MCP_OAUTH_ENCRYPTION_KEY`).

## Architecture

An MCP server that projects any EspoCRM instance to MCP clients over EspoCRM's **public REST API only** (`/api/v1/*`). It never imports or depends on EspoCRM itself — that keeps it MIT-licensed rather than AGPL-derivative. Everything the tools expose is discovered at runtime from `/api/v1/Metadata`.

Two invariants drive the whole design; preserve them:

1. **Stateless per-user auth.** The server holds no privileged key in `oauth` mode and keeps no session store. Each caller logs in against EspoCRM and receives an encrypted, self-contained token that *carries* their EspoCRM credential (sealed with `MCP_OAUTH_ENCRYPTION_KEY`); `verifyAccessToken` unwraps it per request and EspoCRM enforces *that user's* ACL. There is no server-side authorization logic to add — never introduce shared state or a super-key that would bypass this, and never persist the unwrapped credential.
2. **Metadata is the single source of truth.** Search filters, write-tool inputs, and the OpenAPI schema are all generated from the same field mapping in `src/espo/fields.ts`. When you touch how a field type maps to a parameter/schema, change it there so tools and spec cannot drift.

### Request flow

- `src/index.ts` → `loadConfig` → picks transport.
- **stdio** (`src/transport/stdio.ts`): one `buildServer` for the process, credential from `ESPOCRM_API_KEY`.
- **http** (`src/transport/http.ts`): a *fresh* `McpServer` + transport **per request** (`sessionIdGenerator: undefined`, stateless). `createApp` branches on `authMode`: `apiKey` builds the context from `contextFromConfig` (shared key); `oauth` mounts the SDK's `mcpAuthRouter` + a `/oauth/login` route, gates `/mcp` and `/openapi.json` with `requireBearerAuth`, and builds the context from the credential the provider unwraps into `req.auth.extra.espoCredential`. `GET`/`DELETE` on the MCP path return 405 — this server is POST-only and stateless.
- `src/context.ts` builds a `ToolContext` = `{ espo: EspoClient, metadata: MetadataService }` from a resolved `EspoCredential` (`contextFromCredential`, or `contextFromConfig` for the shared key). The `EspoClient` is already authenticated as the caller, so **every tool inherits that user's ACL for free** — tools never check permissions themselves.
- **OAuth** (`src/oauth/`): the server is its own OAuth 2.1 AS + RS. `EspoOAuthServerProvider` (`provider.ts`) implements the SDK `OAuthServerProvider` — it authenticates username/password against EspoCRM (`GET App/user`) and issues AES-256-GCM-sealed access/refresh tokens (`tokens.ts`) that embed the EspoCRM credential; `login.ts`/`loginPage.ts` render and handle the login form; `clientStore.ts` is the in-memory DCR registry. See the Auth invariant above.
- `src/server.ts` (`buildServer`) registers whatever `collectTools` returns onto the `McpServer`.

### Tool generation (`src/tools/`)

- `registry.ts` `collectTools`: three generic helpers (`list_entity_types`, `describe_entity`, `get_stream`) always; then `search_<entity>` / `get_<entity>` per type in `config.entityTypes`. Write tools (`post_to_stream`, `create/update/delete_<entity>`) are added **only when `MCP_READ_ONLY=false`**. An entity that fails metadata lookup is logged and skipped, never fatal.
- Per-entity tools are named, not generic-with-an-`entityType`-arg, deliberately — the model picking `search_lead` directly selects more accurately than choosing a tool then an argument. The cost: tool count multiplies per entity, so `MCP_ENTITY_TYPES` must stay curated.
- `entityTools.ts`: `search_<entity>` merges typed filter params (from `buildFilters`) with a raw `where` escape hatch (ANDed together), plus text/paging/sort params. `toolSlug` converts PascalCase entity → snake_case tool (`COpportunity` → `c_opportunity`).
- `writeTools.ts`: create/update bodies come from `writableFields`; update is a partial (only passed fields sent). `link` fields become `<field>Id` params.
- All handlers are wrapped in `guard` (`result.ts`), which turns `EspoApiError` into an MCP tool error result instead of crashing the request.

### The field mapping (`src/espo/fields.ts`) — the core engine

One place classifies EspoCRM field types into three renderings, kept in lockstep:

- `buildFilters` → zod params + `where`-condition translator for **search** tools. Text fields are excluded (covered by `textFilter`); typed filters capped at `MAX_TYPED_FILTERS` (25), prioritized by `FILTERABLE_PRIORITY` (enum > bool > link > date > number). enum→constrained param, bool→boolean, link→`<field>Id`, date/number→`<field>From`/`<field>To` ranges. `RESERVED` names must not be shadowed by a field.
- `writableFields` → zod schema **and** JSON Schema per settable field for **write** tools + OpenAPI bodies. Skips `id`, audit fields, and anything `readOnly`/`notStorable`.
- `entityObjectSchema` → OpenAPI response schema for a record.

`src/openapi.ts` (`buildOpenApiDocument`) reuses `writableFields`/`entityObjectSchema` so the spec and the tools are generated from identical metadata — writes appear in the spec only when `MCP_READ_ONLY=false`, matching the tools.

### EspoCRM REST specifics

- `src/espo/client.ts`: thin `fetch` wrapper over `/api/v1/`. Credential headers only.
- `src/espo/query.ts` `applyQuery`: serializes nested params into EspoCRM's PHP bracket notation (`where[0][type]=equals`). Any query param object goes through here.
- `src/espo/credential.ts`: `EspoCredential` (discriminated union: `apiKey` | `espoAuthorization`) → request headers via `credentialHeaders`. `espoAuthorizationCredential(username, secret)` builds the `base64(username:secret)` value the OAuth login and refresh reuse.
- `src/espo/metadata.ts`: `MetadataService` caches `/Metadata` **per base URL** with `ESPOCRM_METADATA_TTL`. Metadata is instance schema (not user data), so the cache is shared across callers safely.

### Conventions in this codebase

- ESM throughout (`"type": "module"`); **relative imports must carry the `.js` extension** even though sources are `.ts` (NodeNext resolution).
- `src/logger.ts`: **all logging goes to stderr** — stdout is reserved for the MCP stdio transport. Never `console.log`.
- Errors: `ConfigError` (startup/500), `AuthError` (401), `EspoApiError` (carries upstream status/body). HTTP transport maps these to JSON-RPC error codes in `respondError`.

## Configuration

All config is environment variables, parsed and validated in `src/config.ts` (see `.env.example` / the README table). Notable rules enforced there: `apiKey` mode requires `ESPOCRM_API_KEY`; `oauth` mode requires `http` transport, `MCP_OAUTH_ISSUER_URL`, and a 32-byte `MCP_OAUTH_ENCRYPTION_KEY` (validated via `decodeKey`).
