# Contributing

Thanks for helping improve the AppActor AI Toolkit.

## Getting set up

```bash
bun install
cp .env.example .env

# The server refuses to start without a signing key, and .env.example ships an
# empty one. Generate it into the file:
openssl ecparam -genkey -name prime256v1 | openssl pkcs8 -topk8 -nocrypt \
  | awk 'BEGIN{printf "MCP_INTERNAL_JWT_PRIVATE_KEY=\""} {printf "%s\\n", $0} END{print "\""}' >> .env

bun run dev
```

## Before you open a pull request

```bash
bun run typecheck
bun run lint
bun run test
```

All three must pass. `bun run lint:fix` applies the formatter.

## Skills

Skills live in `plugins/appactor/skills/<name>/SKILL.md` and need frontmatter
with a `name` matching the directory and a `description` specific enough that an
agent can tell it apart from the others — the description is the only thing seen
when deciding whether to load it.

Write skills from the SDK sources, not from documentation. A skill that repeats
the docs adds nothing; a skill that records what only the code shows — an
ordering constraint, an error code, a method that exists on one type and not
another — is why they are worth loading. `tests/skills.test.ts` checks the
manifest, the frontmatter, and that every skill is reachable from another.

## Tools

A new tool needs, in this order: the AppActor API route that backs it, a scope
in `src/scopes.ts`, a request and response contract in `src/contracts/`, a
client method in `src/appactor-api.ts`, and a registration in `src/tools/`.

Read tools must be annotated `readOnlyHint`. Write tools take a client-generated
`idempotencyKey` and must be safe to replay. Anything destructive belongs in the
dashboard, not here.

## Reporting a security issue

Email dev@appactor.com rather than opening a public issue.
