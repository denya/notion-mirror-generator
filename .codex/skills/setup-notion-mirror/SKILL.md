---
name: setup-notion-mirror
description: Scaffold and prepare a reusable Notion backup-plus-mirror for any Notion site, including private local backup, localhost rendering, Cloudflare/Wrangler setup, deployment, verification, and template customization.
---

# Setup Notion Mirror

Use this skill from the root of this repository when a user wants to create a new standalone Notion mirror project from `templates/notion-mirror/`.

## Goal

Take a vague request like "set up a mirror for this Notion site" and turn it into a local backup plus deployed Cloudflare Worker mirror with the right branding and operational docs.

## Workflow

### 1. Collect missing inputs

Ask only for values that cannot be inferred safely.

Required:

- local project/repo slug
- public domain
- root Notion page ID
- site name
- site description

Optional but usually needed:

- Notion workspace slug
- Google Tag ID
- short links JSON and redirect status
- brand label, brand URL, logo URL, theme color
- footer owner/site links

### 2. Ask customization questions

Before scaffolding, ask about template preferences that affect the generated repo:

- brand and footer copy
- logo/favicons
- theme color
- analytics
- short links
- whether they want minimal defaults or a branded setup

If the user already provided preferences, do not re-ask them.

### 3. Help the user gather Notion data

Guide them through:

1. Create a Notion internal integration.
2. Grant it read access to content.
3. Copy the integration secret as `NOTION_API_KEY`.
4. Share the root page with that integration.
5. Extract the root page ID from the Notion URL.
6. Capture the workspace slug if they want workspace-domain hints enforced.

Do not claim the setup is complete until the root page is shared with the integration.

### 4. Help the user gather Cloudflare/Wrangler prerequisites

Confirm or explain:

1. The domain is on Cloudflare.
2. The target hostname is proxied through Cloudflare.
3. Wrangler auth is available via `bunx wrangler login` or `CLOUDFLARE_API_TOKEN`.
4. The token or login can manage Workers, routes/custom domains, KV, R2, and secrets.

### 5. Scaffold the repo

Run from this repo:

```sh
npm run build
node dist/cli/index.js init-mirror data/sites/<project-name>
```

Use `NOTEHOST_CLI_ANSWERS` only for automated/test flows. Prefer interactive prompts for humans unless they explicitly want a scripted run.

### 6. Prepare the generated repo

In the generated repo:

```sh
bun install
bun run setup
bun run backup
bun run serve:local
```

Check:

- `.env` exists
- `.dev.vars` exists
- `NOTION_API_KEY` is present in both files, or the user knows they must fill it manually
- `wrangler.toml` has the expected worker name, custom domain, page ID, and bucket name
- `data/sites/<site-key>/backup/` contains local JSON snapshots
- `http://localhost:8788/` serves the locally exported copy

### 7. Deploy and verify

Deploy:

```sh
./deploy.sh
```

Then verify:

1. Root page loads on the public domain.
2. `sitemap.xml` resolves.
3. `bun run warm:notion` completes successfully.
4. A representative child page loads.
5. Short links redirect with the configured status.
6. Wrangler logs are clean enough for handoff.

If verification fails, keep iterating until the blocker is understood and documented.

## Handoff

When done, report:

- generated repo path
- final config assumptions
- commands run
- verification evidence
- any remaining manual follow-up
