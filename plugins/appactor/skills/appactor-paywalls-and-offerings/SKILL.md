---
name: appactor-paywalls-and-offerings
description: Model an AppActor catalog and build a paywall from it — how products, entitlements, offerings, and packages relate, what "current offering" means, package types, how to add a plan or change pricing without shipping an app update, and how to edit the catalog with the AppActor MCP tools. Use when designing a paywall, adding or renaming an entitlement, wiring a package to a product, or publishing an offering. For diagnosing one customer who already paid, use appactor-troubleshooting instead.
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

**Package** — a slot inside an offering that maps to one product per platform.
`annual` in your paywall resolves to the iOS product on iOS and the Play product
on Android.

The catalog package types, which are what `manage_packages` accepts, are
`lifetime`, `annual`, `six_months`, `three_months`, `two_months`, `monthly`,
`weekly`, and `custom` — note the **plural** month forms. There is no
`consumable` package type; a consumable is a *product* type, sold through a
`custom` package.

The SDK enums spell the same slots slightly differently (`sixMonth`,
`threeMonth`, `twoMonth`) and add a `consumable` case of their own. Their
parsers accept both spellings, so reading is safe either way — but a write
through `manage_packages` must use the catalog spelling or it is rejected before
the request leaves the MCP server.

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

1. Fetch offerings and take `current` — `getOfferings()` on Flutter and React
   Native, `offerings()` on iOS and Android.
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

## A product can exist here and still not be sellable

Importing a product into AppActor does not make the store sell it. Apple has to
approve it, and either store can have it pulled from sale afterwards. A product
in that state sits in the catalog looking normal, gets attached to entitlements,
gets put in a package — and then every purchase of it fails.

`get_catalog` with `view: "products"`, and the products returned by
`manage_products`, carry two fields for this:

- `storeState` — what the store says, in the store's own words, normalized to
  SCREAMING_SNAKE. Apple: `APPROVED`, `WAITING_FOR_REVIEW`, `MISSING_METADATA`,
  `REJECTED`, `DEVELOPER_REMOVED_FROM_SALE`, … Google: `ACTIVE`, `DRAFT`,
  `INACTIVE`, … There is no AppActor vocabulary on top: the two stores have
  different lifecycles, and a mapping made here would be frozen into every row.
- `storeStateSyncedAt` — when that was last read from the store.

`null` in both means the product has never been synced, which is not the same
answer as "the store did not say". A stale `storeStateSyncedAt` means the badge
is old, not that the product changed.

`manage_products` already refuses to import a product the store will not sell,
and `discover` does not offer one, so the states you see on an imported product
are the ones a live product can be in — `WAITING_FOR_REVIEW` and
`MISSING_METADATA` are the two that matter, because both mean "not sellable
yet". Say so when you report an import; do not tell someone their paywall is
ready when Apple has not approved the product behind it.

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

Write. Every mutation needs a client-generated `idempotencyKey`, with two
exceptions: `manage_products` `discover` and `manage_offerings` `preview_publish`
are reads in write clothing and take **no** key — passing one is a validation
error, because these schemas reject unknown fields.

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

No catalog deletes — a product, entitlement, offering or package cannot be
removed from here. No entitlement detach, no direct "make this offering current"
without the preview step, no credential upload, no key rotation, no webhook
secret management, no editing a customer's entitlements by hand. Those stay in
the dashboard on purpose. If a task needs one of them, say so and point at the
dashboard rather than looking for a workaround.

To take a package off a paywall without the dashboard, set `isActive: false` on
it with `manage_packages` `update`. The offerings payload only carries active
packages, so it disappears from the paywall while the row and its history stay.

Deleting a whole project *is* available (`delete_project`), and it destroys the
catalog inside it along with everything else. `delete_app` is different and the
difference matters here: the project's entitlements, offerings and packages
survive an app delete, but that app's products do not, so every package loses
its bindings for that platform and keeps standing with nothing behind them on
that store. See `appactor-workspace` for both flows.

## When a catalog change does not take effect

If a purchase grants nothing, the catalog side of it is the product-to-
entitlement link: `get_catalog` with `view: "product"` shows which entitlements a
product grants, and an empty list there explains the symptom on its own. If the
link is present and the customer still has no access, the question has moved off
the catalog — diagnose the customer with `appactor-troubleshooting`.

## Related

Tool mechanics, idempotency rules, and how to find organization/project IDs:
`appactor-workspace`. Diagnosing one customer: `appactor-troubleshooting`.
Platform code: `appactor-flutter`, `appactor-ios`, `appactor-android`,
`appactor-react-native`.
