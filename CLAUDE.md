# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install
bun run dev                    # watch mode on PORT (default 3100)
bun run typecheck              # tsc --noEmit
bun run lint                   # biome check src tests
bun run lint:fix               # biome check --write
bun test                       # whole suite, ~500ms, no network
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
   20 tools over 12 scopes.
2. **A Claude Code / Codex plugin** (`plugins/appactor/`) — skills plus an
   `.mcp.json` pointing at that hosted server. Users install the plugin; they do
   not run this code.

**No business logic lives here.** Every tool is a typed, authenticated proxy to
one route on the AppActor API. Permissions, idempotency, audit rows, and every
database write happen there. If a change needs a new query, a new permission
check, or a new table, it belongs in the API repo, not this one.

## Releasing — do this on EVERY change that touches `plugins/`

`claude plugin update` and the Codex equivalent both key on the version in
`plugins/appactor/.claude-plugin/plugin.json`, **not** on the marketplace's git
head. Merging to `main` without bumping it means every installed copy — Claude
Code and Codex alike, they install the same plugin from the same marketplace —
reports "already at the latest version" and keeps serving the old skills. The
server can be days ahead of the skills describing it, and nothing surfaces that.

So a change is not finished until:

1. `plugins/appactor/.claude-plugin/plugin.json` **and** `package.json` carry the
   same new version. Bump for any skill edit, not only for tool changes: skills
   are the whole payload of the plugin.
2. `CHANGELOG.md` has an entry under that version.
3. The skills agree with the tools. A tool the server advertises but a skill says
   does not exist will not get used; a skill describing behaviour the API no
   longer has is worse than no skill.

`tests/skills.test.ts` pins the manifest, the skill list, frontmatter, and that
every skill is reachable from another — it does **not** read skill content, so
nothing catches a stale claim except reading the code the claim is about.

## The paired repo

`appactor-final-api` (locally `../appactor-final-api`, GitHub
`i-Senku/appactor-api`) owns:

- `src/routes/internal/mcp.ts` — the routes this server calls
- `src/services/admin/mcp-write/` — the write implementations and idempotency
- `src/lib/mcp-scopes.ts` — the OAuth scope list (`better-auth.ts` imports it;
  the backfill script reads it without building a Better Auth instance)
- `src/lib/mcp-auth-pages.ts` — the consent screen

**Deploy order is API first, always.** Both repos auto-deploy from `main`.
Shipping this repo first advertises a scope the authorization server does not
know yet, and re-authorizing a connection then fails outright with
`invalid_scope` — the connection cannot be approved at all.

The `.strict()` constraint below pulls the other way, so a change that adds a
scope *and* changes a response shape has both. API-first is still right: its
casualty is a recoverable contract error on one tool for the length of the
deploy, while MCP-first's is a connection nobody can re-approve. Reduce the
window instead of reversing the order (see the next section). 0.3.0 is the
worked example.

**Response contracts are `.strict()` on this side.** An extra field the API
starts returning is a runtime `ZodError`, surfaced to the user as *"AppActor API
returned an invalid response contract"* with retry advice that loops forever on a
replayed idempotent write. So an additive field on an API response is a breaking
change until this repo has deployed a schema that accepts it. Prefer reusing an
existing optional field over adding one.

### `.nullable()` is not `.optional()`

The read schemas (`src/contracts.ts`) are plain `z.object`, so they *strip*
unknown keys — an API that starts sending a field they do not declare is safe.
A **missing** key is not: `z.object({ asa: X.nullable() })` still requires `asa`
to be present. `null` and absent are different answers, and only `.optional()`
accepts the second.

Every additive field on a read schema therefore wants `.nullable().optional()`
even when the API will always send it, because "always" starts at the API's
deploy and this repo may be ahead of it. Getting this wrong on `connections.asa`
would have turned every `get_app_setup` call into a 502 for the length of the
gap. Write schemas are different: they are `.strict()` unions where a
transitional value has to be spelled out (see the two retained
`google_credential_*` codes in `write-responses.ts`).

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
against `canonicalMcpRequestTarget` on the API side. A typo in a path or a
renamed query parameter is a total runtime failure, so every tool needs a test
that pins its request target; the POST writes get this from `toolCases` in
`write-tools.test.ts`, and the GETs need it written by hand.

`createMcpHandler`'s default `legacy: 'stateless'` keeps 2025-era clients
working alongside the 2026-07-28 per-request protocol. Those clients send no
`mcp-name` header, so they take the `workspace:read` fallback at the edge.

## Adding a tool

In this order, or the pieces will not line up:

1. The API route in `appactor-final-api/src/routes/internal/mcp.ts`, wrapped in
   `mcpInternalAuth('<tool_name>', '<scope>')`. Update that repo's
   `mcp-route-grant-coverage.test.ts` (an exact route allowlist).
   `mcp-rate-limit.test.ts` derives the tier from the scope suffix and needs no
   edit — but both files scrape the route file with regexes, and Biome wraps a
   registration whose arguments do not fit on one line. Any regex there must
   allow `\(\s*'`; one that demanded `\('` silently stopped seeing a route, and
   the "every route is rate limited" check then compared 19 against 19 and passed
   over an unmetered route.
2. `src/scopes.ts` — add to `TOOL_SCOPES`, and to `MCP_SCOPES` only if the scope
   itself is new.
3. `src/contracts/write.ts` and `write-responses.ts` — must mirror the API's
   `mcp-write/contracts.ts` exactly, `.strict()` on both sides.
4. `src/appactor-api.ts` — a `postValidated` call with the exact route path.
5. `src/tools/*.ts` — `registerTool` with annotations. Reads get
   `READ_TOOL_ANNOTATIONS`; writes get `writeToolAnnotations(destructive,
   openWorld)`. `openWorldHint` is true when the API path reaches a store
   (Apple/Google), false for purely internal writes. In this codebase an update
   that overwrites existing state counts as `destructive`.
6. `tests/write-tools.test.ts` pins the full tool list and the annotation map;
   `tests/app.test.ts` pins the tool count and the advertised scope list. Spell
   the tool list out rather than splicing `toolCases` into it — the list is
   registration order, and a read registered between two writes cannot be
   expressed by splicing.

**A `.describe()` on a wrapper does not replace the inner one.**
`X.nullable().describe(...)` publishes *both* descriptions into the advertised
JSON schema. Reusing a described base schema for a different field therefore
ships the wrong prose to the model alongside the right prose. Give such a field
its own base.

### Adding a new scope has two production steps, not one

Better Auth snapshots the scope list onto each OAuth **client** row at
registration time and validates requested scopes against that row before the
server config. Existing connections cannot be granted a newer scope — and worse,
re-authorizing fails outright with `invalid_scope` — until those rows are
backfilled. Run `appactor-final-api/src/scripts/backfill-mcp-scope.ts --apply`
with the API deploy; with no arguments it grants every scope in
`src/lib/mcp-scopes.ts` that a client row is missing, so it does not need editing
per scope. It is a JSONB column, `better_auth."oauthClient".scopes`.

That only makes the scope **grantable**. `better_auth."oauthConsent"` holds what
each connection was actually granted, and nothing can update it server-side — the
user has to reconnect the client in a browser. Say so plainly when reporting a
scope rollout as done; a tool answering 403 after a correct deploy is this, not a
bug.

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
- **An `action_required` result is not an error and does not claim the key.**
  The API returns it before `runMcpWrite`, so the caller should retry with the
  *same* `idempotencyKey` once it has fixed the argument. It also carries
  `choices` — the values that would have worked — which live only in the
  structured half of the result, so a summary that does not print them leaves a
  text-only client with an instruction it cannot follow.
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
  description, the server instructions and the runtime reminder from it. A
  description assembled by hand-pasting a constant instead of referencing it has
  already shipped once.
- **A summary must not re-derive what the API computed.** Prefer the field made
  for the purpose — `changed` on the update tools, `active` and `effect` on
  Refund Saver — over inferring it from one input. Refund Saver stores `enabled`
  and `mode` separately and the dashboard can leave them disagreeing, so "the
  mode is X" is a true sentence that describes an app doing nothing.
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

Two failure modes this suite invites, both of which have shipped green:

- **Asserting the stub.** The fixture supplies a value and the test asserts it
  back. Assert the tool's *derivation* instead, and pin refusals by counting
  upstream calls (`expect(upstreamCalls).toBe(0)`) — the fixture's fetcher throws
  for any request, so `isError: true` is true whether validation ran or not.
- **Testing enforcement but not transport.** `confirmAppName` had thorough tests
  of the rule and none that it can be *sent*; deleting the field from either
  repo's `.strict()` schema deadlocked that mode in both directions with CI
  green.

The API repo's decision logic is extracted into modules a unit test can import
(`mcp-write/workspace-decisions.ts`, `mcp-refunds.service.ts`) specifically
because `credentials.service` opens a database pool at import time — anything
reachable from it cannot be exercised. Put new pure decisions there, not inline.

## Git

`origin` is `appactor/appactor-aikit` over the `github-appactor` SSH alias
(identity `appactor-team`). The local `gh` CLI is authenticated as a different
account with no write access to that org, so `gh pr create` and `gh pr merge`
fail there — merge locally (`git merge --squash`) and `git push origin main`, or
hand over a compare URL. `legacy` points at the retired `i-Senku/appactor-mcp`
mirror. The API repo has no such split: `gh` works there normally.
