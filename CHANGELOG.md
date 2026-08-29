# Changelog

## 0.3.2

- **SDK skills teach the new offerings and experiments API.** The iOS, Android,
  Flutter, and React Native skills — and the remote-config-and-experiments
  skill — now show `offeringKey`, `getOffering(offeringKey)` / `offering(_:)`,
  `offerings["key"]`, `allOfferings`, the one-call SDK-level `getOffering`, and
  `getExperiment(key)` / `experiment(_:)`, which never returns null and carries
  typed getters with defaults. `offeringByLookupKey` / `offering(lookupKey:)`
  no longer exist in the SDKs (iOS 0.1.13, Android 2.3.15, Flutter 0.0.24,
  React Native 0.1.4), so an agent following the old skills would have written
  code that does not compile.

## 0.3.1

- **The Apple webhook no longer needs a person.** AppActor now writes the App
  Store Server Notifications URL into App Store Connect itself, for both
  Production and Sandbox, using the credential the app is already bound with — so
  an iOS app created with `create_app` arrives with the URL set. The
  `appactor-refund-saver` skill said this "cannot be done from here"; it now says
  what actually happens, including the two cases that still need a person: an app
  AppActor did not create, and an App Store Connect key whose role is Developer,
  which Apple refuses the write from.
- **`get_refund_saver` is no longer annotated read-only.** Reading it advances
  the webhook verification the answer is about — it asks Apple whether the test
  notification arrived and starts a new one if the last attempt settled without
  an answer. That writes verification state and can make Apple deliver a
  notification, so `readOnlyHint` and `idempotentHint` are now false and
  `openWorldHint` true, matching every other tool here whose path reaches a
  store. Hosts use `readOnlyHint` to skip a confirmation prompt; it has to mean
  what it says.
- **The skill now says to wait about a minute between reads.** Each read past the
  last attempt asks Apple for another test notification, and Apple takes minutes
  to start honouring a URL it was just given, so a tight polling loop spends the
  customer's rate limit and changes nothing.

## 0.3.0

- **`create_app` now requires a store credential on both platforms.** It used to
  create an iOS app unbound and warn about it; that produced apps whose product
  sync, restore history and subscription reconciliation were silently off. You
  can now name the credential (`credentialName`), so refusing costs one field
  instead of a trip to the dashboard.
- **Credentials are chosen by name.** Credential ids are redacted out of every
  MCP read, so "more than one credential exists" used to be a dead end. Names are
  unique per organization, so `credentialName: "AnimalSound ASC"` picks one
  exactly. A refusal carries the names that would have worked — except when the
  organization has none, where there is nothing to list and only a person can
  fix it.
- **New `update_app`.** Changes an app's name, bundle ID or package name, bound
  store credential, and Apple Ads connection. It is a partial update: a field you
  omit is never written. Changing the credential or bundle ID re-verifies the
  Apple connection and reports whether it actually works — adding a credential in
  AppActor only checks that the `.p8` parses, it never contacts Apple, so this is
  the first time anyone asks Apple about that specific bundle ID.
- **Apple Ads (ASA) connections can be bound from MCP.** Also by name, also on
  `update_app`, and `null` unbinds. Unlike credentials, Apple Ads names are not
  unique — if two match, the tool refuses and prints the Apple org ids rather
  than binding an app's attribution to the wrong account. `get_app_setup` now
  lists the available connections under `connections.asa`.
- **New Refund Saver tools**, `get_refund_saver` and `manage_refund_saver`, for
  what AppActor answers when Apple asks whether to refund an iOS purchase. One
  `mode` instead of the stored `enabled` + `mode` pair: with the toggle on and
  the mode left at `do_not_handle`, the settings row reads as configured and
  answers Apple nothing. iOS only.
- **New `refunds:read` and `refunds:write` scopes.** **Existing connections have
  to be approved again** before they can use the Refund Saver tools.
  `prefer_grant_full` hands customer money back and a granted refund cannot be
  reversed, so it does not arrive as a silent upgrade to `workspace:write` — and
  it additionally requires the app's name typed back.
- New `appactor-refund-saver` skill, and `appactor-workspace` rewritten around
  the credential and Apple Ads flows.

**Deploy the API first.** Both halves of this release cross the two repos, and
the constraints run in opposite directions: the new scopes have to be registered
with the authorization server before this server advertises them, or
re-authorizing any connection fails outright with `invalid_scope`; while the new
`create_app` refusal shape is rejected by *this* server's previous release. API
first makes the second one a recoverable error on one tool — a `create_app` that
needs a credential decision reports a contract error and creates nothing — for
the few minutes between the deploys. MCP first would break re-authorization
entirely, which is worse. Run `backfill-mcp-scope.ts --apply` with the API
deploy.

## 0.2.0

- `delete_project` and `delete_app`: the first deletes on the MCP surface, behind
  a two-step preview → apply flow. The preview reports what would be destroyed —
  apps, products, catalog bindings, remote configs, experiments, customer token
  balances, secret keys, subscribers, purchases, and the analytics history — and
  returns a five-minute signed token. Apply needs that token plus the name typed
  back by the user, and refuses if the target was renamed or its structure
  changed in between. Subscriber and purchase counts are shown but deliberately
  not pinned, so traffic arriving while the user reads the preview does not void
  their approval.
- A target that is already gone reports `alreadyAbsent: true` rather than
  failing. That covers a target removed elsewhere; a same-key retry of a delete
  that already succeeded replays the original result, as every other write does.
- New `workspace:delete` scope. **Existing connections have to be approved
  again** before they can use the delete tools — creating projects and apps was
  what people approved, and deleting them is a different answer. The consent
  screen shows it as its own tier rather than folding it into "View & change".
- `create_app` now binds an Apple credential to a new iOS app when the
  organization has exactly one, the way it already did for Android and Google
  Play. Unlike Android it never blocks: an iOS app works unbound, so the app is
  created and `appleConnectionWarning` explains what stays off until a
  credential is bound in the dashboard.

## 0.1.0

First public release.

- Remote MCP server at `https://mcp.appactor.com/mcp` with OAuth, covering
  workspace and app setup reads, dashboard analytics, catalog reads, subscriber
  lookup, remote config and experiment reads, the AI write history, and
  controlled writes for products, entitlements, offerings, packages, projects,
  apps, remote config, and experiments.
- Eight skills covering the Flutter, iOS, Android, and React Native SDKs, the
  catalog and paywall model, remote config and experiments, and troubleshooting.
- Consent screen scoping: a connection can be limited to chosen organizations
  and projects.
