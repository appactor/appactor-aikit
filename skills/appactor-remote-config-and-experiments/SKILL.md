---
name: appactor-remote-config-and-experiments
description: Use AppActor remote config and A/B experiments — config keys and value types, targeting rules, platform overrides, experiment variants and traffic weights, primary metrics, and how to read an assignment from the SDK. Use when adding a remote-controlled value, running a paywall or pricing test, or debugging why a config value or variant assignment is not what was expected.
---

# AppActor — remote config and experiments

Two related systems. Remote config changes a value for everyone (or for a
targeted slice). An experiment splits customers across variants and measures the
revenue outcome.

## Remote config

A config is a key with a typed default and optional rules.

- **valueType**: `boolean`, `number`, `string`, or `json`.
- **Scope**: attached to a project, or to a single app. A project-scoped config
  can carry per-platform overrides for `ios` and `android`, which is how one key
  serves both apps with different defaults.
- **Rules**: an ordered list, each with a `priority`, a value, and conditions.
  The first matching rule wins; the default applies when none match.

Condition types are `store`, `app_version`, `country`, and `entitlement`.
Operators are `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`, `has`,
`not_has`.

That set is deliberately small, and it is enough for the things that actually
come up: hide a paywall variant below a minimum `app_version`, price
differently by `country`, suppress an upsell for customers who already `has` an
entitlement, or branch on `store`.

### Reading it in the app

```dart
final showTrial = await AppActor.instance.getRemoteConfigBool('show_trial');
```

The typed accessors exist on every SDK (`getRemoteConfigBool`,
`getRemoteConfigString`, `getRemoteConfigNumber`, `getRemoteConfigInt`) and all
of them return null when the key is missing **or when the stored type does not
match the accessor**. So:

```dart
final showTrial = await AppActor.instance.getRemoteConfigBool('show_trial') ?? false;
```

Always supply your own default. A config you added in the dashboard an hour ago
is null on a client that has not synced yet, and a key you renamed is null
forever on already-shipped versions.

`getCachedRemoteConfigs()` returns the last synced snapshot without a network
call — the right choice on a launch path where you cannot wait.

### Rules of thumb

- Treat a config key like published API: shipped clients read it by name, so
  renaming one breaks them. Add a new key instead.
- Keep a config's `valueType` stable. Changing `string` to `json` makes every
  shipped `getRemoteConfigString` call return null.
- Prefer one `json` config over ten booleans when the values change together —
  a client either has the whole new shape or the whole old one, instead of a
  half-applied mix.

## Experiments

An experiment lives on one **app** and has:

- a `key` (letters, digits, hyphens, underscores — your code matches on it),
- `trafficAllocationBp`, in basis points out of 10000: `10000` is everyone,
  `2000` is 20% of customers,
- `targetingConditions`, using the same condition grammar as remote config,
- `goals`, one of which is primary,
- `variants`, each with a `key`, a `weightBp`, an optional `payload`, and
  exactly one marked `isControl`.

Variant weights must sum to **10000**. The API rejects any other total, so
adding a variant means redistributing, not appending.

### Primary metrics

The metric the experiment is judged on, chosen from:
`userToTrialConversionRate`, `userToPaidConversionRate`,
`trialToPaidConversionRate`, `trialsCancellationRate`,
`subscriptionsCancellationRate`, `newTrials`, `newSubscriptions`, `sales`,
`proceeds`, `refunds`, `grossLtvPerUser`, `netLtvPerUser`, `netLtvPerPaidUser`.

Pick the one that matches the change. A paywall copy test should usually be
judged on `userToPaidConversionRate` or `netLtvPerUser`, not on `newTrials` — a
variant can lift trial starts and lose money.

### Result modes

Results can be read three ways: `lifetime_cohort` (default),
`d30_after_assignment`, and `during_experiment`. They answer different
questions, and a variant can win under one and lose under another. Say which
mode a number came from when reporting a result.

### Reading an assignment in the app

```swift
let assignment = try await AppActor.shared.getExperimentAssignment(
    experimentKey: "paywall_headline_test"
)
```

The assignment carries `experimentId`, `experimentKey`, `variantId`,
`variantKey`, `payload`, `valueType`, and `assignedAt`.

**A `null` assignment is normal**, not an error. It means the customer is not in
the experiment — outside the traffic allocation, failing targeting, or the
experiment is not running. Render the control experience and do not retry.

Assignment is sticky per customer, so a customer sees one variant consistently.
Branch on `variantKey`, or read the variant's `payload` when the variant carries
data (copy, price ordering, feature flags) rather than a single flag.

### Lifecycle

`draft` → `start` → `running`, then `pause`/`resume`, and `stop` when it is
done. `to_draft` returns a not-yet-started experiment to editing.

Stopping does not roll anything back on its own. Whatever the winning variant
changed still needs to be made the default — in remote config, in the catalog,
or in code.

Do not change variant weights mid-flight unless you accept that the results are
now a mix of two allocations. Prefer stopping and starting a clean experiment.

## Doing it from Claude

With the AppActor MCP server connected, both systems are readable and editable
from the conversation.

Read with `get_config`:

- `view: "remote_configs"` — list, scoped by `projectId` or `appId`, filterable
  by `status`, `platform`, and `search`.
- `view: "remote_config"` — one config with its rules, plus the other configs
  sharing its key (the platform overrides).
- `view: "experiments"` — list with variant counts and result summaries.
- `view: "experiment"` — one experiment with its variants and analysis.

**Read before you write.** Every remote config update carries an
`expectedUpdatedAt`, and the variant-weight replace carries an
`expectedVariants` snapshot. Those come from `get_config`, and a stale value is
rejected — which is the point: it stops two editors from silently overwriting
each other.

Write with `manage_remote_config`:

- `create`, `create_scope_set` (a project default plus per-platform overrides in
  one call), `update`, `update_scope_set`, `replace_rules`.
- `replace_rules` replaces **every** rule on the config. Read the current rules
  first and send the full list, or you will delete the ones you omitted.

Write with `manage_experiments`:

- `create`, `update`, `create_variants`, `update_variant`,
  `replace_variant_weights`, and `set_status` with `start`, `pause`, `stop`,
  `resume`, or `to_draft`.
- **Starting or stopping an experiment changes what live customers see.**
  Confirm with the user before either.

Every mutation takes a client-generated `idempotencyKey`. Deleting a config, an
experiment, or a variant is not available from MCP — those stay in the
dashboard.

`get_audit_log` shows what AI clients already changed, including operations that
ended `pending` or `uncertain` and need a human to look at the resource.

## Debugging

**A config value is not what I set.** Check, in order: has the client synced
since the change (`getCachedRemoteConfigs` shows what it actually holds); does a
higher-priority rule match this customer; is the config app-scoped when you
edited the project-scoped one (or the reverse); does the accessor type match the
config's `valueType`.

**Everyone is getting control.** Check `trafficAllocationBp`, whether the
experiment is actually `running`, and whether targeting excludes your test
device. A device that already has an entitlement is a common accidental
exclusion.

**Variant payload is null.** The variant's `valueType` and the shape you decode
have to agree; a `json` payload decoded as a string yields nothing.

## Related

Tool mechanics and idempotency rules: `appactor-workspace`. Catalog and paywall
structure: `appactor-paywalls-and-offerings`. Platform code:
`appactor-flutter`, `appactor-ios`, `appactor-android`,
`appactor-react-native`.
