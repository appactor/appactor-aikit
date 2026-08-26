---
name: appactor-paywalls-and-offerings
description: Model an AppActor catalog and build a paywall from it — how products, entitlements, offerings, and packages relate, what "current offering" means, how to change prices or plans without shipping an app update, and how to read or edit the catalog with the AppActor MCP tools. Use when designing or debugging a paywall, adding a plan, changing pricing, or when entitlements are not unlocking as expected.
---

# AppActor — paywalls, offerings, and the catalog

## The four objects

**Product** — one purchasable SKU as the store knows it. Keyed by
`storeProductId`, and on Google also by `googleBasePlanId` / `googleOfferId`; on
Apple, subscriptions carry an `appleSubscriptionGroupId`. Products are per-app,
because store IDs are per-app.

**Entitlement** — what a customer *gets*. `premium`, `pro`, `no_ads`. Keyed by
`lookupKey`. Entitlements are per-**project**, so an iOS app and its Android
twin in the same project share `premium` and a customer keeps access across
platforms.

**Offering** — a named set of what you sell right now. One offering per project
is `isCurrent`; that is what an SDK returns as `offerings.current`.

**Package** — a slot inside an offering (`monthly`, `annual`, `lifetime`,
`weekly`, `two_month`, `three_month`, `six_month`, `consumable`, `custom`) that
maps to one product per platform. `annual` in your paywall resolves to the
iOS product on iOS and the Play product on Android.

The wiring:

```
Product ──many-to-many──> Entitlement        (what a purchase grants)
Package ──> Product                          (what a paywall slot sells)
Offering ──> Packages                        (what the paywall shows)
```

A purchase grants every entitlement attached to the product bought. If a
customer buys and nothing unlocks, the product-to-entitlement link is almost
always what is missing — check that first.

## Building a paywall

1. `getOfferings()` and take `current`.
2. Read the packages you support by type (`annual`, `monthly`, `lifetime`) —
   never by hard-coded product ID.
3. Render `localizedPriceString` from the package. It is already formatted for
   the customer's storefront. Do not format `price` yourself, and never
   hard-code currency symbols.
4. Purchase the package.
5. Unlock from `customerInfo` entitlements — not from the purchase return value.

Because the paywall is driven by the offering, changing which plans you sell, or
their order, is a dashboard change and not an app release. That only holds if
you avoid hard-coded product IDs in the client.

## Choosing lookup keys

`lookupKey` is what your code compares against, so it is effectively public API
for your app. Pick it once and never rename it — a rename silently locks out
every shipped client that checks the old key. Use flat, stable names
(`premium`, not `premium_v2_final`).

## Changing what you sell

Adding a plan: create the product in App Store Connect and Play Console, import
it into AppActor, attach entitlements, create a package in a **new** offering,
then publish that offering as current. Building the new offering separately
means the live paywall never shows a half-built state.

Raising a price: create a new product at the new price, put it in a new
offering, publish. Existing subscribers keep their old price — the stores handle
that. Never edit a live product's price expecting existing subscribers to move.

## Doing it from Claude

With the AppActor MCP server connected, the catalog is readable and editable
from the conversation.

Read:

- `get_catalog` with `view: "context"` — the fastest orientation for a project.
- `view: "products" | "product" | "entitlements" | "entitlement" | "offerings" | "offering" | "packages"` for detail.

Write (each mutation needs a client-generated `idempotencyKey` — generate one
per logical operation, and on a timeout or uncertain result retry with **the
same** key, never a new one):

- `manage_products` — `discover` reads what the connected store actually has,
  `import` brings SKUs into AppActor, `classify` sets product type and display name.
- `manage_entitlements` — `create`, `update`, `attach_product`.
- `manage_offerings` — `create`, `update`, then `preview_publish` →
  `apply_publish`.
- `manage_packages` — `create`, `update`, `attach_product`.

Start from `discover`, not from typed-in product IDs. It returns the SKUs the
store reports, which is the only way to be sure an ID matches.

## Publishing an offering is two steps

`preview_publish` returns a short-lived signed token plus a diff: which offering
becomes current, how many packages and product bindings move.

**Show that diff to the user and get approval before calling `apply_publish`.**
Publishing changes what every customer sees immediately. `apply_publish` fails
if the catalog changed after the preview was taken, so a stale approval cannot
be applied silently.

## What the MCP tools deliberately cannot do

No deletes, no entitlement detach, no direct "make this offering current"
without the preview step, no credential upload, no key rotation, no webhook
secret management, no editing a customer's entitlements by hand. Those stay in
the dashboard on purpose. If a task needs one of them, say so and point at the
dashboard rather than looking for a workaround.

## Debugging "the customer paid but nothing unlocked"

In order:

1. Is the product attached to the entitlement? (`get_catalog` with
   `view: "product"`.)
2. Is the app checking the same `lookupKey` the entitlement uses?
3. Is the app gating on `customerInfo` entitlements, or on the purchase result?
4. Does the customer's live state actually show the entitlement?
   `get_subscriber` answers this directly — see `appactor-troubleshooting`.
5. Was the receipt queued rather than posted? A `receiptQueuedForRetry` error is
   a paid purchase still in flight, not a failure.

## Related

Platform code: `appactor-flutter`, `appactor-ios`, `appactor-android`,
`appactor-react-native`. Live customer state: `appactor-troubleshooting`.
