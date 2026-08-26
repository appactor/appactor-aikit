---
name: appactor-troubleshooting
description: Diagnose AppActor problems — a customer who paid but has no access, entitlements not unlocking, purchases failing, receipts stuck in the retry queue, sandbox versus production confusion, and signature verification failures. Use when investigating a support report about a subscription, a failed purchase, or missing access in an app that uses AppActor.
---

# AppActor — troubleshooting

## Start from the customer's live state

With the AppActor MCP server connected, `get_subscriber` answers "what does this
customer actually own right now?" without opening the dashboard:

```
get_subscriber { action: "lookup", organizationId, appUserId: "<their app user ID>" }
get_subscriber { action: "get",    organizationId, subscriberId: "<from lookup>" }
```

Matching is **exact** — a partial ID returns nothing, and there is no way to
browse the customer base. Ask the customer (or your logs) for the precise app
user ID first.

The detail response gives you `summary.status` (`active` / `trialing` /
`inactive`), `summary.activeEntitlementKeys`, `summary.hasBillingIssue`,
`summary.hasCancellation`, every entitlement record with its store, product,
period type, renewal state and expiry, and the recent transactions.

Custom attributes, email, phone, push tokens, integration identifiers, and token
ledgers are deliberately **not** returned. If a question needs those, it needs
the dashboard.

## "I paid but I don't have access"

Walk it in this order — each step rules out a whole class of cause.

**1. Does the server think they own it?**
`get_subscriber`. If `activeEntitlementKeys` contains the key, the backend is
fine and the bug is client-side; skip to step 4.

**2. Did the purchase reach the server at all?**
Look at `transactions` in the same response. No transaction means the receipt
never posted. The usual reasons: the app crashed mid-purchase, the receipt is
still queued (see below), or the purchase happened against a different app user
ID — which is what an anonymous purchase followed by a `logIn` looks like when
the login came second.

**3. Is the product attached to the entitlement?**
A transaction with no matching entitlement means the catalog link is missing.
`get_catalog` with `view: "product"` shows the entitlements bound to that
product. This is the single most common cause of "nothing unlocked".

**4. Is the client checking the right key, from the right place?**
It must gate on `customerInfo` entitlements and on the exact `lookupKey`. Gating
on a purchase return value, a local flag, or a receipt the app inspected itself
will drift from the server sooner or later.

**5. Has the client synced since the purchase?**
`customerInfo` refreshes on launch, on foreground, and after purchases. A UI
that reads it once and caches it in local state will miss a renewal that lands
while the app is open. Subscribe to the customer-info stream instead.

## Receipts stuck in the retry queue

`receiptQueuedForRetry` (code 2012) means the **store completed the purchase**
and the receipt could not be posted to AppActor yet. The customer paid. It is a
transient condition, not a failure.

Correct handling: show a "processing" state, never an error, and unlock when the
customer-info stream fires. `drainReceiptQueueAndRefreshCustomer()` forces an
attempt if you want a manual retry button.

The receipt pipeline emits events you can log while debugging:
`posted_ok`, `retry_scheduled`, `permanently_rejected`, `dead_lettered`,
`duplicate_skipped`. `duplicate_skipped` is healthy — it is the queue refusing
to post the same receipt twice.

## Purchase failures

| Symptom | Likely cause |
|---|---|
| `storeKitProductsMissing` / `StoreProductsMissing` (2008) | the product exists in AppActor but the store does not return it — not yet approved, wrong bundle ID, or missing agreements |
| `productNotAvailableInStorefront` (2014) | product not sold in that customer's country |
| `purchaseIneligible` (2017) | offer eligibility, usually an intro or promotional offer the customer already used |
| `invalidOffer` (2016) | offer identifier, price, or signature does not match |
| `purchaseAlreadyInProgress` (2013) | a second purchase started before the first finished — usually a double-tapped button |
| `purchaseFailed` (2010) | the store itself rejected it, including user cancellation on some paths |

A cancelled purchase is not an error state. On the platforms that return a
status rather than throwing, check for `cancelled` before showing anything.

## Sandbox vs production

Sandbox and production are separate worlds. A sandbox purchase does not create
production entitlements, and sandbox subscription periods are compressed to
minutes, so a "subscription expired immediately" report from a tester is
usually correct behaviour.

Entitlement and transaction records carry `environment`. If a customer's records
say `sandbox` and you expected real money, you are looking at a test account.

## Signature verification failures

`signatureVerificationFailed`, `signatureTimestampOutOfRange`,
`signatureMissing`, `nonceMismatch`, `intermediateCertInvalid`, and
`intermediateKeyExpired` all mean the response could not be trusted.

Do **not** treat these as retryable and do not unlock. The most common benign
cause is a device clock that is badly wrong, which surfaces as
`signatureTimestampOutOfRange`.

Separately, `customerInfo.verification` and `offerings.verification` carry a
result: `verified` (server-signed), `verifiedOnDevice` (StoreKit 2 proved it
locally because the server was unreachable — still trustworthy), `notRequested`,
or `failed`. Refuse to unlock on `failed`.

## Offline and first launch

`activeEntitlementKeysOffline()` returns what the SDK can prove with no network.
`getCachedCustomerInfo()` and `getCachedOfferings()` return the last synced
snapshots, and `customerInfo.isComputedOffline` marks a locally derived one.

A paywall that renders empty on first launch with no network is a missing
fallback catalog — `setFallbackOfferings(...)` with a bundled JSON file fixes
it. The fallback is used only when both network and disk cache fail.

## Identity mistakes that look like billing bugs

- Purchasing while anonymous and calling `logIn` afterwards attaches the
  purchase to the anonymous ID. Log in **before** presenting the paywall when
  you have an account system.
- `reset()` clears local state. It is a testing and sign-out hammer, not a
  per-user operation.
- Two devices with different app user IDs are two customers. Shared access
  across devices needs the same `appUserId`.

## Escalating

If the customer's server-side state is correct and the client is gating on the
right entitlement, capture the `requestId` from the `AppActorError` — every
error carries one — and the customer's app user ID. Those two make a support
request answerable.

## Related

Catalog structure: `appactor-paywalls-and-offerings`. Platform specifics:
`appactor-flutter`, `appactor-ios`, `appactor-android`,
`appactor-react-native`.
