---
name: appactor-workspace
description: Work with an AppActor workspace through the AppActor MCP server — find organizations, projects and apps, read revenue/users/trials/experiment analytics, get SDK setup keys and store connection status, and run catalog and workspace writes safely with idempotency keys. Use when answering questions about AppActor revenue or subscribers, setting up a new app, or making catalog changes from the conversation.
---

# AppActor — working in a workspace

The AppActor MCP server (`https://mcp.appactor.com/mcp`) exposes an AppActor
account to Claude over OAuth. Your existing AppActor permissions apply to every
call: the connection cannot see an organization, project, or app your account
cannot already see.

## Orient first

Almost every tool needs an `organizationId`, and most need a `projectId` or
`appId`. Start here rather than guessing IDs:

```
get_workspace {}                                  → organizations
get_workspace { organizationId }                  → projects and apps
```

`get_app_setup { organizationId, appId }` then returns the app's public SDK key,
store connection status, and dashboard links for one app — the thing to reach
for when someone is wiring up the SDK for the first time.

## Reading

`query_analytics { kind, organizationId, ... }` covers `overview`, `revenue`,
`users`, `trials`, `transactions`, `asa`, `experiments`, and `refund_defense`.
Scope narrows with `projectId` or `appId`. `overview`, `revenue`, `users`, and
`trials` take a `windowDays` of 7, 28, or 90; `refund_defense` takes any 1-90;
`transactions` and `asa` have no window and paginate or take an explicit date
range instead.

`get_catalog { view, organizationId, projectId, ... }` reads the catalog:
`context`, `products`, `product`, `entitlements`, `entitlement`, `offerings`,
`offering`, `packages`.

`get_subscriber` answers questions about one named customer. See
`appactor-troubleshooting`.

Every read is scoped by the caller's AppActor permissions, so an empty result
can mean "no data" *or* "no access to that project" — say which you checked
rather than reporting zero revenue as fact.

## Writing

Write tools: `manage_products`, `manage_entitlements`, `manage_offerings`,
`manage_packages`, `create_project`, `create_app`.

**Almost every mutation takes a client-generated `idempotencyKey`.** The two
exceptions are `manage_products` `discover` and `manage_offerings`
`preview_publish` — they are reads in write clothing and take no key. Passing one
is a validation error, because those schemas reject unknown fields.

For the rest, the rules matter:

- Generate **one key per logical operation**, before the first attempt.
- Never generate a fresh key for a retry. That is how duplicate projects, apps,
  and catalog objects get created.
- Reusing a key with *different* arguments is rejected as a conflict. That is
  the guard working, not a bug to route around.

What a retry with the same key actually does depends on what the server recorded:

| Recorded outcome | Retry with the same key |
|---|---|
| succeeded | replays the stored result; no second mutation |
| failed | rejected — the key is burned. Fix the input and use a **new** key |
| pending | rejected as a conflict: the operation is still in flight or was interrupted |
| uncertain | rejected as a conflict: the outcome could not be confirmed |

So a plain timeout is **not** something to retry your way out of. If the server
recorded the operation as uncertain, retrying the same key returns a conflict and
a new key risks a duplicate write. Stop, report the conflict message to the user,
and check the resource's real state with the matching read tool before doing
anything else.

## Publishing an offering: preview, then apply

`manage_offerings` with `action: "preview_publish"` returns a short-lived signed
token and a diff — which offering becomes current, how many packages and product
bindings move.

**Show that diff to the user and get explicit approval before calling
`apply_publish`.** It changes what every customer sees immediately. The apply
fails if the catalog moved after the preview, so a stale approval cannot be
applied silently.

Normal additive writes (creating an entitlement, importing products, adding a
package) do not need this ceremony.

## Creating an app

`create_app` takes `platform: "ios"` with a `bundleId`, or `"android"` with a
`packageName`.

For Android it may return `status: "action_required"` with a dashboard URL, when
no Google Play credential is connected or when several exist and one must be
chosen. That is expected. Hand the user the URL.

**Never ask for, accept, or paste store credential JSON into the conversation.**
Credential setup happens in the dashboard. There is no tool that takes it, by
design.

## What is intentionally missing

No deletes, no entitlement detach, no direct "set current offering" without the
preview step, no credential upload or reveal, no key rotation, no webhook secret
management, no editing a customer's entitlements or token balance by hand, and
no generic raw-admin-request escape hatch.

If a task needs one of those, say so and point at the dashboard. Do not look for
a way around it.

## Reporting numbers

Analytics results carry `generatedAt`. When you quote a revenue or conversion
number, quote the scope and the window with it — "28-day revenue for project X" — because the same metric at organization,
project, and app scope are three different numbers.

## Related

Catalog modelling: `appactor-paywalls-and-offerings`. Customer diagnosis:
`appactor-troubleshooting`. Config and tests:
`appactor-remote-config-and-experiments`.
