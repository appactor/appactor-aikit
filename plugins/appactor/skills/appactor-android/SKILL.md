---
name: appactor-android
description: Integrate the AppActor Android SDK (com.appactor:appactor-android) — configure, identify users, fetch offerings, purchase through Google Play Billing, check entitlements, read remote config and experiment assignments, handle AppActorError, and call it from Java. Use when working on in-app purchases or subscriptions in an Android/Kotlin app that uses AppActor, or when the user mentions AppActor with Android or Kotlin.
---

# AppActor — Android (Kotlin)

`com.appactor:appactor-android` wraps Google Play Billing and the AppActor
backend. The API is a Kotlin `object` — `AppActor` — with `suspend` functions.
`AppActor.shared` exists as an alias for wrapper code; in Kotlin just use
`AppActor` directly.

`compileSdk 36`, `minSdk 24`.

```kotlin
dependencies {
    implementation("com.appactor:appactor-android:<version>")
}
```

## The one rule

**AppActor's server decides what a customer owns.** Never gate a feature on a
`Purchase` you read from Play Billing or on a purchase return value alone. Gate
on entitlements:

```kotlin
if (AppActor.customerInfo.entitlements["premium"]?.isActive == true) {
    // unlock
}
```

`AppActor.customerInfoFlow` is a `StateFlow<AppActorCustomerInfo>` — collect it
and your UI reacts to renewals, restores, and background syncs without polling.
`AppActor.onCustomerInfoChanged` is the callback equivalent.

## Configure

```kotlin
AppActor.configure(
    context = applicationContext,
    apiKey = "pk_android_...",
    appUserId = yourUserId,                 // omit to start anonymous
    options = AppActorOptions(logLevel = AppActorLogLevel.Warn),
)
```

`configure` is `suspend` and returns after startup completes. It is a no-op if
the SDK is already configured or a reset is in flight, so it is safe to call
from `Application.onCreate` inside a scope.

Response-signature verification is on by default and is not configurable from
`AppActorOptions` — the SDK always requires signed responses.

Google Play Install Referrer tracking is opt-in and must be called **after**
configure:

```kotlin
AppActor.enableInstallReferrer()
```

## Identity

```kotlin
val info = AppActor.logIn("user-123")     // AppActorCustomerInfo
val didLogOut = AppActor.logOut()          // Boolean
val id = AppActor.appUserId                // String?
val anon = AppActor.isAnonymous            // Boolean
AppActor.reset()
```

## Offerings and paywalls

```kotlin
val offerings = AppActor.offerings()
val offering = offerings.current
val annual = offering?.packageFor(AppActorPackageType.Annual)
val onboarding = offerings["onboarding"]           // by offeringKey (the dashboard lookup key)
```

`offerings(fetchPolicy)` controls freshness:

| Policy | Behaviour |
|---|---|
| `FreshIfStale` (default) | serve fresh cache immediately; wait for the network when stale or missing |
| `ReturnCachedThenRefresh` | serve cache immediately, refresh in the background |
| `CacheOnly` | cache only; throws when nothing suitable is cached |

Bundle a fallback for a first launch with no network. `setFallbackOfferings` may
be called **before or after** `configure`, and the fallback is used only when
both network and disk cache fail:

```kotlin
AppActor.setFallbackOfferings(assets.open("offerings.json").readBytes())
```

`AppActor.cachedOfferings` and `AppActor.cachedRemoteConfigs` read the last
synced values with no suspension.

`AppActorOfferings` also exposes `allOfferings` (current first),
`getOffering(offeringKey)` / `offerings["key"]`, and `offering(id)` (server id).
Every `AppActorOffering` has `offeringKey`. `AppActor.getOffering("onboarding")`
fetches and looks up in one call (also on `AppActorBridge` and
`AppActorJava.getOfferingAsync`).

## Purchase

A purchase needs the **Activity**, not the application context — Play Billing
launches its sheet from it. `packageFor` returns null when the offering has no
package of that type, and `purchase` takes a non-null one:

```kotlin
val annualPackage = annual ?: return   // nothing to sell on this paywall

val result = AppActor.purchase(
    activity = this,
    appActorPackage = annualPackage,
    placement = "onboarding_paywall",   // optional analytics label
)
```

The package must carry a non-blank `productId` or the call throws
`IllegalArgumentException`. The `AppActorPurchaseParams` overloads are
deprecated — they exist only for explicit direct Play Store targets.

Restore and sync:

```kotlin
AppActor.restorePurchases()
AppActor.syncPurchases()
AppActor.drainReceiptQueueAndRefreshCustomer()
```

Only `restorePurchases` belongs behind a user-facing "Restore" button.

## Deferred and pending purchases

Google Play purchases can land in a pending state (cash payment, family
approval). Handle them through the callback, not by polling:

```kotlin
AppActor.onDeferredPurchaseResolved = { productId, customerInfo -> ... }
AppActor.onReceiptPipelineEvent = { event -> ... }
```

## Remote config and experiments

```kotlin
val configs = AppActor.getRemoteConfigs()
val showTrial = AppActor.getRemoteConfigBool("show_trial")     // Boolean?
val headline = AppActor.getRemoteConfigString("paywall_headline")

val paywall = AppActor.getExperiment("paywall_test")
if (paywall.isVariant("annual_first")) { /* … */ }
val showTrial = AppActor.getExperiment("trial_test").boolValue(defaultValue = false)
val title = AppActor.getExperiment("copy_test")["title"]?.stringValue ?: "Welcome"
```

The remote-config typed getters (`getRemoteConfigBool/String/Number/Int`) are
non-suspending reads over the synced snapshot and return `null` when the key is
missing or the type does not match — always supply your own default.

`getExperiment` never returns `null`. When the customer is not in the experiment
`isEnrolled` is `false`, `variantKey` is `null`, and every typed getter
(`boolValue / stringValue / intValue / doubleValue(defaultValue)`, `["key"]`)
returns its default — render control, do not retry. `getExperimentAssignment`
is the raw nullable underneath (`getExperiment(...).assignment`).

## Errors

`AppActorError` is a sealed class extending `IllegalStateException`. Match on
the subclass:

```kotlin
try {
    AppActor.purchase(activity, annualPackage)
} catch (error: AppActorError) {
    when (error) {
        is AppActorError.ReceiptQueuedForRetry -> showProcessing()
        is AppActorError.PurchaseFailed -> showRetry()
        is AppActorError.PurchaseIneligible -> hideOffer()
        is AppActorError.ProductNotAvailable -> hidePackage()
        is AppActorError.Network -> showOffline()
        is AppActorError.Server -> { error.statusCode; error.retryAfterSeconds }
        else -> showGeneric()
    }
}
```

Full set: `NotConfigured`, `AlreadyConfigured`, `InvalidConfiguration`,
`NotImplementedYet`, `Network`, `Server`, `PurchaseFailed`, `ReceiptPostFailed`,
`Decoding`, `StoreProductsMissing`, `CustomerNotFound`, `ReceiptQueuedForRetry`,
`PurchaseAlreadyInProgress`, `ProductNotAvailable`, `InvalidOffer`,
`PurchaseIneligible`, `SignatureVerificationFailed`,
`SignatureTimestampOutOfRange`, `SignatureMissing`, `NonceMismatch`,
`IntermediateCertInvalid`, `IntermediateKeyExpired`, `Unknown`.

`ReceiptQueuedForRetry` is **not** a lost purchase — Play completed it and the
receipt is queued for retry. Show a processing state and unlock from
`customerInfoFlow`.

`Server` carries `statusCode`, `scope` (which rate-limit layer fired), and
`retryAfterSeconds` — respect that delay rather than retrying immediately.

The signature errors (`SignatureVerificationFailed`,
`SignatureTimestampOutOfRange`, `SignatureMissing`, `NonceMismatch`,
`IntermediateCertInvalid`, `IntermediateKeyExpired`) mean the response could not
be trusted. Do not unlock, and do not treat them as retryable.

## Offline

```kotlin
val keys = AppActor.activeEntitlementKeysOffline()
val canBuy = AppActor.canMakePurchases()
val capabilities = AppActor.getStoreCapabilities()
val storefront = AppActor.getStorefront()
```

## Attributes and attribution

`setAttributes`, `setAttribute`, `unsetAttribute`, `setEmail`, `setDisplayName`,
`setPhoneNumber`, `setPushToken`, `collectDeviceIdentifiers`,
`setIntegrationIdentifier` / `unsetIntegrationIdentifier` (String or
`AppActorIntegrationIdentifier` overloads), plus `setAppsflyerID`,
`setAdjustID`, `setBranchID`, `setFirebaseAppInstanceID`, `setOneSignalID`.
Attribution: `updateAttribution`, `setMediaSource`, `setCampaign`, `setAdGroup`,
`setAd`, `setKeyword`, `setCreative`.

## Java callers

`AppActorJava` mirrors the suspend API with `@JvmStatic` `...Async` methods that
take callbacks: `configureAsync`, `logInAsync`, `logOutAsync`,
`getOfferingsAsync`, `getOfferingAsync`, `getCustomerInfoAsync`,
`getRemoteConfigsAsync`, `getExperimentAsync`, `getExperimentAssignmentAsync`,
`getStorefrontAsync`,
`getStoreCapabilitiesAsync`, `purchaseAsync`.

## Related

Catalog shape and paywall structure: `appactor-paywalls-and-offerings`.
Remote config and experiment modelling: `appactor-remote-config-and-experiments`.
Diagnosing a customer's live state: `appactor-troubleshooting`.
