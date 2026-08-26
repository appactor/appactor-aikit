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

OAuth asks for `workspace:read`, `analytics:read`, and `catalog:read`. Existing
organization and project permissions still apply to every tool call.

## Deployment

Use a P-256 private key in this service and the matching public key in the
AppActor API. `MCP_AUTH_ISSUER` must exactly match the API's `BETTER_AUTH_URL`,
including any `/api/auth` path. Deployment and migration order are documented
in the API repository at `docs/runbooks/mcp-delivery-1-rollout.md`.
