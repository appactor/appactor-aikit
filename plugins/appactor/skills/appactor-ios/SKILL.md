---
name: appactor-ios
description: Integrate the AppActor iOS/Swift SDK — configure, identify users, fetch offerings, purchase with StoreKit 2, check entitlements, read remote config and experiment assignments, handle AppActorError, and use the UIKit bridge. Use when working on in-app purchases or subscriptions in a Swift/SwiftUI/UIKit app that uses AppActor, or when the user mentions AppActor with iOS or Swift.
---

# AppActor — iOS (Swift)

The `AppActor` Swift package wraps StoreKit 2 and the AppActor backend. The API
is a `@MainActor` singleton, `AppActor.shared`, with `async throws` methods.
`AppActor.shared` is `nonisolated static let`, so referencing it from any
isolation domain is fine — the methods are what hop to the main actor.

Platforms: iOS 15+, macOS 12+ (`Package.swift`). Products: `AppActor` for apps,
`AppActorPlugin` for cross-platform wrappers.

## The one rule

**AppActor's server decides what a customer owns.** Never gate a feature on a
`Transaction` you verified yourself or on a purchase return value alone. Gate on
entitlements:

```swift
if AppActor.shared.customerInfo.hasActiveEntitlement("premium") {
    // unlock
}
```

`AppActor.shared.customerInfo` is `@Published`, so SwiftUI views observing the
`ObservableObject` re-render when a renewal, restore, or background sync lands.
Also available: `activeEntitlements`, `activeEntitlementKeys`, and the full
`entitlements: [String: AppActorEntitlementInfo]` map.

## Configure

```swift
import AppActor

await AppActor.configure(
    apiKey: "pk_ios_...",
    appUserId: yourUserId,                 // omit to start anonymous
    options: .init(logLevel: .warn)
)
```

`configure` is a `static func` on the type and returns once the startup sequence
has run. It does not throw. A second call is a silent no-op — it logs a warning
and returns without re-running startup — so call `reset()` first if you need to
reconfigure. Every other API throws `AppActorError.notConfigured` until the
first configure completes.

Apple Search Ads attribution is opt-in and must be enabled **after** configure
has returned — calling it earlier throws `notConfigured`. (The Flutter wrapper
is the opposite: there you stage it before `configure`.)

```swift
await AppActor.configure(apiKey: "pk_ios_...")
try AppActor.shared.enableAppleSearchAdsTracking()
```

## Identity

```swift
let info = try await AppActor.shared.logIn(newAppUserId: "user-123")
let didLogOut = try await AppActor.shared.logOut()
await AppActor.shared.reset()
```

## Offerings and paywalls

```swift
let offerings = try await AppActor.shared.offerings()
let offering = offerings.current
let annual = offering?.annual                     // or .monthly, .weekly, .lifetime
let custom = offering?.package(for: .threeMonth)
```

`offerings(fetchPolicy:)` controls freshness (`getOfferings` exists only on the
bridge, not on `AppActor.shared`):

| Policy | Behaviour |
|---|---|
| `.freshIfStale` (default) | serve fresh cache immediately; wait for the network when the cache is stale or missing |
| `.returnCachedThenRefresh` | serve suitable cache immediately, refresh in the background |
| `.cacheOnly` | cache only; **throws** when no locale-compatible cache exists |

Use `.returnCachedThenRefresh` when a paywall must appear instantly and you can
live with prices updating a moment later.

For first launch with no network, ship a fallback:

```swift
try await AppActor.shared.setFallbackOfferings(from: bundledJSONURL)
```

`AppActorOfferings` also exposes `all`, `offering(id:)`, `offering(lookupKey:)`,
`productEntitlements`, and `verification`.

## Purchase

`offering?.annual` is optional and `purchase(package:)` takes a non-optional
package, so unwrap it before you buy.

```swift
guard let annualPackage = annual else { return }   // nothing to sell on this paywall

switch try await AppActor.shared.purchase(package: annualPackage) {
case .success(let customerInfo, _):
    unlock(if: customerInfo.hasActiveEntitlement("premium"))
case .cancelled:
    break                       // the user dismissed the sheet; not an error
case .pending:
    showPendingApproval()       // Ask to Buy / SCA; resolves via the callback below
}
```

`AppActorPurchaseResult` is an enum — `success(customerInfo:purchaseInfo:)`,
`cancelled`, `pending` — so the compiler forces you to handle cancellation and
deferral rather than treating either as a failure.

Overloads take `quantity:`, `placement:` (an analytics label), a StoreKit
`Product` directly, or a `PurchaseIntent` from a promoted App Store purchase.

Restore and sync:

```swift
try await AppActor.shared.restorePurchases(syncWithAppStore: true)
try await AppActor.shared.syncPurchases()
try await AppActor.shared.drainReceiptQueueAndRefreshCustomer()
```

Wire only `restorePurchases` to a user-facing "Restore Purchases" button. App
Review requires that button for any app selling non-consumables or subscriptions.

## Callbacks (UIKit)

SwiftUI can observe the `ObservableObject`. UIKit sets closures instead:

```swift
AppActor.shared.onCustomerInfoChanged = { info in ... }
AppActor.shared.onPurchaseIntent = { intent in ... }        // iOS 16.4+
AppActor.shared.onDeferredPurchaseResolved = { productId, info in ... }
AppActor.shared.onReceiptPipelineEvent = { detail in ... }
```

`onReceiptPipelineEvent` hands you an `AppActorReceiptPipelineEventDetail`. The
bridge exposes the same stream as `AppActorBridge.shared.setReceiptPipelineListener`,
with a different payload type (`AppActorBridgeReceiptEvent`) — use the property
in Swift.

`onDeferredPurchaseResolved` is how Ask-to-Buy approvals reach you; a purchase
that returns as pending finishes here.

## Remote config and experiments

```swift
let configs = try await AppActor.shared.getRemoteConfigs()
let assignment = try await AppActor.shared.getExperimentAssignment(
    experimentKey: "paywall_test"
)
```

A `nil` assignment means the customer is not in the experiment — render your
control experience, do not retry.

## Errors

Everything throws `AppActorError`, a struct with `kind`, `httpStatus`, `code`,
`message`, `details`, `requestId`, `scope`, `retryAfterSeconds`, and
`underlying`. Switch on `kind`:

```swift
do {
    _ = try await AppActor.shared.purchase(package: annualPackage)
} catch let error as AppActorError {
    switch error.kind {
    case .receiptQueuedForRetry:
        showProcessing()                        // NOT a lost purchase, see below
    case .purchaseIneligible, .invalidOffer:
        hideOffer()
    case .productNotAvailableInStorefront:
        hidePackage()
    case .network:
        showRetry(after: error.retryAfterSeconds)
    default:
        showGenericFailure(requestId: error.requestId)
    }
}
```

A user dismissing the StoreKit sheet does **not** throw — both cancellation
paths return `.cancelled`. `purchaseFailed` means StoreKit itself rejected the
purchase.

The full `Kind` set: `notConfigured`, `alreadyConfigured`, `validation`,
`notAvailable`, `network`, `decoding`, `server`, `storeKitProductsMissing`,
`customerNotFound`, `purchaseFailed`, `receiptPostFailed`,
`receiptQueuedForRetry`, `purchaseAlreadyInProgress`,
`productNotAvailableInStorefront`, `signatureVerificationFailed`,
`signatureTimestampOutOfRange`, `signatureMissing`, `nonceMismatch`,
`intermediateCertInvalid`, `intermediateKeyExpired`, `invalidOffer`,
`purchaseIneligible`.

`receiptQueuedForRetry` means StoreKit completed the purchase and the receipt is
queued for automatic retry against the server. The customer paid. Show a
"processing" state and unlock from `onCustomerInfoChanged`, never an error.

The four signature kinds and `nonceMismatch` indicate a response that failed
verification — treat them as "do not unlock", not as "retry".

## Verification and offline

`customerInfo.verification` and `offerings.verification` carry an
`AppActorVerificationResult`. `verifiedOnDevice` means StoreKit 2 proved the
entitlement locally because the server was unreachable — still trustworthy.
`failed` is not.

`activeEntitlementKeysOffline()` returns what the SDK can prove without the
network, and `customerInfo.isComputedOffline` marks a locally derived snapshot.

## Offer codes and Apple Search Ads

```swift
try await AppActor.shared.presentOfferCodeRedeemSheet()
let diagnostics = await AppActor.shared.asaDiagnostics()
```

## Attributes and attribution

`setAttributes`, `setAttribute`, `setEmail`, `setDisplayName`, `setPhoneNumber`,
`setPushToken` (accepts `Data` or `String`), `collectDeviceIdentifiers`, and the
integration-identifier helpers (`setAppsflyerID`, `setAdjustID`, `setBranchID`,
`setFirebaseAppInstanceID`, `setOneSignalID`). Attribution setters:
`setMediaSource`, `setCampaign`, `setAdGroup`, `setAd`, `setKeyword`,
`setCreative`.

## The bridge

`AppActorBridge.shared` exposes the same operations with completion handlers
instead of `async`, for Objective-C callers and cross-platform wrappers. Prefer
`AppActor.shared` in Swift.

## Related

Catalog shape and paywall structure: `appactor-paywalls-and-offerings`.
Remote config and experiment modelling: `appactor-remote-config-and-experiments`.
Diagnosing a customer's live state: `appactor-troubleshooting`.
