# <%= domainName %>

Notion backup + mirror for `<%= domainName %>` using the Notion API, local JSON/static export, and Cloudflare Workers with KV and R2.

## Inputs you need

Before first run, gather:

1. `NOTION_API_KEY` from a Notion internal integration with read access
2. the root page shared with that integration
3. the root page ID from the Notion URL
4. Cloudflare access for Workers, KV, R2, routes/custom domains, and secrets

## System model

This repo now has two serving targets built from the same Notion fetch/render pipeline:

1. local backup under `data/sites/<%= packageJsonName %>/`
2. Cloudflare deploy backed by KV, R2, and stale-while-revalidate worker responses

The intended flow is:

1. fetch page data from the Notion API
2. persist local JSON snapshots and static HTML/assets under `data/sites/<%= packageJsonName %>/`
3. optionally serve the same rendered output locally on `localhost`
4. warm Cloudflare caches and serve stale cached content while background refreshes repopulate KV/R2

## First run

```sh
bun install
bun run setup
```

`bun run setup` creates `.env` and `.dev.vars` from the examples and copies `NOTION_API_KEY` into both files when that env var is already present in your shell.

Deploy with:

```sh
./deploy.sh
```

`./deploy.sh` creates the KV namespace if needed, creates the R2 bucket if needed, stores `NOTION_API_KEY` as a Wrangler secret, and deploys the worker.

## Local backup and localhost mirror

Create a local backup from the current root crawl:

```sh
bun run backup
```

Create a broader workspace backup, including private pages accessible to the integration:

```sh
bun run backup:workspace
```

This writes:

- JSON page backups to `data/sites/<%= packageJsonName %>/backup/`
- a static locally-renderable site to `data/sites/<%= packageJsonName %>/site/`

Serve the local backup on `localhost:8788`:

```sh
bun run serve:local
```

Useful local route:

- `/__backup/routes.json` lists every backed-up local page path, including private pages captured through workspace backup

## Verify the result

After deploy, run:

```sh
bun run warm:notion
```

Then verify:

- the root page loads
- `sitemap.xml` resolves
- a representative child page loads
- any configured short links redirect correctly
- local backup is still launchable with `bun run serve:local`

## Cache warming

Use:

- `bun run warm` for renderer and template-only changes
- `bun run warm:notion` when Notion content changed
- `bun run warm:images` when remote image cache state changed
- `bun run warm:fresh` for a full refresh

If you are driving this through Codex or Claude Code, use the repo-local skills in `.codex/skills/setup-notion-mirror/` and `.codex/skills/site-warmup/`.
