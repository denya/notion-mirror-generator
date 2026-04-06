---
name: setup-notion-mirror
description: Scaffold and prepare a reusable Notion backup-plus-mirror for any Notion site, including private local backup, localhost rendering, Cloudflare/Wrangler setup, deployment, verification, and template customization.
---

# Setup Notion Mirror

Use this skill from the root of this repository when a user wants to create a new standalone Notion mirror project from `templates/notion-mirror/`.

## Goal

Take a vague request like "set up a mirror for this Notion site" and turn it into a local backup plus deployed Cloudflare Worker mirror with the right branding and operational docs.

## Workflow

### 0. Choose the target for this session

Ask this first:

- local-only backup and localhost preview today
- full backup plus Cloudflare deploy

If the user wants local-only today, treat Cloudflare as deferred and do not block progress on it.

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
- backup scope:
  - root crawl only
  - workspace-wide backup including private pages accessible to the integration

Suggested first questions for a fresh local-only onboarding:

1. What folder should I generate the repo into? Recommended: `data/sites/<site-name>`.
2. What is the root Notion page URL?
3. Do you want only the reachable page tree from that root, or all pages the integration can access?
4. What site name and short description should I use for the generated mirror?
5. Do you want minimal defaults for branding today, or custom logo/theme/footer values now?

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

When the user asks how to get the values, explain concretely:

- `NOTION_API_KEY`: Notion sidebar -> Settings -> Connections or Integrations -> create internal integration -> copy secret
- root page sharing: open the page -> `Share` -> invite the integration
- root page ID: copy from the final 32-hex segment in the page URL

If they paste a full Notion URL, extract the page ID for them instead of making them do it manually.

### 4. Help the user gather Cloudflare/Wrangler prerequisites

Confirm or explain:

1. The domain is on Cloudflare.
2. The target hostname is proxied through Cloudflare.
3. Wrangler auth is available via `bunx wrangler login` or `CLOUDFLARE_API_TOKEN`.
4. The token or login can manage Workers, routes/custom domains, KV, R2, and secrets.

Skip this whole step when the user explicitly wants local-only today.

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
export NOTION_API_KEY=...
bun run backup
bun run serve:local
```

Use `bun run backup:workspace` instead of `bun run backup` when they want private pages too.

Check:

- `.env` exists
- `.dev.vars` exists
- `NOTION_API_KEY` is present in both files, or the user knows they must fill it manually
- `wrangler.toml` has the expected worker name, custom domain, page ID, and bucket name
- `data/sites/<site-key>/backup/` contains local JSON snapshots
- `http://localhost:8788/` serves the locally exported copy

For local-only sessions, this is the expected stopping point.

Explicit local-only verification:

1. run `bun run backup` or `bun run backup:workspace`
2. confirm JSON files exist under `data/sites/<site-key>/backup/pages/`
3. run `bun run serve:local`
4. open `http://localhost:8788/`
5. open `http://localhost:8788/__backup/routes.json`
6. confirm at least one representative child page renders from localhost

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

Skip this section entirely for local-only sessions.

## Handoff

When done, report:

- generated repo path
- whether this session stopped at local-only backup/preview or also included Cloudflare
- final config assumptions
- commands run
- verification evidence
- any remaining manual follow-up
