# AGENTS Log

Shared coordination log for concurrent agents working in this repo.

Rules:
- Append new entries; do not rewrite older entries unless they are clearly wrong.
- Record only coordination-relevant facts: what changed, what is in progress, blockers, and files/areas to avoid.
- Include commit ids when work is committed.
- Call out unrelated dirty files so other agents do not accidentally stage or revert them.

## 2026-04-05

### Notion mirror
- Scope: `spain.denyamsk.ru/`
- Commit `44c6b43`: keep public Notion pages fast with seeded stale cache.
- Commit `fb2d24a`: preserve foreign Notion links while warming the public root graph.
- Deployed live worker after both commits.
- Worker behavior:
  - cached HTML in KV is served immediately
  - refresh runs in background
  - duplicate page refreshes are coalesced per isolate
  - images are proxied through `/_image/...`
- Warm path:
  - `bun run warm -- /` crawls from the public root page graph
  - search results are only an initial seed, not the final public page count
  - inaccessible Notion pages/blocks are skipped and reported instead of aborting the run
- Foreign Notion workspace pages must stay as original Notion links, not local mirror links.

### Known blockers
- Some links reachable from the public root graph are not accessible to the Notion integration and cannot be mirrored.
- Confirmed inaccessible ids from warm runs include:
  - `c90c0157-cbe4-4966-84f9-8d3fe2b506ad`
  - `5444398c-b150-4355-9d73-ca26214fd438`
  - `9e844299-3ee6-43ef-a236-dc74a12957f1`
  - `b3983450-72dc-4ae6-81d0-cac99c154206`
  - `dd5114aa-4952-44a4-bfe0-7ccf97b095ac`
  - `152b576a-7a9a-805a-a420-e2b1d809b3e8`
  - `fc364f31-a844-4c83-8ac6-ac21d50b9660`

### Areas to avoid unless requested
- Unrelated dirty files outside the Notion mirror currently exist:
  - `src/rewriters/_body-js-string.ts`
  - `src/rewriters/body-rewriter.ts`
  - `src/rewriters/body.js`
  - `src/rewriters/head-rewriter.ts`
  - untracked `package-lock.json`

### Suggested next steps
- If working on mirror coverage, continue from `spain.denyamsk.ru/` only.
- If working on warm coverage, use the root crawl as source of truth rather than raw Notion search counts.

### Public page rendering and preview sync
- Scope: `spain.denyamsk.ru/`
- Commits pushed on `main` for the public-page renderer/design loop:
  - `9743aba`: bring the Spain mirror under source control with safer private publishing and Notion-like rendering
  - `8eda888`: emit stable title-plus-id slugs for internal page navigation
  - `e80495e`: tighten public-page fidelity and canonical routing
  - `0239247`: align main-page cards and internal link rendering with the deployed public-page reference
  - `44c6b43`: keep public Notion pages fast with seeded stale cache
- Live worker was redeployed multiple times during the UI/UX loop and browser-verified on `https://spain.denyamsk.ru/`.
- Current renderer facts:
  - root page id URLs redirect to `/`
  - friendly title-plus-id slugs resolve and are canonical for non-root pages
  - internal page listings and page mentions are enriched with Notion page icons when available
  - YouTube and Google Maps embed URLs are normalized before iframe rendering
  - social tags derive description from page content and image from cover/first image/icon

### Current metadata root cause
- Failing page investigated:
  - `https://spain.denyamsk.ru/digital-nomad-residence-in-spain-2026-97dfbe479af04e8b94d269f07bf7e0a2`
- Findings:
  - live HTML emits valid `og:*` and `twitter:*` tags
  - original failing `og:image` asset was too large for reliable scrapers:
    - source proxy payload: `5177704 bytes`, `5184x3456`
  - working page preview image payload is much smaller:
    - working proxy payload: `181286 bytes`, `1500x1036`
  - new social image variant now works at the proxy layer:
    - `?social=1` payload: `299850 bytes`, `1200x800`
- Outstanding issue:
  - page HTML cache is still serving the old `og:image` URL until that specific page is regenerated and recached
  - root cause is now cache freshness / recache timing, not missing tags or broken image delivery

### Coordination note
- Use `AGENTS-LOG.md` for new coordination entries going forward.

### 2026-04-05 follow-up
- Mentioned pages must remain links; do not inline page-mention content into parent pages.
- Synced blocks should expand from their `synced_from.block_id` source content only.
- Startup guide example checked explicitly:
  - `Checklist for Documents (startup)` is a page mention, not a synced block
  - live page restored to a plain link after rollback
- Live worker redeployed again after the rollback/fix cycle.

### Social preview fix status
- Root cause confirmed and mitigated:
  - some pages used oversized source images for `og:image` / `twitter:image`
  - failing Digital Nomad page source image was `5177704 bytes` at `5184x3456`
  - working preview page image was `181286 bytes` at `1500x1036`
- Fix applied:
  - dedicated social-image proxy variant via `/_image/... ?social=1`
  - Cloudflare image resizing now caps bot-facing social images to `1200x800` JPEG at reduced quality
  - forced warm run used to rewrite the cached HTML for the failing page after deploy
- Verified live:
  - Digital Nomad page now emits `og:image` and `twitter:image` with `?social=1`
  - live resized payload is `299850 bytes`, `1200x800`
- Operational note:
  - after metadata changes, a deploy alone may not be enough; page HTML cached in KV may need an explicit warm/refresh to update scraper-visible tags immediately

### Header bar, breadcrumbs, and light/dark theme toggle
- Scope: `spain.denyamsk.ru/src/template.ts`, `spain.denyamsk.ru/src/index.ts`
- Also touched (NoteHost library, NOT used by deployed site): `src/rewriters/head-rewriter.ts`, `src/rewriters/body.js`, `src/rewriters/_body-js-string.ts`, `src/rewriters/body-rewriter.ts`
- Changes:
  - Added sticky header bar (56px, site name + theme toggle button)
  - Added breadcrumbs on child pages (Home / Page Title)
  - Added light/dark theme toggle with localStorage persistence (`nh-theme` key)
  - Replaced `@media (prefers-color-scheme: dark)` with `[data-theme="dark"]` selectors throughout `template.ts`
  - `renderPage()` now accepts optional `Breadcrumb[]` parameter
  - `fetchAndCachePage()` builds breadcrumbs from page title
  - Theme init script in `<head>` prevents FOUC
- Deployed live worker: version `fd4bb235-5465-4702-b9c4-e7090b3aa8ae`
- Browser-verified on `https://spain.denyamsk.ru/` and child pages
- Note: pages served from old KV cache won't show new header/breadcrumbs until cache expires (24h) or `?refresh=1` succeeds
- Note: `?refresh=1` may time out for very large pages (e.g. Digital Nomad guide) due to Notion API latency

### Frontend design improvements, TOC style, heading anchors
- Scope: `spain.denyamsk.ru/src/template.ts`
- Changes (CSS polish by frontend design agent):
  - Skip-to-content link for accessibility
  - Global `:focus-visible` focus ring styles
  - ARIA landmarks on header/footer
  - `@media (prefers-reduced-motion: reduce)` support
  - Dark mode polish: code color (`--code-color`), h2 bg, text color classes, callout borders, link card hover shadow, selection colors
  - Header: reduced to 48px, frosted glass effect (`backdrop-filter: blur`)
  - Theme toggle: 34x34px, faster transitions
  - Smooth transitions on links, toggles, mentions, child pages
  - Code block border and font size refinement
  - File block links styled with `--link-color-external` (fixes garish blue in dark mode)
- Changes (TOC style — Notion native):
  - Removed border, background, and "ON THIS PAGE" title from TOC
  - TOC links now muted gray (`var(--text-secondary)`), no underlines, hover to full color
  - Indentation: depth-2 at 24px, depth-3 at 48px
- Changes (heading anchor links):
  - 🔗 icon appears on heading hover (hidden by default, `opacity: 0`)
  - Clicking copies the section URL to clipboard, shows ✓ confirmation for 1.5s
  - Positioned to the left of heading (`left: -1.4em`), on mobile shows inline
  - Enhancer script now always runs (not just on pages with TOC)
- Deployed: version `49874047-d14b-4001-aa13-773601dcdea5`
- Operational note: large pages (startup guide) may not refresh via `?refresh=1` due to Notion API timeout; use `bun run warm /slug` to force cache update

### Pending / future improvements
- Rich bookmark previews with OG images (like Notion's native link preview cards with title, description, favicon, and preview image) — requires fetching OG metadata during rendering, significant feature
- Warm script needs re-run after each deploy to update cached HTML in KV

### 2026-04-05 icon regression fix
- Root cause: `renderer.ts` still expected `child_page_icon`, but the fetch path stopped annotating `child_page` blocks after the mention-embedding rollback.
- Fix: restore icon enrichment for `child_page` blocks only in `spain.denyamsk.ru/src/notion-client.ts`.
- Explicitly preserved behavior:
  - page mentions remain links
  - foreign-workspace Notion links remain external
  - only synced blocks may inline shared source content
- Deployed live worker after the fix and rewarmed `/`.
- Verified live: root-page child-page links show their Notion icons again.

### Unicode heading anchors and TOC deduplication
- Scope: `spain.denyamsk.ru/src/renderer.ts`
- Problem: `slugify()` used ASCII-only `\w` regex, stripping all Cyrillic characters. 21 of 41 headings on the Digital Nomad page had `id="-"`, making TOC links non-functional.
- Fix:
  - `slugify()` now uses `[^\p{L}\p{N}\s-]` with the `u` flag to preserve Unicode letters and digits
  - Added `uniqueSlug()` helper that appends `-2`, `-3` etc. on collision, with `"section"` fallback for empty slugs
  - Threaded a shared `usedSlugs: Map<string, number>` through `renderBlocks` → `renderBlock` so IDs are globally unique per page
- Also applied (external/linter): `renderTable` now wraps output in `<div class="table-block">` wrapper
- All 29 existing tests pass; no test changes needed
- Deployed live worker and rewarmed all 28 pages + 80 images
- Verified live: all 41 headings on the Digital Nomad page now have unique Cyrillic IDs (e.g. `самое-важное-про-внж`), zero duplicates
