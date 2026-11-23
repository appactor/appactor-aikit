---
name: remote-config-and-experiments
description: Use AppActor remote config and A/B experiments — config keys and value types, targeting rules, platform overrides, experiment variants and traffic weights, goals and the whale cap, what locks once users are assigned, reading an experiment's verdict, rolling a winning variant out to everyone, and how to read an assignment from the SDK. Use when adding a remote-controlled value, running a paywall or pricing test, deciding whether an experiment has a winner or shipping one, or debugging why a config value or variant assignment is not what was expected.
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
- `newUsersOnly` — when `true`, only users first seen after the start are
  assigned,
- `targetingConditions`, using the same condition grammar as remote config,
- `goals`, one of which is primary,
- `whaleCapCents` — when a money goal is tested, each user counts for at most
  this much revenue, so one big spender cannot decide the result (`null` is the
  default, 50000 cents = $500),
- `variants`, each with a `key`, a `weightBp`, an optional `payload`, and
  exactly one marked `isControl`.

Variant weights must sum to **10000**. The API rejects any other total, so
adding a variant before launch means redistributing, not appending.

### The plan locks at the first assignment

Once any user is assigned, the variants, their weights, the goals and the whale
cap are frozen, and a variant keeps only its `name` editable. On an older
experiment with `bucketingVersion: 1` the traffic allocation is frozen too. A
change is refused with 409 `EXPERIMENT_ANALYSIS_PLAN_LOCKED`, whose
`details.fields` names what was refused; resending the stored value is
accepted. `get_config` shows the state as `lifecycle.analysisPlanLocked` — read
it rather than guessing from the status.

What stays editable (while the experiment is paused): name, description,
targeting, `newUsersOnly`, and on bucketing v2 the traffic allocation.

So settle the split, the goals and the whale cap before `start`. To test a
different split after launch, stop the experiment and create a new run:
`create` with the same `key` makes that key's next `iteration`, with its own
variants and fresh assignments. Two runs of one key cannot run at once. If an
earlier run of the key is rolled out, everyone the new run does not enrol
(outside its traffic or targeting) keeps getting the rolled-out variant.

### Goals and primary metrics

The **primary** goal is what the verdict is about: the first goal with
`isPrimary: true`, else the first goal; no goals at all means one primary goal
on `userToPaidConversionRate`. Every other goal is a **guardrail** — it cannot
win, it can only flag a winner that is proven worse on it.

Metrics: `userToTrialConversionRate`, `userToPaidConversionRate`,
`trialToPaidConversionRate`, `trialsCancellationRate`,
`subscriptionsCancellationRate`, `newTrials`, `newSubscriptions`, `sales`,
`proceeds`, `refunds`, `grossLtvPerUser`, `netLtvPerUser`, `netLtvPerPaidUser`.

Pick the one that matches the change. A paywall copy test should usually be
judged on `userToPaidConversionRate` or `netLtvPerUser`, not on `newTrials` — a
variant can lift trial starts and lose money.

A `userToTrialConversionRate` or `newTrials` primary is judged on each user's
first 7 days after assignment; every other primary, and every guardrail, on the
first 30 days.

### Reading a result

`get_config` returns each experiment's result summary as `results`;
`query_analytics` kind `experiments` returns the same summaries as
`outcomeSummaries`. The verdict is `results.decision`, and there is **one per
experiment**:

| `decision.status` | `decision.reason` | Meaning |
|---|---|---|
| `not_started` | `no_assignments` | nobody assigned yet |
| `collecting` | `no_matured_users`, `insufficient_cohort_span`, `insufficient_payers`, `untestable_counts`, `recomputing` | not enough data yet — wait |
| `locked` | `srm_mismatch` | users did not split as the weights say: **the results cannot be trusted** |
| `inconclusive` | `not_significant`, `rolled_out_before_result`, `finalized_before_result` | nothing proven; the last two mean it never will be |
| `winner` | `null` or `guardrail_regression` | `winnerVariantKey` won the primary goal |
| `control_wins` | `null` | every challenger is proven worse |

- `isReady` is `true` for a `winner` or `control_wins` with no reason. It can be
  `true` while `guardrailStatus` is still `maturing`, so report the two together.
- `guardrailStatus` speaks only about a winner: `none` (no guardrails),
  `maturing` (some guardrail is not tested for the winner yet — this can last
  indefinitely, e.g. a refunds guardrail before any refund), `no_regression`,
  or `guardrail_regression` (the winner is proven worse on a guardrail; do not
  roll it out without saying so). Every other status reads `not_applicable`.
- `earliestVerdictAt` is set while only time holds the verdict back: roughly
  day 14 after the first assignment for a 7-day primary, roughly day 37 for a
  30-day one. It is the earliest possible time, not a promise — enough paying
  users and a significant difference are still needed.
- `primary.best` is the winner, or else the challenger with the best point
  estimate, with its own `verdict` (`better`, `worse`, `inconclusive`,
  `not_tested`). A best that is not the winner is a lead, not a result.
- `srm` is the sample-ratio check: `status` `ok`, `mismatch` or
  `insufficient_data`, and a `reason` of `overall`, `dimensional` (one platform,
  app version or country slice) or `zero_weight_assignments`. A mismatch is
  sticky.
- `frozenAt` is set once the experiment was rolled out: the verdict stopped
  moving that day. `lifecycle.resultsFrozenAt` says the same sooner.

The tests are sequential (always-valid), so looking often does not manufacture
a winner, and a `better` or `worse` verdict is sticky. Per-variant tables, the
D7–D400 horizons and per-guardrail detail are on the dashboard's experiment
page, not in the summary.

`resultMode` (`lifetime_cohort` default, `d30_after_assignment`,
`during_experiment`) changes only the descriptive totals, never the verdict.
Say which mode a total came from when reporting one.

### Reading an assignment in the app

```swift
let test = try await AppActor.shared.experiment("paywall_headline_test")
if test.isVariant("short_copy") { /* … */ }
let headline = test.stringValue(default: "Go premium")
```

Wrappers: `getExperiment("paywall_headline_test")` on Android, Flutter, and
React Native — same shape. The result is never null: `experimentKey`,
`isEnrolled`, `variantKey`, `isVariant(key)`, typed
`boolValue / stringValue / intValue / doubleValue` with a default, and `["key"]`
(`get(key)` on React Native) for JSON payloads. The raw `assignment` underneath
(`getExperimentAssignment` returns it directly) carries `experimentId`,
`experimentKey`, `variantId`, `variantKey`, `payload`, `valueType`, and
`assignedAt`.

**Not being enrolled is normal**, not an error. `isEnrolled` is `false`
(the raw assignment is null) when the customer is outside the traffic
allocation, was seen before the start of a `newUsersOnly` experiment, fails
targeting, or the experiment is neither running nor rolled out. The typed
getters return your default, so control renders with no extra branch — do not
retry.

Assignment is sticky per customer, so a customer sees one variant consistently.
Branch on `variantKey`, or read the variant's `payload` when the variant carries
data (copy, price ordering, feature flags) rather than a single flag.

### Lifecycle

`draft` → `start` → `running`, then `pause`/`resume`, and `stop` when it is
done. `to_draft` returns a paused or stopped experiment to editing, and only if
it never assigned anyone.

**Ship a winner with `rollout_variant`** — not by changing weights, and not by
copying the variant's values into the defaults by hand. It ends the experiment
(`stopped`) and serves that variant to the experiment's whole audience:
everyone matching its targeting plus every user it already assigned, whatever
the traffic allocation or `newUsersOnly`. Apps pick it up within about five
minutes and need no release: the SDK answers a rolled-out user exactly like an
assigned one (`isEnrolled` true, the rolled-out `variantKey`, `assignedAt` = the
rollout time).

- The verdict freezes on the rollout day. Rolling out before there is one
  leaves the experiment `inconclusive` / `rolled_out_before_result` for good,
  so say that before doing it.
- Only a started experiment can roll out: running, paused or stopped, finalized
  included. Rolling out the same variant again changes nothing; another variant
  moves the rollout.
- One rollout per key: rolling out another run of the same key replaces that
  run's rollout, and the result names it in `supersededExperimentId`.
- `clear_rollout` stops serving the variant, and users go back to what they
  would get without it: the app's default, or a running run of the same key if
  that run enrols them. The experiment stays stopped and its results stay
  frozen — it is not a resume.
- While rolled out (`lifecycle.rollout` names the variant), `to_draft` is
  refused.

A stopped experiment's result becomes final about 400 days after its last
assignment (`lifecycle.finalizesAt`, then `lifecycle.isFinalized`). A finalized
experiment can no longer be edited, but it can still be rolled out.

## Doing it from Claude

With the AppActor MCP server connected, both systems are readable and editable
from the conversation.

Read with `get_config`:

- `view: "remote_configs"` — list, scoped by `projectId` or `appId`, filterable
  by `status`, `platform`, and `search`.
- `view: "remote_config"` — one config with its rules, plus the other configs
  sharing its key (the platform overrides).
- `view: "experiments"` — list with variant counts, lifecycle, and result
  summaries.
- `view: "experiment"` — one experiment with its variants, lifecycle, and result
  summary.

**Read before you write.** Every remote config update carries an
`expectedUpdatedAt`, and the variant-weight replace carries an
`expectedVariants` snapshot. The experiment `update`, `update_variant`,
`rollout_variant` and `clear_rollout` actions take an optional
`expectedUpdatedAt` as well. Those come from `get_config`, and a stale value is
rejected — which is the point: it stops two editors from silently overwriting
each other.

Write with `manage_remote_config`:

- `create`, `create_scope_set` (a project default plus per-platform overrides in
  one call), `update`, `update_scope_set`, `replace_rules`.
- `replace_rules` replaces **every** rule on the config. Read the current rules
  first and send the full list, or you will delete the ones you omitted.

Write with `manage_experiments`:

- `create`, `update`, `create_variants`, `update_variant`,
  `replace_variant_weights`, `set_status` with `start`, `pause`, `stop`,
  `resume`, or `to_draft`, and `rollout_variant` / `clear_rollout`.
- `update`, `update_variant` and `replace_variant_weights` work only on a draft
  or paused experiment, and `create_variants` only while it has no variants.
- **Rolling out, starting, or stopping an experiment changes what live
  customers see.** Confirm with the user before any of them.

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
experiment is actually `running`, whether `newUsersOnly` keeps out a test
device that was seen before the start, and whether targeting excludes your test
device. A device that already has an entitlement is a common accidental
exclusion.

**Everyone gets the same variant.** The experiment was probably rolled out:
`lifecycle.rollout` names the variant. Check the key's other runs too — a
running run hands an earlier run's rollout to everyone it does not enrol. To the
SDK a rollout looks exactly like an assignment. `clear_rollout` ends it — after
the user agrees.

**Variant payload is null.** The variant's `valueType` and the shape you decode
have to agree; a `json` payload decoded as a string yields nothing.

## Related

Tool mechanics and idempotency rules: `appactor:workspace`. Catalog and paywall
structure: `appactor:paywalls-and-offerings`. Platform code:
`appactor:flutter`, `appactor:ios`, `appactor:android`,
`appactor:react-native`.
