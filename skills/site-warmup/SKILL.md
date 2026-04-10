---
name: site-warmup
description: Warm a generated Notion mirror cache after renderer, template, or content changes.
user-invocable: true
---

# Site Warmup

Use this skill inside a generated mirror repo after it has been scaffolded from `templates/notion-mirror/`.

## Goal

Warm the deployed site without doing unnecessary Notion refetches.

Default behavior:

- reuse local page snapshots from `.cache/warm-cache/`
- rerender HTML from those snapshots
- upload rendered pages to remote Cloudflare KV
- verify the live pages
- warm only image proxy URLs that have not already been warmed

## Command selection

Run commands from the generated mirror repo root.

- Default warm after CSS, renderer, template, or metadata changes:
  `bun run warm`
- Refresh Notion content before rerendering:
  `bun run warm:notion`
- Force image rewarming while keeping local page snapshots:
  `bun run warm:images`
- Force both Notion refetch and image rewarming:
  `bun run warm:fresh`

## Notes

- `bun run warm` is intentionally the cheap path.
- Use `--workspace` only when the user wants broad workspace warming rather than a specific page or root crawl.
- If the command output shows live-page verification failures, treat the warmup as incomplete and investigate before claiming success.
