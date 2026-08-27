# AppActor AI Toolkit

Manage your AppActor catalog, read your revenue, and integrate the SDKs — from
your AI coding agent.

Ask your assistant to import your store products, wire them to entitlements,
build an offering, and publish it. Ask what a specific customer is entitled to.
Ask it to add subscriptions to your Flutter app and it already knows the API.

## Install

**Claude Code**

```bash
claude plugin marketplace add appactor/appactor-aikit
claude plugin install appactor
```

**Codex CLI**

```bash
codex plugin marketplace add appactor/appactor-aikit
codex plugin add appactor@appactor
codex mcp login appactor
```

Installing the plugin brings the skills across as well. If you only want the
tools, `codex mcp add appactor --url https://mcp.appactor.com/mcp` registers the
server on its own.

**Any other MCP client**

Add the remote server directly:

```text
https://mcp.appactor.com/mcp
```

The client discovers AppActor's OAuth automatically and opens a browser to sign
in. Your AppActor session cookie never leaves that browser.

In Claude Code, run `/mcp`, pick `appactor`, and choose Authenticate if it does
not prompt you on the first tool call.

## What you get

**A remote MCP server** for your workspace. Reads: organizations, projects and
apps, SDK setup keys and store connection status, dashboard analytics, the
product catalog, one named subscriber, remote config and experiments, how an app
answers Apple's refund requests, and a record of what AI clients changed.
Writes: products, entitlements, offerings, packages, projects, apps, remote
config, experiments, and refund handling — plus changing an app's name, bundle
ID, store credential or Apple Ads connection, and deleting a project or an app
behind a two-step confirmation.

**Skills** that teach your agent the AppActor SDKs and product model:

| Skill | Covers |
| --- | --- |
| `appactor-workspace` | using the tools: orientation, analytics, idempotent writes, preview/apply |
| `appactor-paywalls-and-offerings` | products, entitlements, offerings, packages, and building a paywall |
| `appactor-remote-config-and-experiments` | config keys, targeting rules, variants, traffic weights, metrics |
| `appactor-refund-saver` | what AppActor tells Apple when a customer asks for a refund |
| `appactor-troubleshooting` | "paid but no access", stuck receipts, sandbox confusion, signature failures |
| `appactor-flutter` | `appactor_flutter` |
| `appactor-ios` | the `AppActor` Swift package |
| `appactor-android` | `com.appactor:appactor-android` |
| `appactor-react-native` | `appactor-react-native` |

The SDK skills are written from the SDK sources, so signatures, enum cases,
error codes, and ordering constraints match the code rather than a summary of
it.

## Rate limits

Limits are per connection — your AppActor user plus the OAuth client you
approved — so one runaway agent cannot starve your other clients:

| | Per minute |
| --- | --- |
| Reads | 120 |
| Writes | 30 |

Exceeding a limit returns `429` with standard `Retry-After` and
`X-RateLimit-*` headers. The tools translate that into a plain instruction to
wait, and never suggest replaying a write's idempotency key for a `429` —
nothing was written.

## Access

You choose what a connection can reach when you approve it: all organizations
or a specific selection, and the same for projects. Your existing AppActor
permissions still apply on top — a connection can never see more than you can.

Every mutation is recorded with the actor, the client, the tool, and the
resources it touched, and is replay-safe: retrying an interrupted write with the
same idempotency key returns the stored result instead of duplicating it.

Deleting a project or an app is available, and only through a two-step preview:
the first call reports exactly what would be destroyed, the second needs that
preview's token plus the name typed back by you. It is a separate
`workspace:delete` scope, so a connection approved before it existed does not
acquire it silently — you have to approve it again.

To be precise about what that buys: the token is unforgeable and expires in five
minutes, and the approval is pinned to the structure it described, so an app
added in between voids it. The typed-back name raises the cost of an accidental
deletion to two round-trips and a deliberate act. It is not a proof that a human
was present — that comes from your client's own approval prompt, which is told
these tools are destructive.

Refund Saver — what AppActor answers when Apple asks whether to refund an iOS
purchase — is its own `refunds:read` / `refunds:write` pair for the same reason.
Granting refunds automatically hands customer money back and cannot be reversed,
so it is not something a connection acquires by having been allowed to create
apps.

An app's store credential and Apple Ads connection can be bound and changed, but
only **by name** — the ids are redacted out of every read, and there is still no
way to upload, reveal or rotate a credential from here. Catalog deletion,
entitlement detach, key rotation, and webhook secret management are intentionally
unavailable to AI clients and stay in the dashboard.

## Repository layout

```text
plugins/appactor/     the plugin: skills and the MCP server declaration
src/                  the MCP server itself (Bun + Hono), deployed to mcp.appactor.com
tests/                its test suite
```

## Development

```bash
bun install
cp .env.example .env

# The server refuses to start without a signing key, and .env.example ships an
# empty one. Generate it into the file:
openssl ecparam -genkey -name prime256v1 | openssl pkcs8 -topk8 -nocrypt \
  | awk 'BEGIN{printf "MCP_INTERNAL_JWT_PRIVATE_KEY=\""} {printf "%s\\n", $0} END{print "\""}' >> .env

bun run dev
```

`bun run test`, `bun run typecheck`, and `bun run lint` gate every change.

Endpoints: `POST /mcp`, `GET /health`, `GET /metrics`.

The server is stateless. AppActor's Better Auth service owns OAuth, and the
AppActor API remains authoritative for organization membership, permissions,
business validation, and write idempotency. The server never forwards a client's
OAuth token upstream; it mints a short-lived internal token bound to the exact
request it is making.

It accepts both the 2026-07-28 per-request MCP protocol and the 2025-era
Streamable HTTP protocol, so current Claude and Codex releases connect without a
client upgrade.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Licence

MIT — see [LICENSE](./LICENSE).
