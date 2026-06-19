import type { SiteConfig } from './config'
import { fetchPageData, getPageIcon, type Block, type PageData, type RichTextItem, getPageTitle } from './notion-client'
import { canonicalPagePath, extractPageId, rewriteNotionPageUrl } from './page-path'

export interface SitemapEntry {
  path: string
  lastModified?: string
}

// A page that is part of the mirror's public root tree: it is either a
// descendant of the root page or reachable by a link/mention from within it.
export interface ReachablePageEntry {
  pageId: string
  title: string
  icon?: string | null
  parentPageId?: string | null
  lastModified?: string
}

interface CollectSitemapOptions {
  onError?: (pageId: string, error: unknown) => void
}

// Crawls outward from the root page following child pages, page links and page
// mentions, returning every reachable page with its metadata. This is the single
// source of truth for which pages belong to the public mirror (TOC + sitemap):
// pages elsewhere in the Notion workspace are never reached and never indexed.
export async function collectReachablePages(
  apiKey: string,
  config: SiteConfig,
  options: CollectSitemapOptions = {},
): Promise<ReachablePageEntry[]> {
  const visited = new Set<string>()
  const queued = new Set<string>()
  const pages = new Map<string, ReachablePageEntry>()
  const pending = [config.rootPageId]
  queued.add(normalizePageId(config.rootPageId))

  while (pending.length > 0) {
    const pageId = pending.shift()
    if (!pageId) {
      break
    }

    const normalizedId = normalizePageId(pageId)
    if (visited.has(normalizedId)) {
      continue
    }

    let pageData: PageData
    try {
      pageData = await fetchPageData(apiKey, pageId)
    } catch (error) {
      visited.add(normalizedId)
      options.onError?.(pageId, error)
      continue
    }

    visited.add(normalizedId)
    pages.set(normalizedId, toReachablePageEntry(pageData.page))

    const reachablePageIds = extractReachablePageIds(pageData.blocks, config.notionWorkspaceSlug)
    for (const reachablePageId of reachablePageIds) {
      const normalizedReachableId = normalizePageId(reachablePageId)
      if (visited.has(normalizedReachableId) || queued.has(normalizedReachableId)) {
        continue
      }

      pending.push(reachablePageId)
      queued.add(normalizedReachableId)
    }
  }

  return [...pages.values()]
}

export async function collectSitemapEntries(
  apiKey: string,
  config: SiteConfig,
  options: CollectSitemapOptions = {},
): Promise<SitemapEntry[]> {
  const pages = await collectReachablePages(apiKey, config, options)
  return normalizeSitemapEntries(
    pages.map((page) => sitemapEntryFromPage(page.pageId, page.title, config.rootPageId, page.lastModified)),
  )
}

function toReachablePageEntry(page: PageData['page']): ReachablePageEntry {
  const icon = getPageIcon(page)
  const parentPageId = page.parent?.type === 'page_id' ? page.parent.page_id || null : null
  return {
    pageId: page.id,
    title: getPageTitle(page),
    ...(icon ? { icon } : {}),
    ...(parentPageId ? { parentPageId } : {}),
    ...(page.last_edited_time ? { lastModified: page.last_edited_time } : {}),
  }
}

export function renderSitemapXml(domain: string, entries: SitemapEntry[]): string {
  const urls = entries.map((entry) => {
    const lastModified = entry.lastModified ? `<lastmod>${escapeXml(entry.lastModified)}</lastmod>` : ''
    return `<url><loc>https://${domain}${entry.path}</loc>${lastModified}</url>`
  })

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`
}

export function sitemapEntryFromPage(
  pageId: string,
  title: string,
  rootPageId: string,
  lastModified?: string,
): SitemapEntry {
  return {
    path: canonicalPagePath(pageId, title, rootPageId),
    ...(lastModified ? { lastModified } : {}),
  }
}

export function staticSitemapEntries(config: SiteConfig): SitemapEntry[] {
  return normalizeSitemapEntries(Object.keys(config.slugToPage).map((slug) => ({
    path: slug ? `/${slug}` : '/',
  })))
}

export function sitemapEntriesFromIndexedPages(
  pages: Iterable<{ path: string; lastModified?: string }>,
  staticEntries: Iterable<SitemapEntry> = [],
): SitemapEntry[] {
  return normalizeSitemapEntries([
    ...[...pages].map((page) => page.lastModified ? { path: page.path, lastModified: page.lastModified } : { path: page.path }),
    ...staticEntries,
  ])
}

export function isStaticOnlySitemapEntries(
  entries: Iterable<SitemapEntry>,
  staticEntries: Iterable<SitemapEntry>,
): boolean {
  const normalizedEntries = normalizeSitemapEntries(entries)
  const allowedPaths = new Set(normalizeSitemapEntries(staticEntries).map((entry) => entry.path))
  if (!allowedPaths.size || normalizedEntries.length > allowedPaths.size) {
    return false
  }

  return normalizedEntries.every((entry) => allowedPaths.has(entry.path))
}

export function normalizeSitemapEntries(entries: Iterable<SitemapEntry>): SitemapEntry[] {
  const deduped = new Map<string, SitemapEntry>()

  for (const entry of entries) {
    if (!entry || typeof entry.path !== 'string' || !entry.path.startsWith('/')) {
      continue
    }

    const existing = deduped.get(entry.path)
    if (!existing || isNewerLastModified(entry.lastModified, existing.lastModified)) {
      deduped.set(entry.path, entry.lastModified ? { path: entry.path, lastModified: entry.lastModified } : { path: entry.path })
    }
  }

  return [...deduped.values()].sort((left, right) => left.path.localeCompare(right.path))
}

function extractReachablePageIds(blocks: Block[], workspaceSlug?: string): string[] {
  const pageIds = new Set<string>()

  const visit = (items: Block[]) => {
    for (const block of items) {
      if (block.type === 'child_page') {
        pageIds.add(block.id)
      }

      if (block.type === 'link_to_page') {
        const linkedPageId = block.link_to_page?.page_id
        if (typeof linkedPageId === 'string') {
          pageIds.add(linkedPageId)
        }
      }

      for (const richTextItems of getRichTextArrays(block)) {
        for (const item of richTextItems) {
          if (item.resolvedPageId) {
            pageIds.add(item.resolvedPageId)
          }

          if (item.type === 'mention' && item.mention?.type === 'page' && item.mention.page?.id) {
            pageIds.add(item.mention.page.id)
          }

          const linkedPageId = getLinkedPageId(item.href, workspaceSlug)
          if (linkedPageId) {
            pageIds.add(linkedPageId)
          }
        }
      }

      if (block._children?.length) {
        visit(block._children)
      }
    }
  }

  visit(blocks)
  return [...pageIds]
}

function getRichTextArrays(block: Block): RichTextItem[][] {
  const arrays: RichTextItem[][] = []
  const data = block[block.type]
  if (!data) {
    return arrays
  }

  if (Array.isArray(data.rich_text)) {
    arrays.push(data.rich_text)
  }

  if (Array.isArray(data.caption)) {
    arrays.push(data.caption)
  }

  if (block.type === 'table_row' && Array.isArray(data.cells)) {
    for (const cell of data.cells) {
      if (Array.isArray(cell)) {
        arrays.push(cell)
      }
    }
  }

  return arrays
}

function getLinkedPageId(href: string | null, workspaceSlug?: string): string | null {
  if (!href) {
    return null
  }

  if (!rewriteNotionPageUrl(href, workspaceSlug)) {
    return null
  }

  return extractPageId(href)
}

function normalizePageId(pageId: string): string {
  return pageId.replace(/-/g, '').toLowerCase()
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function isNewerLastModified(next?: string, current?: string): boolean {
  if (!next) {
    return false
  }

  if (!current) {
    return true
  }

  return next > current
}
