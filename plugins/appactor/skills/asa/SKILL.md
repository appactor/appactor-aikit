---
name: asa
description: Manage Apple Search Ads (ASA) from the conversation — list, create, update, pause, resume and delete campaigns, ad groups, targeting keywords and negative keywords, change bids and daily budgets, and read Apple Ads performance (spend, impressions, taps, installs, TTR, CPT, CPA) with the get_apple_ads_* and manage_apple_ads_* MCP tools. Use when someone asks about their Apple Ads account, a campaign or keyword, ASA spend, or why an Apple Ads tool refused a bid or budget. For binding an app to an ASA connection so attribution imports, use appactor:workspace instead.
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
| `get_apple_ads_negative_keywords` | `workspace:read` | negatives at campaign (`campaignId`) or ad group (`adGroupId`) level |
| `get_apple_ads_reports` | `analytics:read` | performance rows per campaign, ad group, keyword or search term |
| `manage_apple_ads_campaigns` | `workspace:write` | `create`, `update`, `pause`, `resume`, `delete` |
| `manage_apple_ads_adgroups` | `workspace:write` | `create`, `update`, `pause`, `resume`, `delete` |
| `manage_apple_ads_keywords` | `workspace:write` | `create`, `update_bid`, `pause`, `resume`, `delete` |
| `manage_apple_ads_negative_keywords` | `workspace:write` | `create`, `delete` |

Every one of them, reads included, is a live call to Apple.

## Which connection answers

Every call takes an optional `connectionId`. **Today it is not optional in
practice:** without it the production API answers `No active Apple Search Ads
connection or credential profile found for this organization` on every tool,
and `organizationId` is accepted but never read. No MCP read returns a
connection id (`appactor:workspace` explains why ids are redacted), so the only
source is the user. Ask once; if they do not have one, say the Apple Ads tools
cannot be used from here yet and point them at the dashboard's Apple Ads pages.
Do not retry without an id and do not guess one. The intended fix is a
`connectionName` selector like `update_app`'s `asaConnectionName`.

Never send `profile`: it selects a local developer profile and production
rejects it.

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
takes the promoted app's `adamId` from `get_apple_ads_apps`; a negative-keyword
`create` scopes to one ad group when `adGroupId` is sent with `campaignId`.

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

Every `manage_*` call takes an `action` and an `idempotencyKey`, **but the API
keeps no ledger for Apple Ads writes**: a repeated call is sent to Apple again,
nothing is replayed, and `get_audit_log` does not record it. A `create` that
failed with a timeout or a 5xx may or may not have reached Apple — read the
list first and re-send only if the object is not there; sending it twice
creates two. `update`, `update_bid`, `pause`, `resume` and `delete` set a state
and are safe to repeat.

`update` is a partial update, as `update_app` in `appactor:workspace`: a field
you omit is never written. It also accepts `status: "ENABLED" | "PAUSED"`,
which is what `pause` and `resume` do.

### The safety guard

The API refuses a **bid above 10** or a **daily budget above 500** in the
account's currency. The error reads *"Safety Guard: … Use force=true if you
deliberately intend …"* — but `force` is not a field these tools accept, so no
retry will pass. Tell the user the limit and that a higher amount is set in the
dashboard, and stop.

### Delete is permanent

Apple does not restore a deleted campaign, ad group or keyword. Pausing is the
reversible form of almost every "turn it off" request. These tools have no
preview step and no `confirmName`, so apply the `appactor:workspace` deletion
standard by hand: say what will be deleted, end your turn, and send `delete`
only after the user confirms in a message of their own.

## Related

Binding an app to an Apple Ads connection, `asa.manage`, ASA attribution
analytics, idempotency and confirmation rules: `appactor:workspace`. Whether a
specific purchase was attributed: `appactor:troubleshooting`.
