---
name: setup-notion-mirror
description: Finish first-time setup for this generated Notion backup-plus-mirror repo: local env files, local backup export, localhost serving, Cloudflare resources, first deploy, cache warmup, verification, and initial customization.
---

# Setup Notion Mirror

Use this skill inside a generated backup/mirror repo after it has been scaffolded.

## Goal

Take the repo from freshly generated to backed up locally, locally previewable, deployed, and verified.

If the user says they only want the local static copy today, stop after the local verification section and defer Cloudflare.

## Prerequisites

Confirm before running commands:

- `NOTION_API_KEY` exists and the Notion integration can access the shared root page
- Cloudflare auth is available through `bunx wrangler login` or `CLOUDFLARE_API_TOKEN`
- `wrangler.toml` has the correct domain route, worker name, root page ID, and bucket name

## Commands

Run from the generated repo root:

```sh
bun install
bun run setup
export NOTION_API_KEY=...
bun run backup
bun run serve:local
./deploy.sh
bun run warm:notion
```

Use `bun run backup:workspace` instead of `bun run backup` when they want private pages accessible to the integration.
Use `bun run warm` for template-only changes after the initial setup.

## Verification

Verify all of the following before closing the task:

- `data/sites/<site-key>/backup/` contains JSON page backups
- `http://localhost:8788/` loads after `bun run serve:local`
- `http://localhost:8788/__backup/routes.json` returns the backed-up routes
- `https://<your-domain>/` loads
- `/sitemap.xml` returns XML
- at least one child page resolves
- branding, footer, and analytics settings match the intended values
- `bun run warm:notion` finishes without live-page verification failures

For local-only sessions, the first three checks are enough; skip the Cloudflare checks.

If verification fails, inspect:

```sh
bun run logs
```

## Customization

Ask the user whether they want follow-up changes in:

- `src/config.ts` for branding, footer, theme, and metadata
- `src/template.ts` for layout, typography, and styling
- short links, analytics, and footer links
