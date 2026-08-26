# AppActor MCP Delivery Plan

## Goal

Build a small, stateless remote MCP server that lets Claude and Codex use the
existing AppActor control-plane APIs. Business rules and authorization stay in
AppActor API. The MCP service only handles MCP protocol, OAuth token validation,
tool schemas, and fixed API adapters.

## Architecture Boundaries

- Better Auth owns login, browser consent, OAuth tokens, refresh, and revoke.
- The existing AppActor session cookie is used only in the browser during login
  and consent. It is never sent to Claude, Codex, or the MCP service.
- `appactor-mcp` is stateless and has no PostgreSQL, ClickHouse, or Redis access.
- AppActor API remains authoritative for membership, permissions, validation,
  business logic, and write idempotency/audit.
- MCP calls AppActor API through a dedicated short-lived internal JWT and a
  fixed tool-to-route allowlist. It never forwards the raw OAuth access token.
- V1 uses four coarse OAuth scopes: `workspace:read`, `analytics:read`,
  `catalog:write`, and `workspace:write`.
- V1 does not add a second project allowlist. Users can access only the
  organizations and projects already allowed by live AppActor permissions.

## Tool Target

The exact count may change when a schema is clearer when split, but V1 should
stay around ten domain-focused tools:

1. `get_workspace`
2. `get_app_setup`
3. `query_analytics`
4. `get_catalog`
5. `manage_products`
6. `manage_entitlements`
7. `manage_offerings`
8. `manage_packages`
9. `create_project`
10. `create_app`

There will be no generic raw admin-request tool.

## Delivery 1: Connection and Workspace

- Upgrade Better Auth to the MCP-compatible release and add OAuth/MCP/CIMD
  support to the existing auth service.
- Add authorization-server and protected-resource discovery endpoints.
- Add a small browser consent flow that reuses the existing AppActor session.
- Create the Bun/TypeScript `appactor-mcp` service with `/mcp`, `/health`, and
  `/metrics`.
- Validate OAuth tokens and use a dedicated short-lived internal MCP JWT when
  calling AppActor API.
- Implement `get_workspace` and `get_app_setup`.
- Test real MCP initialization and tool calls, plus Codex and Claude client
  configuration/authentication behavior where local credentials allow it.

Acceptance:

- Claude and Codex can discover the remote server and start browser OAuth.
- A valid AppActor browser session can approve the connection.
- The browser session cookie never reaches the MCP service or client.
- Workspace/app reads respect current organization/project permissions.
- Wrong issuer/audience, expired tokens, missing scopes, and inaccessible
  projects are rejected.

## Delivery 2: Analytics and Catalog Reads

- Implement `query_analytics` for overview, revenue, users, trials, ASA,
  experiments, refunds, and supported transaction summaries.
- Implement `get_catalog` for products, entitlements, AppActor offerings,
  packages, store mappings, and catalog-health findings.
- Return compact text plus typed structured output.
- Add cursor pagination, bounded date ranges, freshness/staleness metadata,
  timeouts, redaction, structured logs, and metrics.

Acceptance:

- Representative MCP results match existing dashboard/API results.
- Read-only scopes cannot reach mutations.
- Cross-organization and inaccessible-project reads fail.
- Empty, stale, paginated, timeout, and upstream-error cases are covered.

## Delivery 3: Controlled Writes

- Implement product discovery/import/classification.
- Implement entitlement, non-current offering, and package create/update.
- Implement additive product-to-entitlement and product-to-package links.
- Implement project creation and iOS/Android app creation.
- If Android credentials are missing, return `action_required` with a dashboard
  URL. Credential JSON must never enter MCP arguments, storage, or logs.
- Add one API-owned `mcp_write_operations` table for write idempotency and
  minimal durable write audit.
- Publish/set-current offering uses preview then apply with a short-lived signed
  diff token. Normal additive writes do not use a custom confirmation framework.

Project creation rule:

- Do not add an MCP-only owner or `all_projects` restriction.
- Any user who has the existing AppActor `projects.create` permission and the
  `workspace:write` OAuth scope may create a project.
- If a `selected_projects` member creates a project, the API must grant that
  creator access to the new project so the result is immediately usable.

V1 exclusions:

- Catalog/project/app deletes
- Entitlement detach and implicit replacement/removal operations
- Credential upload/reveal/delete
- Public or secret key rotation
- Webhook-secret management
- Manual subscriber entitlement/token mutation
- Remote-config and experiment writes

Acceptance:

- Retries cannot create duplicate projects, apps, or catalog objects.
- Same idempotency key with different input fails with conflict.
- Publishing fails if catalog state changed after preview.
- Every write records actor, client, organization, tool, request hash, outcome,
  and affected resource IDs.
- Excluded destructive and secret operations are absent from the tool list.

## Git and Review Workflow

For each delivery:

1. Create a dedicated feature branch in every repository changed by that
   delivery.
2. Implement and run focused tests, typecheck, and lint.
3. Ask three independent agents to review correctness, false positives,
   hallucinated assumptions, security boundaries, and missing tests.
4. Fix confirmed findings and rerun validation.
5. Merge the reviewed branch into `main` non-interactively and push.

After all deliveries, run full MCP protocol tests and end-to-end local tests for
authentication, permissions, read tools, write tools, retries, confirmation,
redaction, and error behavior before handoff.
