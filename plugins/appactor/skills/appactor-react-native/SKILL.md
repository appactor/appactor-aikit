---
name: appactor-react-native
description: Integrate the AppActor React Native SDK (appactor-react-native) — configure, identify users, fetch offerings, purchase packages, check entitlements, subscribe to customer info events, read remote config and experiment assignments, and handle AppActorError. Use when working on in-app purchases or subscriptions in a React Native app that uses AppActor, or when the user mentions AppActor with React Native.
---

# AppActor — React Native

`appactor-react-native` bridges the native iOS and Android AppActor SDKs. The
entry point is a guarded singleton: `AppActor.instance`. Constructing
`new AppActor()` throws.

```ts
import { AppActor, AppActorPackageType, AppActorError } from 'appactor-react-native';
```

## The one rule

**AppActor's server decides what a customer owns.** Never gate a feature on a
purchase result or a receipt you inspected yourself. Gate on entitlements:

```ts
const info = await AppActor.instance.getCustomerInfo();
if (info.hasActiveEntitlement('premium')) {
  // unlock
}
```

`info.activeEntitlementKeys` is a `Set<string>`; `info.entitlements` holds the
detail (`willRenew`, `expirationDate`, `periodType`, `store`,
`billingIssueDetectedAt`).

## Configure

```ts
await AppActor.instance.configure('pk_...', {
  appUserId: yourUserId,                       // omit to start anonymous
  options: new AppActorOptions(AppActorLogLevel.Warn),
});
```

The first argument is a `string` key or an `AppActorPlatformKeys` instance when
iOS and Android use different public keys. `configure` resolves once native
startup has completed — `await` it before any other call.

Ordering rules:

- `AppActor.instance.enableSearchAdsTracking(options?)` must be called **before**
  `configure`. It stages options that are applied natively after configure.
- `await AppActor.instance.enableInstallReferrer()` must be called **after**
  `configure`. It is a no-op on iOS.

Several methods are iOS-only and throw `UnsupportedError` on Android:
`presentOfferCodeRedeemSheet`, `getAsaDiagnostics`,
`getPendingAsaPurchaseEventCount`, `getAsaFirstInstallOnDevice`,
`getAsaFirstInstallOnAccount`, `purchaseFromIntent`. Guard with `Platform.OS`.

## Identity

```ts
await AppActor.instance.logIn('user-123');   // AppActorCustomerInfo
await AppActor.instance.logOut();            // boolean
await AppActor.instance.reset();
```

## Offerings and paywalls

```ts
const offerings = await AppActor.instance.getOfferings();
const offering = offerings.current;
const annual = offering?.annual;                      // or .monthly, .weekly, .lifetime
const custom = offering?.packageFor(AppActorPackageType.ThreeMonth);
```

`AppActorOfferings` also has `all`, `offeringByLookupKey(...)`,
`productEntitlements`, and `verification`.
`AppActor.instance.getCachedOfferings()` returns the last synced snapshot, and
`setFallbackOfferings(...)` seeds a bundled catalog for a first launch with no
network.

Render prices from the package (`localizedPriceString`, `price`,
`currencyCode`), never hard-coded strings.

## Purchase

```ts
const result = await AppActor.instance.purchasePackage(annual, {
  placement: 'onboarding_paywall',
});

if (result.status === AppActorPurchaseStatus.Purchased) {
  // result.customerInfo carries the fresh entitlement state
}
```

`PurchasePackageOptions`: `offeringId`, `quantity` (must be an integer >= 1 or
the call throws), `placement`, and, on Android, `oldPurchaseToken` +
`replacementMode` for plan changes.

```ts
await AppActor.instance.restorePurchases({ syncWithAppStore: true });
await AppActor.instance.syncPurchases();
```

Only `restorePurchases` belongs behind a user-facing "Restore" button.

## Events

Each stream is an `AppActorEventStream` exposing `addListener`, which returns a
subscription you must remove on unmount:

```ts
useEffect(() => {
  const sub = AppActor.instance.onCustomerInfoUpdated.addListener(setCustomerInfo);
  return () => sub.remove();
}, []);
```

Available streams: `onCustomerInfoUpdated`, `onReceiptPipelineEvent`,
`onPurchaseIntent` (iOS 16.4+), `onDeferredPurchaseResolved`, `onSdkLog`.

`addListener` throws an `AppActorError` if the native event emitter is not
linked — that means the native module was not installed correctly, not that
something went wrong at runtime.

## Remote config and experiments

```ts
const configs = await AppActor.instance.getRemoteConfigs();
const showTrial = await AppActor.instance.getRemoteConfigBool('show_trial');
const headline = await AppActor.instance.getRemoteConfigString('paywall_headline');
const assignment = await AppActor.instance.getExperimentAssignment('paywall_test');
```

The typed getters return `null` when the key is missing or the stored type does
not match — always supply your own default. A `null` assignment means the
customer is not in the experiment; render control.

## Errors

`AppActorError extends Error` with `code`, `detail`, `requestId`, `scope`, and
`retryAfterSeconds`, plus static code constants:

| Code | Constant | Meaning |
|---|---|---|
| 2001 | `codeNotConfigured` | `configure` has not completed |
| 2003 | `codeValidation` | bad arguments |
| 2005 | `codeNetwork` | transport failure |
| 2007 | `codeServer` | AppActor API error |
| 2008 | `codeStoreProductsMissing` | catalog product missing in the store |
| 2010 | `codePurchaseFailed` | store rejected the purchase |
| 2012 | `codeReceiptQueuedForRetry` | receipt accepted locally, posting later |
| 2013 | `codePurchaseInProgress` | another purchase is already running |
| 2014 | `codeProductNotAvailable` | unavailable in this storefront |
| 2015 | `codeSignatureVerification` | response signature check failed |
| 2016 | `codeInvalidOffer` | promotional/intro offer is not valid |
| 2017 | `codePurchaseIneligible` | customer is not eligible for this offer |

```ts
catch (error) {
  if (error instanceof AppActorError && error.code === AppActorError.codeReceiptQueuedForRetry) {
    // NOT a lost purchase — show "processing", unlock from onCustomerInfoUpdated
  }
}
```

## Offline

```ts
const keys = await AppActor.instance.activeEntitlementKeysOffline();
const info = await AppActor.instance.getCachedCustomerInfo();
```

## Related

Catalog shape and paywall structure: `appactor-paywalls-and-offerings`.
Remote config and experiment modelling: `appactor-remote-config-and-experiments`.
Diagnosing a customer's live state: `appactor-troubleshooting`.
