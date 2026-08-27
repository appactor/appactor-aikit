# Changelog

## Unreleased

- `delete_project` and `delete_app`: the first deletes on the MCP surface, behind
  a two-step preview → apply flow. The preview reports what would be destroyed
  and returns a five-minute signed token; apply needs that token plus the name
  typed back by the user, and refuses if the target was renamed or its contents
  changed in between. An already-deleted target reports `alreadyAbsent` instead
  of failing, so a retry after an interrupted delete is not a dead end.
- New `workspace:delete` scope. **Existing connections have to be approved
  again** before they can use the delete tools — creating projects and apps was
  what people approved, and deleting them is a different answer. The consent
  screen shows it as its own tier rather than folding it into "View & change".
- `create_app` now binds an Apple credential to a new iOS app when the
  organization has exactly one, the way it already did for Android and Google
  Play. Unlike Android it never blocks: an iOS app works unbound, so the app is
  created and the response carries `appleCredentialNotice` explaining what stays
  off until a credential is bound in the dashboard.

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
