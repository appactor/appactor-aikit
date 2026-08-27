---
name: appactor-refund-saver
description: Configure AppActor Refund Saver — how an iOS app answers Apple when a customer asks for a refund, using the get_refund_saver and manage_refund_saver MCP tools. Use when someone asks about refund requests, refund rates, chargebacks, declining or granting refunds automatically, CONSUMPTION_REQUEST, or why AppActor is or is not responding to Apple about a refund.
---

# AppActor — Refund Saver

When a customer asks Apple for a refund on an iOS purchase, Apple does not just
decide. It sends the developer a `CONSUMPTION_REQUEST` notification asking how
much of the purchase was consumed, and it weighs the answer. There is a **12
hour** deadline; past it AppActor stops trying.

Refund Saver is the setting that decides what AppActor answers. It is iOS only —
there is no equivalent Google Play question — and the tools refuse an Android
app rather than storing a setting that would do nothing.

## The two tools

```
get_refund_saver    { organizationId, appId }
manage_refund_saver { organizationId, appId, idempotencyKey, mode, ... }
```

They need the `refunds:read` and `refunds:write` scopes, which are **newer than
most connections**. A connection approved before they existed gets an HTTP 403
with an `insufficient_scope` challenge on the first call. That is not an AppActor
permissions problem — the user has to re-approve the connection. Say that
plainly rather than sending them to the dashboard.

## The four modes

| mode | What AppActor tells Apple |
|---|---|
| `do_not_handle` | nothing — Refund Saver is off and Apple decides alone |
| `submit_consumption_data` | how much was consumed, with no preference |
| `prefer_decline` | the consumption data, and: please decline this refund |
| `prefer_grant_full` | the consumption data, and: please grant it in full |

`prefer_decline` is what people mean by "save the refund". `prefer_grant_full`
gives customer money back automatically.

## Read before you write

`get_refund_saver` reports `mode` **and** `active`, and they are not the same
thing. The stored settings carry a separate `enabled` flag, and the dashboard can
leave the two disagreeing — the toggle on with the mode left at `do_not_handle`
looks configured and answers Apple nothing.

**Report `active` and `effect`, not `mode` alone.** "Refund Saver is set to
`do_not_handle`" is a true sentence that leaves someone believing a feature is
running when it is not.

`manage_refund_saver` takes only `mode` for exactly this reason: it derives
`enabled` so the pair cannot be left disagreeing.

## The webhook gate

Apple's refund question arrives over the app's **App Store Server Notifications
webhook**. If that webhook is not verified, the question never reaches AppActor
and there is nothing to answer — so turning Refund Saver on is refused until it
is.

`get_refund_saver` reports this as `canEnable`, with the webhook state and a
dashboard link beside it. Webhook setup means pasting a URL into App Store
Connect, so it cannot be done from here. Send the user to the link, and check
`canEnable` again afterwards.

**Turning it off is never gated.** An app whose webhook has broken can still be
switched to `do_not_handle`.

## Granting refunds automatically

`prefer_grant_full` requires `confirmAppName` set to the app's exact name.

A refund Apple has already granted cannot be reversed, so this is the one mode
that costs a round trip. Ask the user in plain terms — "this makes AppActor ask
Apple to refund customers automatically, and that cannot be undone" — and only
send `confirmAppName` after they confirm in a message of their own. If nobody is
there to confirm, do not call it.

The other three modes need no confirmation.

## Consent policy

`consentPolicy` decides whether a customer's consumption data may be sent to
Apple at all: `opt_out` assumes consent, `opt_in` sends nothing unless the
customer explicitly agreed through the SDK.

**Leave it out unless the user raises it.** Omitting it keeps whatever is
already set, and an app that was never configured is already `opt_out`. Sending
it on an unrelated mode change would silently overwrite a deliberate privacy
choice.

## Seeing whether it worked

`query_analytics { kind: "refund_defense", organizationId, appId, windowDays }`
reports what actually happened to refund requests — how many were answered,
declined, granted, skipped or missed the deadline.

The field is `windowDays`, not `days`. The analytics schemas ignore unknown
keys, so `days: 7` is silently dropped and you get the 28-day default back with
no error. And the window is **clamped to 7–90**: ask for 3 and you get 7, again
with nothing saying so. Do not report a shorter window than you asked for.

That is the honest answer to "is Refund Saver working"; the settings only say
what AppActor intends to do.

## Related

Workspace tools, scopes and idempotency rules: `appactor-workspace`. Diagnosing
one customer's purchase: `appactor-troubleshooting`. iOS SDK integration:
`appactor-ios`.
