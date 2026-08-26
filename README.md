# AppActor MCP

Remote Model Context Protocol server for AppActor analytics, catalog, project,
and app management.

The server is intentionally stateless. OAuth is provided by AppActor Better
Auth, while AppActor API remains authoritative for organization membership,
permissions, business validation, and write idempotency.

## Development

```bash
bun install
cp .env.example .env
bun run dev
```

Health endpoints:

- `GET /health`
- `GET /metrics`
- `POST /mcp`

The complete delivery plan is in [plan.md](./plan.md).

## Connect a Client

Production uses one remote endpoint:

```text
https://mcp.appactor.com/mcp
```

Codex:

```bash
codex mcp add appactor --url https://mcp.appactor.com/mcp
codex mcp login appactor
```

Claude accepts the same URL in its custom connector/MCP settings. Both clients
discover AppActor OAuth automatically, open the AppActor login/consent URL in a
browser, and store their own OAuth token. The AppActor session cookie never
leaves the browser.

Available read-only tools are:

- `get_workspace`: list organizations, then pass an organization ID to list
  accessible projects and apps.
- `get_app_setup`: return safe SDK keys, store connection status, and setup
  links for an accessible app.
- `query_analytics`: read overview, revenue, users, trials, transactions,
  Apple Ads, experiments, and refund-defense analytics. Requires
  `analytics:read` plus the matching AppActor dashboard permission.
- `get_catalog`: read catalog context, products, entitlements, offerings, and
  packages. Requires `catalog:read` plus project-level `catalog.read`.
- `get_subscriber`: look up one subscriber by their exact app user ID and read
  their entitlements, subscription status, and recent purchases. Requires
  `subscribers:read` plus project-level `subscribers.read`. Matching is exact,
  so the tool cannot browse or enumerate a customer base, and custom
  attributes, email, phone, push tokens, integration identifiers, and token
  ledgers are never returned.
- `get_config`: read remote config values with their targeting rules, and
  experiments with their variants and result summaries. Requires `config:read`
  plus project-level `remote_config.read` / `experiments.read`.
- `get_audit_log`: read the record of changes AI clients made to the
  organization. Requires `audit:read`; the organization-wide scope also requires
  the account-level `team.manage` permission. This covers MCP writes only —
  AppActor has no organization-wide dashboard audit log.

Controlled write tools are:

- `manage_products`: discover, import, and classify products.
- `manage_entitlements`: create/update entitlements and add product bindings.
- `manage_offerings`: create/update offerings and run the two-step
  `preview_publish` / `apply_publish` flow.
- `manage_packages`: create/update packages and add product bindings.
- `create_project`: create a project in an organization.
- `create_app`: add an iOS or Android app. Google credential setup is completed
  in the dashboard; credential JSON never enters the MCP conversation.
- `manage_remote_config`: create/update remote config values, platform
  overrides, and targeting rules.
- `manage_experiments`: create/update experiments and variants, and start,
  pause, resume, stop, or return one to draft.

Every mutation requires a client-generated `idempotencyKey`. Reusing the same
key and request safely replays the stored result; reusing it for a different
request is rejected. Deletion, detach, direct-current, credential, and webhook
secret operations are intentionally unavailable.

Remote config and experiment deletion, and variant removal, are intentionally
unavailable — as are catalog deletes, entitlement detach, credential and webhook
secret management, and manual subscriber mutation.

OAuth asks for `workspace:read`, `analytics:read`, `catalog:read`,
`catalog:write`, `workspace:write`, `subscribers:read`, `config:read`,
`config:write`, and `audit:read`. Existing AppActor organization and project
permissions still apply to every tool call.

## Claude Code Plugin

This repository is also a Claude Code plugin. Installing it wires up the remote
MCP server **and** a set of skills that teach the AppActor SDKs and catalog
model, so an agent can go from "add subscriptions to this app" to working code
without the operator pasting documentation.

```text
.claude-plugin/plugin.json   plugin manifest
.mcp.json                    declares https://mcp.appactor.com/mcp
skills/                      one directory per skill
```

Skills:

| Skill | Covers |
| --- | --- |
| `appactor-workspace` | using the MCP tools: orientation, analytics, idempotent writes, preview/apply |
| `appactor-paywalls-and-offerings` | products, entitlements, offerings, packages, and building a paywall from them |
| `appactor-remote-config-and-experiments` | config keys, targeting rules, variants, traffic weights, primary metrics |
| `appactor-troubleshooting` | "paid but no access", stuck receipts, sandbox confusion, signature failures |
| `appactor-flutter` | `appactor_flutter` |
| `appactor-ios` | the `AppActor` Swift package |
| `appactor-android` | `com.appactor:appactor-android` |
| `appactor-react-native` | `appactor-react-native` |

The SDK skills are written from the SDK sources rather than from the docs site,
so the signatures, enum cases, error codes, and ordering constraints in them
match what the code actually does.

## Deployment

Use a P-256 private key in this service and the matching public key in the
AppActor API. `MCP_AUTH_ISSUER` must equal the `iss` claim Better Auth puts in
OAuth access tokens, which is the Auth service's `BETTER_AUTH_URL` **plus its
`/api/auth` base path** (production: `https://auth.appactor.com/api/auth`).
`MCP_AUTH_JWKS_URL` is that issuer plus `/jwks`. Deployment and migration order
are documented in the API repository at
`docs/runbooks/mcp-delivery-1-rollout.md`. Delivery 3 write rollout is
documented at `docs/runbooks/mcp-delivery-3-rollout.md` in the API repository.
The default AppActor API deadline is 35 seconds, deliberately longer than the
API's own 30-second request timeout, so a slow store discovery surfaces the
API's structured 504 instead of an opaque client-side abort.

The server accepts both the 2026-07-28 per-request MCP protocol and the
2025-era Streamable HTTP protocol (stateless fallback), so current Claude and
Codex releases connect without a client upgrade.

A `Dockerfile` is included; the container listens on `PORT` (default 3000).
