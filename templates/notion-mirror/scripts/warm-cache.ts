import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'
import { fromCachedDocumentUrl } from '../src/asset-url'
import { collectPageAssetMetadata } from '../src/document-assets'
import { fetchPageAncestors, fetchPageData, getPageTitle, type PageData } from '../src/notion-client'
import { renderPage } from '../src/template'
import { getConfig, type Env } from '../src/config'
import { extractPageId } from '../src/page-path'
import { pagePath } from '../src/page-path'
import { buildPageBreadcrumbs } from '../src/breadcrumbs'
import {
  localWarmCacheRoot,
  readCachedWarmedAssets,
  readCachedPageSnapshot,
  readCachedSitemapEntries,
  readCachedWarmedImages,
  readCachedWorkspacePageIds,
  writeCachedWarmedAssets,
  writeCachedPageSnapshot,
  writeCachedSitemapEntries,
  writeCachedWarmedImages,
  writeCachedWorkspacePageIds,
} from './local-cache'
import { normalizeSitemapEntries, sitemapEntryFromPage, type SitemapEntry } from '../src/sitemap'
import { readWranglerVars } from './site-data'

const env = buildEnv()
const config = getConfig(env)
const cliArgs = process.argv.slice(2)
const workspaceMode = cliArgs.includes('--workspace')
const refreshNotion = cliArgs.includes('--refresh-notion')
const refreshImages = cliArgs.includes('--refresh-images')
const optionArgs = new Set(['--workspace', '--refresh-notion', '--refresh-images'])
const pageInputs = cliArgs.filter((arg) => !optionArgs.has(arg))
const pageQueue = pageInputs.length ? pageInputs.map((value) => toPageId(value, env.ROOT_PAGE_ID)) : [env.ROOT_PAGE_ID]
const seenPages = new Set<string>()
const warmedImages = refreshImages ? new Set<string>() : await readCachedWarmedImages()
const warmedAssets = await readCachedWarmedAssets()
const sitemapEntries = new Map<string, SitemapEntry>((await readCachedSitemapEntries()).map((entry) => [entry.path, entry]))
const pageMetadataEntries = new Map<string, { pageId: string; path: string; title: string; lastModified?: string; cachedAt: number }>()
const skippedPages: Array<{ pageId: string; reason: string }> = []
const PAGE_DELAY_MS = Number(process.env.WARM_PAGE_DELAY_MS || '350')
const IMAGE_DELAY_MS = Number(process.env.WARM_IMAGE_DELAY_MS || '150')
const SEARCH_DELAY_MS = Number(process.env.WARM_SEARCH_DELAY_MS || '350')
const MAX_WORKSPACE_PAGES = Number(process.env.WARM_MAX_PAGES || '500')
const NOTION_ASSET_SNAPSHOT_MAX_AGE_MS = Number(process.env.WARM_SIGNED_URL_TTL_MS || `${55 * 60 * 1000}`)
const PAGE_CACHE_NAMESPACE_ID = resolvePageCacheNamespaceId()
const initialWarmedImagesCount = warmedImages.size
const initialWarmedAssetsCount = warmedAssets.size
let notionFetchCount = 0
let localSnapshotCount = 0
let reusedImageCount = 0
let reusedAssetCount = 0

console.log(`Using local warm cache at ${localWarmCacheRoot()}`)

if (workspaceMode) {
  const workspacePages = await loadWorkspacePageIds(env.NOTION_API_KEY, env.ROOT_PAGE_ID)
  console.log(`Seeded ${workspacePages.length} initial page(s); root crawl will expand through child pages and internal links.`)

  for (const pageId of workspacePages.slice(0, MAX_WORKSPACE_PAGES)) {
    if (!pageQueue.includes(pageId)) {
      pageQueue.push(pageId)
    }
  }
}

while (pageQueue.length) {
  const pageId = pageQueue.shift()
  if (!pageId || seenPages.has(pageId)) {
    continue
  }

  seenPages.add(pageId)
  console.log(`Rendering ${pageId}...`)

  let pageData
  let source: 'local-cache' | 'notion'
  try {
    const loadedPage = await loadPageData(env.NOTION_API_KEY, pageId)
    pageData = loadedPage.pageData
    source = loadedPage.source
  } catch (error: any) {
    const message = error?.message || String(error)
    console.warn(`  skip page: ${pageId} (${message})`)
    skippedPages.push({ pageId, reason: message })
    await sleep(PAGE_DELAY_MS)
    continue
  }

  if (source === 'local-cache') {
    localSnapshotCount += 1
  } else {
    notionFetchCount += 1
  }

  let title = getPageTitle(pageData.page)
  let ancestors = await fetchPageAncestors(env.NOTION_API_KEY, pageData.page, config.rootPageId)
  await syncRemoteAssetMetadata(pageData)
  let html = renderPage(pageData, config, buildPageBreadcrumbs(config, pageId, title, ancestors))
  await putRemoteKvValue(`page:${pageId}`, JSON.stringify({ html, cachedAt: Date.now() }))

  console.log(`  cached page: ${title} (${source === 'local-cache' ? 'local snapshot' : 'Notion API'})`)

  for (const imageUrl of extractImageUrls(html, config.domain)) {
    if (warmedImages.has(imageUrl)) {
      reusedImageCount += 1
      continue
    }

    console.log(`  warming image: ${imageUrl}`)
    try {
      const response = await fetch(imageUrl)
      console.log(`    -> ${response.status}`)

      if (!response.ok) {
        console.warn(`    image warm skipped, received ${response.status}`)
        continue
      }

      await response.arrayBuffer()
      warmedImages.add(imageUrl)
      await sleep(IMAGE_DELAY_MS)
    } catch (error: any) {
      console.warn(`    image warm failed: ${error?.message || error}`)
    }
  }

  let assetUrls = extractAssetUrls(html, config.domain)
  let shouldRefreshPageAssets = false

  for (const assetUrl of assetUrls) {
    const warmedAssetKey = warmedAssetCacheKey(assetUrl, config.domain)
    if (warmedAssets.has(warmedAssetKey)) {
      reusedAssetCount += 1
      continue
    }

    console.log(`  warming asset: ${assetUrl}`)
    try {
      const response = await fetch(assetUrl)
      console.log(`    -> ${response.status}`)

      if (!response.ok) {
        console.warn(`    asset warm skipped, received ${response.status}`)
        if (!shouldRefreshPageAssets && source === 'local-cache' && isRetriableNotionAssetMiss(assetUrl, config.domain, response.status)) {
          shouldRefreshPageAssets = true
        }
        continue
      }

      await response.arrayBuffer()
      warmedAssets.add(warmedAssetKey)
      await sleep(IMAGE_DELAY_MS)
    } catch (error: any) {
      console.warn(`    asset warm failed: ${error?.message || error}`)
    }
  }

  if (shouldRefreshPageAssets) {
    console.log('  stale asset link detected in local snapshot; refreshing page from Notion and retrying assets.')

    const refreshedPageData = await fetchPageData(env.NOTION_API_KEY, pageId)
    notionFetchCount += 1

    if (JSON.stringify(refreshedPageData) !== JSON.stringify(pageData)) {
      await writeCachedPageSnapshot(pageId, refreshedPageData)
    }

    pageData = refreshedPageData
    source = 'notion'
    title = getPageTitle(pageData.page)
    ancestors = await fetchPageAncestors(env.NOTION_API_KEY, pageData.page, config.rootPageId)
    await syncRemoteAssetMetadata(pageData)
    html = renderPage(pageData, config, buildPageBreadcrumbs(config, pageId, title, ancestors))
    await putRemoteKvValue(`page:${pageId}`, JSON.stringify({ html, cachedAt: Date.now() }))
    assetUrls = extractAssetUrls(html, config.domain)

    for (const assetUrl of assetUrls) {
      const warmedAssetKey = warmedAssetCacheKey(assetUrl, config.domain)
      if (warmedAssets.has(warmedAssetKey)) {
        reusedAssetCount += 1
        continue
      }

      console.log(`  warming refreshed asset: ${assetUrl}`)
      try {
        const response = await fetch(assetUrl)
        console.log(`    -> ${response.status}`)

        if (!response.ok) {
          console.warn(`    refreshed asset warm skipped, received ${response.status}`)
          continue
        }

        await response.arrayBuffer()
        warmedAssets.add(warmedAssetKey)
        await sleep(IMAGE_DELAY_MS)
      } catch (error: any) {
        console.warn(`    refreshed asset warm failed: ${error?.message || error}`)
      }
    }
  }

  const sitemapEntry = sitemapEntryFromPage(pageData.page.id, title, config.rootPageId, pageData.page.last_edited_time)
  sitemapEntries.set(sitemapEntry.path, sitemapEntry)
  pageMetadataEntries.set(pageData.page.id.replace(/-/g, '').toLowerCase(), {
    pageId: pageData.page.id,
    path: sitemapEntry.path,
    title,
    ...(pageData.page.last_edited_time ? { lastModified: pageData.page.last_edited_time } : {}),
    cachedAt: Date.now(),
  })

  for (const child of pageData.childPages) {
    if (!seenPages.has(child.id) && !pageQueue.includes(child.id)) {
      pageQueue.push(child.id)
    }
  }

  for (const linkedPageId of extractInternalPageIds(html, config.domain, env.ROOT_PAGE_ID)) {
    if (!seenPages.has(linkedPageId) && !pageQueue.includes(linkedPageId)) {
      pageQueue.push(linkedPageId)
    }
  }

  const liveUrl = new URL(pageId === env.ROOT_PAGE_ID ? '/' : pagePath(pageId, title), `https://${config.domain}`)
  await verifyLivePage(liveUrl, title)
  await sleep(PAGE_DELAY_MS)
}

await writeCachedWarmedImages(warmedImages)
await writeCachedWarmedAssets(warmedAssets)
const persistedSitemapEntries = normalizeSitemapEntries(sitemapEntries.values())
const sitemapEntriesToUpload = persistedSitemapEntries.length ? persistedSitemapEntries : staticFallbackSitemapEntries()
const persistedPageMetadata = [...pageMetadataEntries.values()].sort((left, right) => left.path.localeCompare(right.path))
await writeCachedSitemapEntries(persistedSitemapEntries)
await putRemoteKvValue('sitemap', JSON.stringify({ entries: sitemapEntriesToUpload, cachedAt: Date.now() }))
await Promise.all(
  persistedPageMetadata.map((entry) =>
    putRemoteKvValue(`page-meta:${normalizePageId(entry.pageId)}`, JSON.stringify(entry)),
  ),
)

console.log(
  `Warmed ${seenPages.size - skippedPages.length} page(s), uploaded ${warmedImages.size - initialWarmedImagesCount} new image(s), uploaded ${warmedAssets.size - initialWarmedAssetsCount} new asset(s), reused ${reusedImageCount} cached image hit(s), reused ${reusedAssetCount} cached asset hit(s), using ${localSnapshotCount} local snapshot(s) and ${notionFetchCount} Notion fetch(es).`,
)
console.log(`Persisted sitemap with ${sitemapEntriesToUpload.length} URL(s) and ${persistedPageMetadata.length} page metadata entr${persistedPageMetadata.length === 1 ? 'y' : 'ies'}.`)
if (skippedPages.length) {
  console.log(`Skipped ${skippedPages.length} page(s) not accessible to the integration:`)
  for (const skipped of skippedPages) {
    console.log(`  - ${skipped.pageId}: ${skipped.reason}`)
  }
}

function buildEnv(): Env {
  const notionApiKey = process.env.NOTION_API_KEY
  if (!notionApiKey) {
    throw new Error('NOTION_API_KEY must be set in the environment to warm the cache.')
  }

  const vars = readWranglerVars()

  return {
    NOTION_API_KEY: notionApiKey,
    PAGE_CACHE: null as unknown as KVNamespace,
    IMAGE_STORE: null as unknown as R2Bucket,
    ROOT_PAGE_ID: process.env.ROOT_PAGE_ID || vars.ROOT_PAGE_ID || '',
    SITE_DOMAIN: process.env.SITE_DOMAIN || vars.SITE_DOMAIN || '',
    SITE_NAME: process.env.SITE_NAME || vars.SITE_NAME || '',
    SITE_DESCRIPTION: process.env.SITE_DESCRIPTION || vars.SITE_DESCRIPTION || '',
    CACHE_TTL_SECONDS: process.env.CACHE_TTL_SECONDS || vars.CACHE_TTL_SECONDS || '86400',
    NOTION_WORKSPACE_SLUG: process.env.NOTION_WORKSPACE_SLUG || vars.NOTION_WORKSPACE_SLUG || '',
    GOOGLE_TAG_ID: process.env.GOOGLE_TAG_ID || vars.GOOGLE_TAG_ID,
    SHORT_LINKS_JSON: process.env.SHORT_LINKS_JSON || vars.SHORT_LINKS_JSON || '{}',
    SHORT_LINK_REDIRECT_STATUS: process.env.SHORT_LINK_REDIRECT_STATUS || vars.SHORT_LINK_REDIRECT_STATUS || '302',
    ENABLE_TOC: process.env.ENABLE_TOC || vars.ENABLE_TOC,
    HIDE_MOBILE_COVER_IMAGES: process.env.HIDE_MOBILE_COVER_IMAGES || vars.HIDE_MOBILE_COVER_IMAGES,
    ALWAYS_USE_SITE_LOGO_FAVICON: process.env.ALWAYS_USE_SITE_LOGO_FAVICON || vars.ALWAYS_USE_SITE_LOGO_FAVICON,
  }
}

function staticFallbackSitemapEntries(): SitemapEntry[] {
  return [{ path: '/' }]
}

function normalizePageId(pageId: string): string {
  return pageId.replace(/-/g, '').toLowerCase()
}

function toPageId(input: string, rootPageId: string): string {
  if (!input || input === '/') {
    return rootPageId
  }

  const compactId = extractPageId(input)
  if (!compactId) {
    throw new Error(`Could not extract a Notion page id from: ${input}`)
  }

  const hex = compactId
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function putRemoteKvValue(key: string, value: string): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), 'notion-mirror-cache-'))
  const payloadPath = join(tempDir, 'payload.json')

  try {
    await Bun.write(payloadPath, value)

    let delayMs = 1000
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const proc = Bun.spawn(
        ['bunx', 'wrangler', 'kv', 'key', 'put', key, '--namespace-id', PAGE_CACHE_NAMESPACE_ID, '--path', payloadPath, '--remote'],
        {
          cwd: process.cwd(),
          stdout: 'inherit',
          stderr: 'inherit',
        },
      )

      const exitCode = await proc.exited
      if (exitCode === 0) {
        return
      }

      if (attempt === 4) {
        throw new Error(`wrangler kv key put failed for ${key} with exit code ${exitCode}`)
      }

      await sleep(delayMs)
      delayMs *= 2
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function extractImageUrls(html: string, domain: string): string[] {
  const matches = html.matchAll(/<(?:img|source)[^>]+src="([^"]+)"/g)
  const urls = new Set<string>()

  for (const match of matches) {
    const src = match[1]
    if (!src) {
      continue
    }

    try {
      const url = new URL(src, `https://${domain}`)
      if (url.hostname === domain && url.pathname.startsWith('/_image/')) {
        urls.add(url.toString())
      }
    } catch {
      // Ignore invalid URLs.
    }
  }

  return [...urls]
}

function extractAssetUrls(html: string, domain: string): string[] {
  const matches = html.matchAll(/(?:href|src)="([^"]+)"/g)
  const urls = new Set<string>()

  for (const match of matches) {
    const raw = match[1]
    if (!raw) {
      continue
    }

    try {
      const url = new URL(raw, `https://${domain}`)
      if (url.hostname === domain && url.pathname.startsWith('/_asset/')) {
        urls.add(url.toString())
      }
    } catch {
      // Ignore invalid URLs.
    }
  }

  return [...urls]
}

function warmedAssetCacheKey(assetUrl: string, domain: string): string {
  const assetId = fromCachedDocumentUrl(assetUrl, domain)
  if (assetId) {
    return assetId
  }

  return assetUrl
}

function extractInternalPageIds(html: string, domain: string, rootPageId: string): string[] {
  const matches = html.matchAll(/href="([^"]+)"/g)
  const pageIds = new Set<string>()

  for (const match of matches) {
    const href = match[1]
    if (!href || href.startsWith('/_image/') || href.startsWith('/_asset/') || href.startsWith('#')) {
      continue
    }

    try {
      const url = new URL(href, `https://${domain}`)
      if (url.hostname !== domain) {
        continue
      }

      if (url.pathname === '/') {
        pageIds.add(rootPageId)
        continue
      }

      const compactId = extractPageId(url.pathname)
      if (!compactId) {
        continue
      }

      pageIds.add(toHyphenatedId(compactId))
    } catch {
      // Ignore invalid URLs.
    }
  }

  return [...pageIds]
}

function toHyphenatedId(compactId: string): string {
  return `${compactId.slice(0, 8)}-${compactId.slice(8, 12)}-${compactId.slice(12, 16)}-${compactId.slice(16, 20)}-${compactId.slice(20)}`
}

async function loadPageData(apiKey: string, pageId: string): Promise<{ pageData: PageData; source: 'local-cache' | 'notion' }> {
  if (!refreshNotion) {
    const snapshot = await readCachedPageSnapshot(pageId)
    if (snapshot) {
      if (!snapshotHasStaleNotionHostedAssets(snapshot)) {
        return { pageData: snapshot.pageData, source: 'local-cache' }
      }

      console.log('  local snapshot contains stale Notion-hosted assets; refreshing from Notion.')
    }
  }

  const pageData = await fetchPageData(apiKey, pageId)
  await writeCachedPageSnapshot(pageId, pageData)
  return { pageData, source: 'notion' }
}

function snapshotHasStaleNotionHostedAssets(snapshot: { pageData: PageData; fetchedAt: number }): boolean {
  if ((Date.now() - snapshot.fetchedAt) < NOTION_ASSET_SNAPSHOT_MAX_AGE_MS) {
    return false
  }

  return containsNotionHostedAssets(snapshot.pageData)
}

function isRetriableNotionAssetMiss(assetUrl: string, domain: string, status: number): boolean {
  if (status !== 403 && status !== 404) {
    return false
  }

  const decoded = fromCachedDocumentUrl(assetUrl, domain)
  if (!decoded) {
    return false
  }

  if (!/^https?:\/\//i.test(decoded)) {
    return true
  }

  return isNotionHostedAssetUrl(decoded)
}

function isNotionHostedAssetUrl(sourceUrl: string): boolean {
  try {
    const url = new URL(sourceUrl)
    return (
      url.hostname === 'prod-files-secure.s3.us-west-2.amazonaws.com'
      || url.hostname === 'secure.notion-static.com'
      || url.hostname === 'file.notion.so'
    )
  } catch {
    return false
  }
}

function containsNotionHostedAssets(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }

  if (Array.isArray(value)) {
    return value.some(containsNotionHostedAssets)
  }

  const record = value as Record<string, unknown>
  if (record.type === 'file' && typeof (record.file as { url?: unknown } | undefined)?.url === 'string') {
    return true
  }

  return Object.values(record).some(containsNotionHostedAssets)
}

async function loadWorkspacePageIds(apiKey: string, rootPageId: string): Promise<string[]> {
  if (!refreshNotion) {
    const cached = await readCachedWorkspacePageIds(rootPageId)
    if (cached) {
      console.log(`Loaded ${cached.pageIds.length} workspace seed page(s) from local cache.`)
      return cached.pageIds
    }
  }

  const pageIds = await fetchWorkspacePublicPageIds(apiKey, rootPageId)
  await writeCachedWorkspacePageIds(rootPageId, pageIds)
  console.log(`Cached ${pageIds.length} workspace seed page(s) locally.`)
  return pageIds
}

async function verifyLivePage(liveUrl: URL, title: string): Promise<void> {
  let lastStatus = 0

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetch(liveUrl)
    const html = await response.text()
    lastStatus = response.status
    console.log(`  verify live attempt ${attempt}: ${response.status} ${liveUrl.toString()}`)

    if (response.ok && html.includes(title)) {
      return
    }

    await sleep(1500 * attempt)
  }

  throw new Error(`Live verification failed for ${liveUrl} after retries, last status ${lastStatus}`)
}

async function fetchWorkspacePublicPageIds(apiKey: string, rootPageId: string): Promise<string[]> {
  const pageIds = new Set<string>([rootPageId])
  let cursor: string | undefined

  do {
    const payload: Record<string, unknown> = {
      filter: {
        value: 'page',
        property: 'object',
      },
      page_size: 100,
    }

    if (cursor) {
      payload.start_cursor = cursor
    }

    const response = await notionApiRequest(apiKey, '/search', payload)
    for (const page of response.results as Array<{ id: string; public_url?: string | null; in_trash?: boolean; archived?: boolean; is_archived?: boolean }>) {
      if (page.in_trash || page.archived || page.is_archived) {
        continue
      }

      if (page.public_url || page.id === rootPageId) {
        pageIds.add(page.id)
      }
    }

    cursor = response.has_more ? response.next_cursor : undefined
    if (cursor) {
      await sleep(SEARCH_DELAY_MS)
    }
  } while (cursor && pageIds.size < MAX_WORKSPACE_PAGES)

  return [...pageIds]
}

async function notionApiRequest(apiKey: string, path: string, body: Record<string, unknown>): Promise<any> {
  let delayMs = 1000

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const response = await fetch(`https://api.notion.com/v1${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (response.ok) {
      return response.json()
    }

    const retryAfter = Number(response.headers.get('retry-after') || '0')
    const shouldRetry = response.status === 429 || response.status >= 500
    const errorText = await response.text()
    if (!shouldRetry || attempt === 6) {
      throw new Error(`Notion API request failed (${response.status}): ${errorText}`)
    }

    await sleep(retryAfter > 0 ? retryAfter * 1000 : delayMs)
    delayMs *= 2
  }
}

async function sleep(ms: number): Promise<void> {
  if (ms > 0) {
    await Bun.sleep(ms)
  }
}

async function syncRemoteAssetMetadata(pageData: PageData): Promise<void> {
  const assets = collectPageAssetMetadata(pageData)
  await Promise.all(
    assets.map((asset) => putRemoteKvValue(`asset:${asset.id}`, JSON.stringify(asset))),
  )
}

function resolvePageCacheNamespaceId(): string {
  if (process.env.PAGE_CACHE_NAMESPACE_ID) {
    return process.env.PAGE_CACHE_NAMESPACE_ID
  }

  const wranglerToml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')
  const match = wranglerToml.match(/binding = "PAGE_CACHE"\s+id = "([^"]+)"/m)
  if (!match) {
    throw new Error('Could not resolve PAGE_CACHE namespace id from wrangler.toml')
  }

  return match[1]
}
