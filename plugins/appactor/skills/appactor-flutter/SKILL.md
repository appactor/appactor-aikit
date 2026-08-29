---
name: appactor-flutter
description: Integrate the AppActor Flutter SDK (appactor_flutter) — configure, identify users, fetch offerings, purchase packages, check entitlements, read remote config and experiment assignments, and handle purchase errors. Use when working on in-app purchases or subscriptions in a Flutter app that uses AppActor, or when the user mentions AppActor with Flutter/Dart.
---

# AppActor — Flutter

`appactor_flutter` wraps the native iOS and Android AppActor SDKs behind one Dart
API. Everything hangs off the `AppActor.instance` singleton; the API surface is
delivered as extensions, so a single `package:appactor_flutter/appactor_flutter.dart`
import brings all of it in.

Requirements from the plugin itself: Dart SDK `^3.11.4`, Flutter `>=3.3.0`, iOS
15.1+, Android `minSdk 24`.

## The one rule

**AppActor's server decides what a customer owns.** Never gate a feature on a
purchase result, a local flag, or a StoreKit/Play receipt you inspected
yourself. Gate on entitlements in `AppActorCustomerInfo`:

```dart
final info = await AppActor.instance.getCustomerInfo();
if (info.hasActiveEntitlement('premium')) {
  // unlock
}
```

`hasActiveEntitlement(key)` and `activeEntitlementKeys` are the two checks worth
using. `info.entitlements` is a `Map<String, AppActorEntitlementInfo>` when you
need the detail (`willRenew`, `expirationDate`, `periodType`,
`billingIssueDetectedAt`, `unsubscribeDetectedAt`, `store`).

## Configure

Call `configure` once, early, and `await` it — it returns when the native
startup/bootstrap flow has finished.

```dart
import 'package:appactor_flutter/appactor_flutter.dart';

await AppActor.instance.configure(
  const AppActorPlatformKeys(ios: 'pk_ios_...', android: 'pk_android_...'),
  appUserId: yourUserId,          // omit to start anonymous
  options: const AppActorOptions(logLevel: AppActorLogLevel.warn),
);
```

`configure` accepts either a single `String` public key or
`AppActorPlatformKeys` when iOS and Android use different keys.
`AppActorPlatformKeys` throws `UnsupportedError` on desktop/web targets, so
guard those platforms before calling.

Ordering rules that are easy to get wrong:

- `enableSearchAdsTracking()` must be called **before** `configure` (iOS only).
  It stages options; the native call runs right after configure succeeds and a
  failure there is swallowed, so configure never rejects because of it.
- `enableInstallReferrer()` must be called **after** `configure`. It is a no-op
  on iOS.
- `configure` re-registers the platform method-call handler, which is what keeps
  events flowing across a Dart hot restart.

## Identity

```dart
await AppActor.instance.logIn('your-user-id');   // returns AppActorCustomerInfo
await AppActor.instance.logOut();                // returns bool
final id = await AppActor.instance.getAppUserId();
final anon = await AppActor.instance.getIsAnonymous();
```

Use your own stable user ID as `appUserId` if you have accounts. If you don't,
leave it out — the SDK reuses a cached anonymous ID or creates one.
`AppActor.instance.reset()` clears local state entirely; it is a testing/logout
hammer, not a per-user operation.

## Offerings and paywalls

```dart
final offerings = await AppActor.instance.getOfferings();
final offering = offerings.current;                 // AppActorOffering?
final monthly = offering?.packageFor(AppActorPackageType.monthly);
final onboarding = offerings['onboarding'];         // by offeringKey (the dashboard lookup key)
```

`AppActorOfferings` gives you `current`, `allOfferings` (current first),
`getOffering(offeringKey)` / `offerings['key']`, `all` (keyed by server id),
`offering(id)`, and `productEntitlements`. An `AppActorOffering` has
`offeringKey`, `packages`, `package(id)`, and `packageFor(type)`.
`AppActor.instance.getOffering('onboarding')` fetches and looks up in one call.

Render prices from the package, never hard-coded: `localizedPriceString` is the
store-formatted string; `price`, `priceAmountMicros`, and `currencyCode` are
there when you need to compute. `displayName`, `productName`,
`productDescription`, `metadata`, and `tokenAmount` come from the catalog.

For a paywall that must render before the network settles, ship a fallback:

```dart
await AppActor.instance.setFallbackOfferings(jsonBytes);
final cached = await AppActor.instance.getCachedOfferings();
```

## Purchase

`packageFor` returns null when the offering does not carry that package type, and
`purchasePackage` takes a non-null package — so check before you call it.

```dart
if (monthly == null) return;   // nothing to sell on this paywall

final result = await AppActor.instance.purchasePackage(
  monthly,
  placement: 'onboarding_paywall',   // optional analytics label
);

if (result.isPurchased || result.isRestored) {
  final unlocked = result.customerInfo?.hasActiveEntitlement('premium') ?? false;
} else if (result.isCancelled) {
  // user dismissed the sheet — not an error, don't show one
} else if (result.isPending) {
  // deferred (Ask to Buy / pending Play purchase); resolve via the stream below
}
```

`purchasePackage` also takes `offeringId` (defaults to the package's own),
`quantity` (must be >= 1 or it throws `ArgumentError`), and, on Android,
`oldPurchaseToken` + `replacementMode` for upgrades/downgrades. `placement` is
trimmed and dropped if empty or longer than 255 characters.

Restore and sync:

```dart
await AppActor.instance.restorePurchases(syncWithAppStore: true);
await AppActor.instance.syncPurchases();
await AppActor.instance.drainReceiptQueueAndRefreshCustomer();
```

Only `restorePurchases` should be wired to a user-facing "Restore" button.

## React to changes

```dart
AppActor.instance.onCustomerInfoUpdated.listen((info) => setState(...));
AppActor.instance.onDeferredPurchaseResolved.listen((event) { ... });
AppActor.instance.onPurchaseIntent.listen((intent) { ... });   // iOS 16.4+ only
AppActor.instance.onReceiptPipelineEvent.listen((event) { ... });
```

`onCustomerInfoUpdated` is the right place to unlock UI — it fires after every
server sync, including renewals that arrive while the app is open.

## Remote config and experiments

```dart
final configs = await AppActor.instance.getRemoteConfigs();
final showTrial = await AppActor.instance.getRemoteConfigBool('show_trial');
final headline = await AppActor.instance.getRemoteConfigString('paywall_headline');

final paywall = await AppActor.instance.getExperiment('paywall_test');
if (paywall.isVariant('annual_first')) { /* … */ }
final showTrial = (await AppActor.instance.getExperiment('trial_test'))
    .boolValue(defaultValue: false);
final title = (await AppActor.instance.getExperiment('copy_test'))['title']
    as String? ?? 'Welcome';
```

Remote-config typed accessors (`getRemoteConfigBool/String/Number/Int`) return
`null` when the key is missing or the stored type does not match — always
supply your own default. `getCachedRemoteConfigs()` reads the last synced
values without a network call.

`getExperiment` never returns `null`. When the customer is not in the experiment
`isEnrolled` is `false`, `variantKey` is `null`, and every typed getter
(`boolValue / stringValue / intValue / doubleValue(defaultValue:)`,
`experiment['key']`) returns its default — render control, do not retry.
`getExperimentAssignment` is the raw nullable underneath (`.assignment`).

## Errors

Failures throw `AppActorError` with a numeric `code`, plus `message`, `detail`,
`requestId`, `scope`, and `retryAfterSeconds`. The codes that matter:

| Code | Constant | Meaning |
|---|---|---|
| 2001 | `codeNotConfigured` | `configure` has not completed |
| 2003 | `codeValidation` | bad arguments |
| 2005 | `codeNetwork` | transport failure |
| 2007 | `codeServer` | AppActor API error |
| 2008 | `codeStoreProductsMissing` | catalog product not found in the store |
| 2010 | `codePurchaseFailed` | store rejected the purchase |
| 2012 | `codeReceiptQueuedForRetry` | receipt accepted locally, posting later |
| 2013 | `codePurchaseInProgress` | another purchase is already running |
| 2014 | `codeProductNotAvailable` | product unavailable in this storefront |
| 2015 | `codeSignatureVerification` | response signature check failed |
| 2016 | `codeInvalidOffer` | promotional/intro offer is not valid |
| 2017 | `codePurchaseIneligible` | customer is not eligible for this offer |

Convenience getters exist for the common ones (`isNotConfigured`, `isNetwork`,
`isServer`, `isPurchaseFailed`, `isInvalidOffer`, `isPurchaseIneligible`,
`isSignatureVerification`). `isTransient` marks retryable failures.

`codeReceiptQueuedForRetry` is **not** a lost purchase — the receipt is queued
and will be posted. Tell the customer it is processing, and let
`onCustomerInfoUpdated` unlock the feature when it lands.

## Verification

`AppActorCustomerInfo.verification` and `AppActorOfferings.verification` carry an
`AppActorVerificationResult`: `notRequested`, `verified`, `verifiedOnDevice`
(StoreKit 2 on-device check when the server was unreachable), or `failed`. Use
`verification.isVerified` if you want to refuse to unlock on `failed`.

## Offline

`activeEntitlementKeysOffline()` returns the entitlement keys the SDK can prove
without the network. `getCachedCustomerInfo()` and `getCachedOfferings()` return
the last synced snapshots. `AppActorCustomerInfo.isComputedOffline` tells you a
snapshot was derived locally.

## Attributes and attribution

`setAttributes`, `setAttribute`, `unsetAttribute`, `setEmail`, `setDisplayName`,
`setPhoneNumber`, `setPushToken`, `collectDeviceIdentifiers`, and the
integration-identifier helpers (`setAppsflyerID`, `setAdjustID`, `setBranchID`,
`setFirebaseAppInstanceID`, `setOneSignalID`) all live on `AppActor.instance`.
Attribution fields are `updateAttribution`, `setMediaSource`, `setCampaign`,
`setAdGroup`, `setAd`, `setKeyword`, `setCreative`.

## Related

Catalog shape and paywall structure: `appactor-paywalls-and-offerings`.
Remote config and experiment modelling: `appactor-remote-config-and-experiments`.
Diagnosing a customer's live state: `appactor-troubleshooting`.
