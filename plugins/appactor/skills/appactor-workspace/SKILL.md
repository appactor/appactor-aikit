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

`get_config { view, organizationId, ... }` reads remote config and experiments:
`remote_configs`, `remote_config`, `experiments`, `experiment`. See
`appactor-remote-config-and-experiments`.

`get_audit_log { organizationId, scope }` reads what AI clients already changed.
`scope: "mine"` is the default and needs no extra permission; `"organization"`
requires `team.manage`. It covers MCP writes only — AppActor has no
organization-wide dashboard audit log, so do not present it as one.

`get_subscriber` answers questions about one named customer. See
`appactor-troubleshooting`.

Every read is scoped by the caller's AppActor permissions, so an empty result
can mean "no data" *or* "no access to that project" — say which you checked
rather than reporting zero revenue as fact.

## Writing

Write tools: `manage_products`, `manage_entitlements`, `manage_offerings`,
`manage_packages`, `create_project`, `create_app`, `delete_project`,
`delete_app`, `manage_remote_config`, `manage_experiments`.

**Almost every mutation takes a client-generated `idempotencyKey`.** The
exceptions are `manage_products` `discover`, `manage_offerings`
`preview_publish`, and the `preview` action of `delete_project` and
`delete_app` — they are reads in write clothing and take no key. Passing one
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
anything else. `get_audit_log` shows the ledger entry, including whether it
ended `pending` or `uncertain`.

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

iOS never blocks on that, because an iOS app works without a store credential —
StoreKit receipts verify against Apple's root CAs, so purchases and the paywall
do not depend on one. If the organization has exactly one Apple credential the
app is bound to it automatically. Otherwise the app is still created and the
result carries `appleConnectionWarning` — the same field that reports a failed
credential probe, because both mean the same thing to the operator. Relay it:
until a credential is bound, product sync, restore history and subscription
reconciliation stay off, and the catalog page shows "Apple credentials not
configured".

**Never ask for, accept, or paste store credential JSON into the conversation.**
Credential setup happens in the dashboard. There is no tool that takes it, by
design. There is also no tool that picks *which* credential to bind — credential
ids are redacted out of every MCP read, so ambiguity is always the user's to
resolve in the dashboard.

## Deleting a project or an app

`delete_project` and `delete_app` are the only deletes that exist, they are
permanent, and they are two calls, never one.

**They need the `workspace:delete` scope, which is newer than most
connections.** A connection approved before it existed gets an HTTP 403 with an
`insufficient_scope` challenge on the first call. That is not a bug and not a
permissions problem in AppActor — the user has to re-approve the connection to
grant it. Say that plainly instead of falling back to "open the dashboard".

1. `action: "preview"` returns what would be destroyed and a `previewToken`
   that expires in five minutes.
2. Show that to the user in full, then **end your turn and wait.**
3. `action: "apply"` in a **later** turn, with the token, an `idempotencyKey`,
   and `confirmName` set to the name **the user typed in a message of their
   own**. Not the name from their original request, not the one in the preview,
   not one you produce. If nobody is there to type it — an unattended or
   scheduled run — do not call apply at all; say deletion needs a person.

### Reading the preview

`impact` separates rows from bindings, and the two mean different things:

- A **project** delete destroys apps, products, entitlements, offerings,
  packages, remote configs, experiments, customer token balances and project
  secret keys, and queues a permanent purge of the analytics history.
- An **app** delete leaves the project's entitlement, offering and package rows
  standing — `entitlements`, `offerings`, `packages` are reported as `0` — but
  destroys that app's products and therefore its `packageProducts` and
  `productEntitlements` bindings. A shared package survives with nothing bound
  on that platform. Say that out loud; it is the part people do not expect.
- `subscribers` and `transactions` are capped probes: `atLeast: true` means
  "this number or more", never an exact total.
- `appNamesTruncated: true` means `appNames` is a sample, not the whole list.
  Do not present it as complete.

### When apply refuses

Apply refuses if the target was renamed or if its **structure** changed after
the preview — an app added in between would otherwise be destroyed by an
approval that never mentioned it. Subscribers and purchases arriving in the
meantime are fine and do not invalidate anything. On a refusal, take a fresh
preview, ask again, and use a **new** `idempotencyKey`: a new preview is a
different request, and the old key is bound to the old one.

`alreadyAbsent: true` means it was already gone. That is a success, not a
failure; say so and move on. It is not the normal retry path — a same-key retry
of a delete that already succeeded replays the original result instead.

Deleting a project takes every app inside it, and both take their subscribers
and purchase history. There is no undo and no soft delete.

## What is intentionally missing

No catalog deletes — not products, entitlements, offerings or packages — and no
remote config or experiment deletes. No entitlement detach, no direct "set
current offering" without the preview step, no credential upload, reveal or
binding, no key rotation, no webhook secret management, no editing a customer's
entitlements or token balance by hand, and no generic raw-admin-request escape
hatch.

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
