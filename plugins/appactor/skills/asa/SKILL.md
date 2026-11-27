---
name: asa
description: Manage Apple Search Ads (ASA) from the conversation — list, create, update, pause, resume and delete campaigns, ad groups, targeting keywords and negative keywords, change bids and daily budgets, and read Apple Ads performance (spend, impressions, taps, installs, TTR, CPT, CPA) with the get_apple_ads_*, manage_apple_ads_* and delete_apple_ads_* MCP tools. Use when someone asks about their Apple Ads account, a campaign or keyword, ASA spend, or why an Apple Ads tool refused a bid or budget. For binding an app to an ASA connection so attribution imports, use appactor:workspace instead.
---

# AppActor — Apple Search Ads

The `*_apple_ads_*` tools talk to Apple's Search Ads API through the Apple Ads
connection stored in AppActor. They manage the **advertising account**;
attribution (`query_analytics { kind: "asa" }`) and binding an app to a
connection (`update_app { asaConnectionName }`) live in `appactor:workspace`.

## The tools

| Tool | Scope | Does |
|---|---|---|
| `get_apple_ads_accounts` | `workspace:read` | ad accounts the connection is authorized for |
| `get_apple_ads_apps` | `workspace:read` | apps owned in Apple Ads, with the `adamId` a campaign promotes |
| `get_apple_ads_campaigns` | `workspace:read` | list (filter `status`), or one campaign by `campaignId` under `campaign` |
| `get_apple_ads_adgroups` | `workspace:read` | list for a `campaignId`, or one by `adGroupId` |
| `get_apple_ads_keywords` | `workspace:read` | targeting keywords of one `adGroupId` — required, Apple has no account-wide list |
| `get_apple_ads_negative_keywords` | `workspace:read` | `campaignId` alone: the campaign-level negatives (`level: "adgroup"`: every ad group-level one in it); `adGroupId`: that ad group's |
| `get_apple_ads_reports` | `analytics:read` | performance rows per campaign, ad group, keyword or search term |
| `manage_apple_ads_campaigns` | `workspace:write` | `create`, `update`, `pause`, `resume` |
| `delete_apple_ads_campaign` | `workspace:delete` | `preview`, then `apply` in a later turn |
| `manage_apple_ads_adgroups` | `workspace:write` | `create`, `update`, `pause`, `resume` |
| `delete_apple_ads_adgroup` | `workspace:delete` | `preview`, then `apply` in a later turn |
| `manage_apple_ads_keywords` | `workspace:write` | `create`, `update_bid`, `pause`, `resume`, `delete` |
| `manage_apple_ads_negative_keywords` | `workspace:write` | `create`, `delete` |

Every one of them, reads included, is a live call to Apple.

## Which connection answers

Every call takes `organizationId` (required) and an optional `connectionName`.
The API checks membership, the consent grant and the `asa.manage` account
permission from the organization, then picks the connection:

| Sent | Result |
|---|---|
| no `connectionName`, organization has one connection | that one — the normal case |
| no `connectionName`, several connections | 400 naming them: pass one back |
| no `connectionName`, no connections | 404: add one in AppActor's Apple Ads settings first |
| `connectionName` | that connection; an unknown name is a 404 that lists the names |
| `connectionName` shared by two connections | 409 with their Apple org ids: names are not unique, ask the user to rename one in the dashboard |

`get_app_setup { organizationId, appId }` on an iOS app lists the names under
`connections.asa.available` (only for a member holding `asa.manage`;
`appactor:workspace` covers the permission). There is no `connectionId`: MCP
reads redact ids, so nothing on this surface takes one.

Three 403s are not scope problems and no retry fixes them: the member lacks
`asa.manage` (the dashboard's Apple Ads pages refuse the same member, and only
an organization owner can grant it); the member's own access is limited to
*selected projects* (Apple Ads management, reads included, needs access to all
projects, in the dashboard as here); or the AI connection was consented for
*selected projects* only. Apple Ads connections are organization-wide, so the
last one is refused on every Apple Ads tool until it is reconnected with all
projects.

## The shape of an account

```
ad account
└── app (adamId)                       get_apple_ads_apps
    └── campaign                       daily budget, countries, status
        ├── negative keywords          campaign-level
        └── ad group                   default bid, optional CPA goal, Search Match
            ├── targeting keywords     text, EXACT | BROAD, bid
            └── negative keywords      ad group-level
```

Ids are Apple's numeric ids and come back from the list tools — there is no
lookup by name, so read the list first and pick from it. A campaign `create`
takes the promoted app's `adamId` from `get_apple_ads_apps`. A negative-keyword
`create` takes `campaignId` alone for a campaign-level negative, or `adGroupId`
alone for an ad group-level one: Apple does not allow `campaignId` on an ad
group-level negative, and the tool refuses both ids together.

## Reports

`get_apple_ads_reports { selector: "campaign" | "adgroup" | "keyword" | "search_term" }`
needs `campaignId` for everything but `campaign`. `adGroupId` narrows **only**
`search_term`; on `adgroup` and `keyword` it is ignored, so a keyword report is
always campaign-wide — filter the rows by ad group yourself if that was asked.

**`summary` totals the returned page, not the window.** Before quoting a total,
raise `limit` (or page with `offset`) until `totalCount` fits, and say which
window and how many rows it covers.

Reports need `analytics:read`, the `query_analytics` scope; `appactor:workspace`
covers what an `insufficient_scope` 403 means.

## Writing

Every `manage_*` call takes an `action` and an `idempotencyKey` (at least 8
characters matching `[A-Za-z0-9._:-]`) and runs through the API's
`mcp_write_operations` ledger — `get_audit_log` records Apple Ads writes just
like other workspace mutations:

- Re-sending a `succeeded` key with the same arguments replays the stored
  result without calling Apple again.
- Create calls never blindly re-POST on a 5xx or network timeout. After a
  timeout, 5xx, or other `uncertain` failure, **retry with the exact same
  `idempotencyKey` and arguments** — never generate a fresh key. On that retry,
  the API searches Apple Ads for a matching object created since the original
  attempt started before sending any second `POST`, preventing duplicates (the
  Apple Ads Platform API does not guarantee unique campaign or ad group names,
  so a new key risks creating a duplicate).
- For batch targeting keyword creation (`manage_apple_ads_keywords` `create`,
  up to 50 keywords per call), if one or more keywords succeed before a later
  keyword fails, the entry stays `uncertain` (never `failed`) with the
  already-created keyword IDs and failure details saved in the error response
  and `get_audit_log`.
- If an immediate retry after MCP's 35-second timeout returns `409 Conflict`
  because the first API request is still in flight, wait briefly and retry with
  the **same** `idempotencyKey`; do not generate a new key. If a request was
  interrupted and stays inactive for 5 minutes, retrying with the same
  `idempotencyKey` after 5 minutes of inactivity transitions the interrupted
  `pending` record to `uncertain` and reclaims/recovers it.
- A deterministic 4xx Apple refusal on a clean single-item attempt marks the
  entry `failed` and burns the key: fix the inputs and use a **new**
  `idempotencyKey`.
- `update`, `update_bid`, `pause`, `resume` and `delete` set a state and are
  safe to repeat with the same key.

`update` is a partial update, as `update_app` in `appactor:workspace`: a field
you omit is never written. It also accepts `status: "ENABLED" | "PAUSED"`,
which is what `pause` and `resume` do. Campaign and ad group `update` can also
move `startTime` and `endTime`; a field left out keeps its current value. A
campaign created without `endTime` runs with no end date, an ad group without
one inherits the campaign's. A campaign `create` runs on Search results unless
`supplyPlacement` names another App Store placement.

**Money is in the account's own currency.** Budgets and bids are plain numbers;
AppActor reads the ad account's currency from Apple and sends every amount in
it. There is no currency field to fill in, and none to guess.

**Ad groups:** `pause` and `resume` change only the status — the bid and every
other setting stay as they are. In a campaign with automated bidding
(`MAX_CONVERSIONS`) the ad groups take their bids from the campaign's strategy,
so an ad group `defaultBid` cannot be changed there: the API refuses it. Change
the campaign instead, or say that the bid is not settable at ad group level.

### Delete is permanent

Apple does not restore a deleted campaign, ad group or keyword, and a campaign
delete takes its ad groups, keywords and ads with it. Pausing is the reversible
form of almost every "turn it off" request; offer it first.

**Campaigns and ad groups** are deleted only by `delete_apple_ads_campaign` and
`delete_apple_ads_adgroup`, the same two calls as `delete_project` in
`appactor:workspace`:

1. `action: "preview"` with `campaignId` (or `adGroupId`) reads the target with
   GETs only and returns its name, status, what goes with it (`impact`), and a
   `previewToken` that expires in five minutes. Show it in full and **end your
   turn.**
2. `action: "apply"` in a **later** turn, with the token, a new
   `idempotencyKey`, and `confirmName` set to the name the user typed in a
   message of their own — not the one from their request or the preview. No
   entity id: the token names the target. Send the same `connectionName` the
   preview used (none if it used none); a token signed for another connection
   is refused. With no person there to type it, do not call apply at all.

They need the `workspace:delete` scope. A connection approved without it gets a
403 `insufficient_scope` on the first call; the user has to reconnect it to
grant the scope, and nothing on the AppActor side fixes that.

**Keywords and negative keywords** still delete through their `manage_*` tool
with no preview step and no `confirmName`, so apply the same standard by hand:
say what will be deleted, end your turn, and send `delete` only after the user
confirms in a message of their own.

## Related

Binding an app to an Apple Ads connection, `asa.manage`, ASA attribution
analytics, idempotency and confirmation rules: `appactor:workspace`. Whether a
specific purchase was attributed: `appactor:troubleshooting`.
