# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install
bun run dev                    # watch mode on PORT (default 3100)
bun run typecheck              # tsc --noEmit
bun run lint                   # biome check src tests
bun run lint:fix               # biome check --write
bun test                       # whole suite, ~400ms, no network
bun test tests/write-tools.test.ts          # one file
bun test --test-name-pattern "delete"       # one test by name
```

CI runs `typecheck`, `lint`, `test` — all three must pass. The server refuses to
start without `MCP_INTERNAL_JWT_PRIVATE_KEY`; `CONTRIBUTING.md` has the openssl
one-liner that generates it into `.env`.

## What this repo is

Two things ship from here, and they have nothing to do with each other at
runtime:

1. **A remote MCP server** (`src/`) deployed at `https://mcp.appactor.com/mcp`.
2. **A Claude Code / Codex plugin** (`plugins/appactor/`) — skills plus an
   `.mcp.json` pointing at that hosted server. Users install the plugin; they do
   not run this code.

**No business logic lives here.** Every tool is a typed, authenticated proxy to
one route on the AppActor API. Permissions, idempotency, audit rows, and every
database write happen there. If a change needs a new query, a new permission
check, or a new table, it belongs in the API repo, not this one.

## The paired repo

`appactor-final-api` (locally `../appactor-final-api`, GitHub
`i-Senku/appactor-api`) owns:

- `src/routes/internal/mcp.ts` — the routes this server calls
- `src/services/admin/mcp-write/` — the write implementations and idempotency
- `src/lib/better-auth.ts` — the OAuth server and its scope list
- `src/lib/mcp-auth-pages.ts` — the consent screen

**Deploy order is API first, always.** Both repos auto-deploy from `main`.
Shipping this repo first advertises a scope the authorization server does not
know yet, and re-authorizing a connection then fails outright with
`invalid_scope` — the connection cannot be approved at all.

The `.strict()` constraint below pulls the other way, so a change that adds a
scope *and* changes a response shape has both. API-first is still right: its
casualty is a recoverable contract error on one tool for the length of the
deploy, while MCP-first's is a connection nobody can re-approve. Reduce the
window instead of reversing the order — make every ADDITIVE field on a read
`.optional()` here first, so only genuinely changed shapes are exposed to it.
0.3.0 is the worked example.

**Response contracts are `.strict()` on this side.** An extra field the API
starts returning is a runtime `ZodError`, surfaced to the user as *"AppActor API
returned an invalid response contract"* with retry advice that loops forever on a
replayed idempotent write. So an additive field on an API response is a breaking
change until this repo has deployed a schema that accepts it. Prefer reusing an
existing optional field over adding one.

## Request path

```
client → POST /mcp
  → src/app.ts: rejects cookies, checks Host/Origin, reads the `mcp-name` header
  → src/scopes.ts requiredScopeForRequest() picks one of N pre-built protected
    handlers, each demanding a single scope (this is what makes an
    insufficient-scope 403 name the right scope in its WWW-Authenticate challenge)
  → OAuth bearer verified against MCP_AUTH_JWKS_URL
  → src/mcp-server.ts builds a fresh McpServer per request (stateless)
  → src/tools/*.ts handler: requirePrincipal(authInfo, scope) re-checks the
    token's own scopes, then calls a client method
  → src/appactor-api.ts postValidated(): validates the request, signs a 45s
    ES256 internal JWT bound to tool + method + canonical target + body SHA-256,
    POSTs to the API, validates the response
```

Two independent scope checks are deliberate. The edge one produces the challenge
that sends a client back through consent; `requirePrincipal` is what actually
authorizes, and it reads the token claims, never the header. A tool missing from
`TOOL_SCOPES` still fails closed — it just falls back to `workspace:read` at the
edge and loses its challenge, which is why a test pins that every registered tool
is mapped.

The body hash binding means the request and response schemas must agree with the
API byte for byte, and that a path is signed exactly as written — verified
against `canonicalMcpRequestTarget` on the API side.

`createMcpHandler`'s default `legacy: 'stateless'` keeps 2025-era clients
working alongside the 2026-07-28 per-request protocol. Those clients send no
`mcp-name` header, so they take the `workspace:read` fallback at the edge.

## Adding a tool

In this order, or the pieces will not line up:

1. The API route in `appactor-final-api/src/routes/internal/mcp.ts`, wrapped in
   `mcpInternalAuth('<tool_name>', '<scope>')`. Update that repo's
   `mcp-route-grant-coverage.test.ts` (an exact route allowlist) and
   `mcp-rate-limit.test.ts` (the limiter tier follows the scope suffix).
2. `src/scopes.ts` — add to `TOOL_SCOPES`, and to `MCP_SCOPES` only if the scope
   itself is new.
3. `src/contracts/write.ts` and `write-responses.ts` — must mirror the API's
   `mcp-write/contracts.ts` exactly, `.strict()` on both sides.
4. `src/appactor-api.ts` — a `postValidated` call with the exact route path.
5. `src/tools/*.ts` — `registerTool` with annotations. Reads get
   `READ_TOOL_ANNOTATIONS`; writes get `writeToolAnnotations(destructive,
   openWorld)`. `openWorldHint` is true when the API path reaches a store
   (Apple/Google), false for purely internal writes.
6. `tests/write-tools.test.ts` pins the full tool list and the annotation map;
   `tests/app.test.ts` pins the tool count and the advertised scope list.

**Adding a new scope has a production step.** Better Auth snapshots the scope
list onto each OAuth client row at registration time and validates requested
scopes against that row before the server config. Existing connections therefore
cannot be granted the new scope — and worse, re-authorizing fails outright with
`invalid_scope` — until the rows are backfilled. Run
`appactor-final-api/src/scripts/backfill-mcp-scope.ts --apply` as part of the
deploy; with no arguments it grants every scope in `src/lib/mcp-scopes.ts` that a
client row is missing, so it does not need editing per scope. It is a JSONB
column, `better_auth."oauthClient".scopes`.

## Conventions worth knowing

- **Every write takes a client-generated `idempotencyKey`.** The exceptions are
  the read-shaped actions — `manage_products` `discover`, `manage_offerings`
  `preview_publish`, and the `preview` action of the delete tools — and their
  schemas are `.strict()`, so passing a key is a validation error.
- **Destructive and two-step operations follow the `preview` → `apply`
  pattern.** Preview returns a short-lived HMAC token and never touches
  `runMcpWrite`; apply takes the token. `CONTRIBUTING.md` still says "anything
  destructive belongs in the dashboard, not here" — that predates
  `delete_project` / `delete_app` and is now wrong.
- **A partial update writes only the keys it was sent.** `updateApp` on the API
  side builds its `SET` clause field by field behind `!== undefined` guards, so
  an absent key is never written. Keep MCP schemas from filling in defaults, or
  "change the credential" becomes "change the credential and clear the bundle
  id". Where an explicit `null` means something (unbinding an Apple Ads
  connection), it has to survive as `null` and not collapse into "omitted".
- **Tool descriptions and summary strings are the model-facing surface.** They
  are prose an agent reads, so DRY matters less than legibility — but a rule
  stated in more than one place *will* drift. `DELETE_CONFIRMATION_RULE` in
  `src/tools/workspace-writes.ts` is the pattern: state it once, compose the
  description, the server instructions and the runtime reminder from it.
- **Credential ids are redacted** from every MCP read on the API side, so no
  tool can accept or return one — and that redaction is what forces the
  **name-as-handle** convention. `store_credentials` is UNIQUE on
  (organization_id, name), so a name identifies one credential exactly;
  `asa_connections` is **not**, so a name there can be ambiguous and
  `chooseMcpAsaConnection` refuses rather than picking. Both live in
  `appactor-final-api/src/services/admin/`. Never add a tool that takes an id for
  something the reads redact.
- **Errors go through `errorResult`** in `src/tool-runtime.ts`, which turns a 429
  into a concrete wait and a 5xx on an idempotent write into "retry with the same
  key". Pass `idempotentWrite` accurately — telling a model to retry a
  non-idempotent call is worse than the original error.

## Tests

Everything is a unit test with no network and no database. `tests/helpers/
mcp-app-fixture.ts` builds a real Hono app with a throwaway JWKS server and
generated ES256 keypairs, and takes a `fetcher` stub standing in for the API — so
tests exercise the true auth path, routing, signing and both schema validations,
against a hand-written API response.

That last part is the weak spot: fixtures are hand-written, so a fixture that
does not match what the API really returns makes a test worse than useless. When
touching a contract, read the actual return site in the API repo rather than
trusting `tests/helpers/write-response-fixtures.ts`.

`tests/skills.test.ts` checks the plugin manifest, skill frontmatter, and that
every skill is reachable from another — it does not check skill *content*.

## Skills and releases

Skills in `plugins/appactor/skills/<name>/SKILL.md` are what an agent actually
reads. A tool the server advertises but the skill says does not exist will not
get used, so a tool change is not finished until the skill agrees with it.

Write skills from the SDK sources rather than from documentation — the value is
what only the code shows (an ordering constraint, an error code, a method that
exists on one type and not another).

**`claude plugin update` keys on the version in
`plugins/appactor/.claude-plugin/plugin.json`, not on the marketplace's git
head.** Merging to `main` without bumping it means every installed copy reports
"already at the latest version" and keeps serving the old skills. Bump
`plugin.json` and `package.json` together, and turn the CHANGELOG's
`## Unreleased` into the version.

## Git

`origin` is `appactor/appactor-aikit` over the `github-appactor` SSH alias
(identity `appactor-team`). The local `gh` CLI is authenticated as a different
account with no write access to that org, so `gh pr create` and `gh pr merge`
fail there — merge locally and `git push origin main`, or hand over a compare
URL. `legacy` points at the retired `i-Senku/appactor-mcp` mirror.
