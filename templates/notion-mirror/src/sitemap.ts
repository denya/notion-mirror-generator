import type { SiteConfig } from './config'
import { fetchPageData, type Block, type PageData, type RichTextItem, getPageTitle } from './notion-client'
import { canonicalPagePath, extractPageId, rewriteNotionPageUrl } from './page-path'

export interface SitemapEntry {
  path: string
  lastModified?: string
}

interface CollectSitemapOptions {
  onError?: (pageId: string, error: unknown) => void
}

export async function collectSitemapEntries(
  apiKey: string,
  config: SiteConfig,
  options: CollectSitemapOptions = {},
): Promise<SitemapEntry[]> {
  const visited = new Set<string>()
  const queued = new Set<string>()
  const entries = new Map<string, SitemapEntry>()
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

    const title = getPageTitle(pageData.page)
    const entry = sitemapEntryFromPage(pageData.page.id, title, config.rootPageId, pageData.page.last_edited_time)
    entries.set(entry.path, entry)

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

  return normalizeSitemapEntries(entries.values())
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
