---
name: site-warmup
description: Warm the generated Notion mirror cache after template, renderer, or content changes.
---

# Site Warmup

Use this skill when a user asks to warm the deployed mirror cache.

## Commands

Run from the repo root:

- `bun run warm` for renderer, metadata, and template-only changes
- `bun run warm:notion` when Notion content changed
- `bun run warm:images` when image cache state changed
- `bun run warm:fresh` for a full refetch and rewarm

## Notes

- `bun run warm` reuses local page snapshots when possible.
- `bun run warm:notion` is the safe path when content changed in Notion.
- If live verification fails during warming, treat the warmup as incomplete and investigate before closing the task.
