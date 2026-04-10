import type { Env } from './config'
import { getCachedOgMetadata, isCachedOgFresh, setCachedOgMetadata } from './cache'
import { fetchOgMetadata, getKnownOgMetadata, type OgMetadata } from './og-metadata'
import { extractPageId, pagePath } from './page-path'

const NOTION_API = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'
const CHILD_FETCH_CONCURRENCY = 12
const PUBLIC_NOTION_API = 'https://www.notion.so/api/v3/loadPageChunk'
const MAX_BLOCK_DEPTH = 6
const OG_METADATA_REVALIDATE_SECONDS = 60 * 60 * 24 * 7

export interface RichTextItem {
  type: string
  plain_text: string
  href: string | null
  resolvedHref?: string | null
  resolvedPageId?: string | null
  annotations: {
    bold: boolean
    italic: boolean
    strikethrough: boolean
    underline: boolean
    code: boolean
    color: string
  }
  text?: { content: string; link: { url: string } | null }
  pageIcon?: string | null
  mention?: {
    type: string
    page?: { id: string }
    database?: { id: string }
    date?: { start: string; end?: string | null; time_zone?: string | null }
    link_preview?: { url: string }
    user?: { id: string; name?: string }
  }
}

export interface Block {
  object: string
  id: string
  type: string
  has_children: boolean
  [key: string]: any
  _children?: Block[]
}

export interface Page {
  object: string
  id: string
  last_edited_time?: string
  parent?: {
    type: string
    page_id?: string
    database_id?: string
    block_id?: string
    workspace?: boolean
  }
  icon: { type: string; emoji?: string; external?: { url: string }; file?: { url: string } } | null
  cover: { type: string; external?: { url: string }; file?: { url: string } } | null
  properties: Record<string, any>
  url: string
}

export interface PageData {
  page: Page
  blocks: Block[]
  childPages: { id: string; title: string }[]
}

interface PageReferenceMetadata {
  title: string | null
  icon: string | null
  isAccessible: boolean
}

async function notionFetch(apiKey: string, path: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(`${NOTION_API}${path}`)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
  }

  const resp = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
  })

  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`Notion API error ${resp.status}: ${body}`)
  }

  return resp.json()
}

const pageLookupCache = new Map<string, Promise<Page>>()

function getParentPageId(page: Page): string | null {
  return page.parent?.type === 'page_id' ? page.parent.page_id || null : null
}

function normalizePageId(pageId: string): string {
  return pageId.replace(/-/g, '')
}

async function fetchPageById(apiKey: string, pageId: string): Promise<Page> {
  const cacheKey = normalizePageId(pageId)
  const existing = pageLookupCache.get(cacheKey)
  if (existing) {
    return existing
  }

  const pending = notionFetch(apiKey, `/pages/${pageId}`) as Promise<Page>
  pageLookupCache.set(cacheKey, pending)

  try {
    return await pending
  } catch (error) {
    pageLookupCache.delete(cacheKey)
    throw error
  }
}

export async function fetchPageAncestors(
  apiKey: string,
  page: Page,
  rootPageId: string,
): Promise<Array<{ id: string; title: string }>> {
  const ancestors: Array<{ id: string; title: string }> = []
  const seenPageIds = new Set<string>()
  const normalizedRootPageId = normalizePageId(rootPageId)
  let currentParentId = getParentPageId(page)

  while (currentParentId) {
    const normalizedParentId = normalizePageId(currentParentId)
    if (normalizedParentId === normalizedRootPageId || seenPageIds.has(normalizedParentId)) {
      break
    }

    seenPageIds.add(normalizedParentId)

    const parentPage = await fetchPageById(apiKey, currentParentId)
    ancestors.unshift({
      id: parentPage.id,
      title: getPageTitle(parentPage),
    })

    currentParentId = getParentPageId(parentPage)
  }

  return ancestors
}

export async function fetchPageData(apiKey: string, pageId: string, env?: Env): Promise<PageData> {
  const [page, blocks] = await Promise.all([
    notionFetch(apiKey, `/pages/${pageId}`) as Promise<Page>,
    fetchAllBlocks(apiKey, pageId),
  ])
  await attachPageIcons(apiKey, blocks)
  if (env) {
    await attachBookmarkMetadata(env, blocks)
  }
  const childPages = extractChildPages(blocks)

  return { page, blocks, childPages }
}

async function fetchAllBlocks(apiKey: string, blockId: string, depth = 0): Promise<Block[]> {
  if (depth > MAX_BLOCK_DEPTH) return []

  const blocks: Block[] = []
  let cursor: string | undefined

  do {
    const params: Record<string, string> = { page_size: '100' }
    if (cursor) params.start_cursor = cursor

    const response = await notionFetch(apiKey, `/blocks/${blockId}/children`, params)

    const childBlocks: Block[] = []

    for (const block of response.results as Block[]) {
      blocks.push(block)

      if (block.has_children && block.type !== 'child_page' && block.type !== 'child_database') {
        childBlocks.push(block)
      }
    }

    await mapWithConcurrency(childBlocks, CHILD_FETCH_CONCURRENCY, async (block) => {
      const syncedFromId = block.type === 'synced_block' ? block.synced_block?.synced_from?.block_id : undefined
      const childSourceId = syncedFromId || block.id
      block._children = await fetchAllBlocks(apiKey, childSourceId, depth + 1)
    })

    cursor = response.has_more ? response.next_cursor : undefined
  } while (cursor)

  return blocks
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (!items.length) {
    return
  }

  let index = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index
      const current = items[currentIndex]
      index += 1
      await worker(current, currentIndex)
    }
  })

  await Promise.all(runners)
}

function extractChildPages(blocks: Block[]): { id: string; title: string }[] {
  return blocks
    .filter((b) => b.type === 'child_page')
    .map((b) => ({
      id: b.id,
      title: b.child_page?.title ?? 'Untitled',
    }))
}

async function attachPageIcons(apiKey: string, blocks: Block[]): Promise<void> {
  const allPageIds = [...new Set([...collectChildPageIds(blocks), ...collectMentionPageIds(blocks)])]
  const linkedPageIds = collectLinkedHrefPageIds(blocks)
  const knownPageIds = [...new Set([...allPageIds, ...linkedPageIds])]
  if (!knownPageIds.length) {
    return
  }

  const metadataByPageId = new Map<string, PageReferenceMetadata>()

  await mapWithConcurrency(knownPageIds, 6, async (pageId) => {
    metadataByPageId.set(pageId, await fetchPageReferenceMetadata(apiKey, pageId))
  })

  const visit = (items: Block[]) => {
    for (const block of items) {
      if (block.type === 'child_page') {
        const metadata = metadataByPageId.get(block.id)
        ;(block as any).child_page_icon = metadata?.icon ?? null
        if (metadata?.title && isUntitled(block.child_page?.title)) {
          block.child_page.title = metadata.title
        }
      }

      for (const richTextItems of getRichTextArrays(block)) {
        for (const item of richTextItems) {
          const linkedPageId = item.href ? extractPageId(item.href) : null
          if (linkedPageId) {
            const metadata = metadataByPageId.get(linkedPageId)
            if (metadata?.isAccessible) {
              item.resolvedPageId = linkedPageId
              item.resolvedHref = pagePath(linkedPageId, metadata.title)
            }
          }

          if (item.type === 'mention' && item.mention?.type === 'page' && item.mention.page?.id) {
            const metadata = metadataByPageId.get(item.mention.page.id)
            item.pageIcon = metadata?.icon ?? null
            if (metadata?.title && isUntitled(item.plain_text)) {
              item.plain_text = metadata.title
            }
            if (metadata?.isAccessible) {
              item.resolvedPageId = item.mention.page.id
              item.resolvedHref = pagePath(item.mention.page.id, metadata.title)
            }
          }
        }
      }

      if (block._children?.length) {
        visit(block._children)
      }
    }
  }

  visit(blocks)
}

async function fetchPageReferenceMetadata(apiKey: string, pageId: string): Promise<PageReferenceMetadata> {
  try {
    const page = await notionFetch(apiKey, `/pages/${pageId}`) as Page
    return {
      title: getPageTitle(page),
      icon: getPageIcon(page),
      isAccessible: true,
    }
  } catch {
    return fetchPublicPageReference(pageId)
  }
}

async function fetchPublicPageReference(pageId: string): Promise<PageReferenceMetadata> {
  try {
    const resp = await fetch(PUBLIC_NOTION_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pageId,
        limit: 1,
        chunkNumber: 0,
        verticalColumns: false,
      }),
    })

    if (!resp.ok) {
      return { title: null, icon: null, isAccessible: false }
    }

    const payload = await resp.json() as any
    const publicPage = payload?.recordMap?.block?.[pageId]?.value?.value
    return {
      title: getPublicPageTitle(publicPage),
      icon: getPublicPageIcon(publicPage),
      isAccessible: false,
    }
  } catch {
    return { title: null, icon: null, isAccessible: false }
  }
}

function getPublicPageTitle(publicPage: any): string | null {
  const title = publicPage?.properties?.title
  if (!Array.isArray(title)) {
    return null
  }

  const parts: string[] = []
  for (const segment of title) {
    if (Array.isArray(segment) && typeof segment[0] === 'string') {
      parts.push(segment[0])
    }
  }

  const joined = parts.join('').trim()
  return joined || null
}

function getPublicPageIcon(publicPage: any): string | null {
  const icon = publicPage?.format?.page_icon
  if (typeof icon !== 'string' || !icon.trim()) {
    return null
  }

  return /^(https?:)?\/\//i.test(icon) || !icon.includes(':')
    ? icon
    : null
}

function isUntitled(value: string | null | undefined): boolean {
  return !value || value.trim() === '' || value.trim() === 'Untitled'
}

async function attachBookmarkMetadata(env: Env, blocks: Block[]): Promise<void> {
  const urlToBlocks = new Map<string, Block[]>()

  const visit = (items: Block[]) => {
    for (const block of items) {
      const url = getBookmarkUrl(block)
      if (url) {
        const matches = urlToBlocks.get(url) || []
        matches.push(block)
        urlToBlocks.set(url, matches)
      }

      if (block._children?.length) {
        visit(block._children)
      }
    }
  }

  visit(blocks)
  if (!urlToBlocks.size) {
    return
  }

  const metadataByUrl = new Map<string, OgMetadata | null>()
  const urls = [...urlToBlocks.keys()]

  await mapWithConcurrency(urls, 4, async (url) => {
    const cached = await getCachedOgMetadata(env, url)
    if (cached) {
      metadataByUrl.set(url, cached.metadata)
      return
    }

    metadataByUrl.set(url, getKnownOgMetadata(url))
  })

  for (const [url, matchedBlocks] of urlToBlocks) {
    const metadata = metadataByUrl.get(url) ?? null
    for (const block of matchedBlocks) {
      if (block.type === 'bookmark') {
        block.bookmark._ogMetadata = metadata
      } else if (block.type === 'link_preview') {
        block.link_preview._ogMetadata = metadata
      }
    }
  }
}

export function collectBookmarkUrls(blocks: Block[]): string[] {
  const urls = new Set<string>()

  const visit = (items: Block[]) => {
    for (const block of items) {
      const url = getBookmarkUrl(block)
      if (url) {
        urls.add(url)
      }

      if (block._children?.length) {
        visit(block._children)
      }
    }
  }

  visit(blocks)
  return [...urls]
}

export async function warmBookmarkMetadata(env: Env, urls: Iterable<string>): Promise<void> {
  const uniqueUrls = [...new Set(urls)].filter((url) => typeof url === 'string' && url.length > 0)
  if (!uniqueUrls.length) {
    return
  }

  await mapWithConcurrency(uniqueUrls, 4, async (url) => {
    const cached = await getCachedOgMetadata(env, url)
    if (cached && isCachedOgFresh(cached, OG_METADATA_REVALIDATE_SECONDS)) {
      return
    }

    const metadata = await fetchOgMetadata(url)
    await setCachedOgMetadata(env, url, metadata).catch(() => undefined)
  })
}

function collectChildPageIds(blocks: Block[]): string[] {
  const pageIds = new Set<string>()

  const visit = (items: Block[]) => {
    for (const block of items) {
      if (block.type === 'child_page') {
        pageIds.add(block.id)
      }

      if (block._children?.length) {
        visit(block._children)
      }
    }
  }

  visit(blocks)
  return [...pageIds]
}

function collectMentionPageIds(blocks: Block[]): string[] {
  const pageIds = new Set<string>()

  const visit = (items: Block[]) => {
    for (const block of items) {
      for (const richTextItems of getRichTextArrays(block)) {
        for (const item of richTextItems) {
          if (item.type === 'mention' && item.mention?.type === 'page' && item.mention.page?.id) {
            pageIds.add(item.mention.page.id)
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

function collectLinkedHrefPageIds(blocks: Block[]): string[] {
  const pageIds = new Set<string>()

  const visit = (items: Block[]) => {
    for (const block of items) {
      for (const richTextItems of getRichTextArrays(block)) {
        for (const item of richTextItems) {
          if (!item.href) {
            continue
          }

          const pageId = extractPageId(item.href)
          if (pageId) {
            pageIds.add(pageId)
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

function getBookmarkUrl(block: Block): string | null {
  if (block.type === 'bookmark') {
    return typeof block.bookmark?.url === 'string' ? block.bookmark.url : null
  }

  if (block.type === 'link_preview') {
    return typeof block.link_preview?.url === 'string' ? block.link_preview.url : null
  }

  return null
}

export function getPageTitle(page: Page): string {
  const titleProp = Object.values(page.properties).find((p: any) => p.type === 'title') as any
  if (!titleProp?.title?.length) return 'Untitled'
  return titleProp.title.map((t: any) => t.plain_text).join('') || 'Untitled'
}

export function getPageIcon(page: Page): string | null {
  const icon = page.icon
  if (!icon) return null
  if (icon.type === 'emoji') return icon.emoji || null
  if (icon.type === 'external') return icon.external?.url || null
  if (icon.type === 'file') return icon.file?.url || null
  return null
}

export function getPageCover(page: Page): string | null {
  const cover = page.cover
  if (!cover) return null
  if (cover.type === 'external') return cover.external?.url || null
  if (cover.type === 'file') return cover.file?.url || null
  return null
}
