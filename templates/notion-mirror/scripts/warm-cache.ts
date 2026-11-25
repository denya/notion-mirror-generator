import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { createHash } from 'node:crypto'
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
// --no-crawl renders only the given pages: no child or linked pages are queued.
const noCrawl = cliArgs.includes('--no-crawl')
const optionArgs = new Set(['--workspace', '--refresh-notion', '--refresh-images', '--no-crawl'])
const pageInputs = cliArgs.filter((arg) => !optionArgs.has(arg))
const pageQueue = pageInputs.length ? pageInputs.map((value) => toPageId(value, env.ROOT_PAGE_ID)) : [env.ROOT_PAGE_ID]
const seenPages = new Set<string>()
const warmedImages = refreshImages ? new Set<string>() : await readCachedWarmedImages()
const warmedAssets = await readCachedWarmedAssets()
const cachedSitemapEntries = await readCachedSitemapEntries()
// A full warm from the root page re-crawls the whole tree, so its uploaded
// sitemap is authoritative and must not inherit stale entries (e.g. pages that
// left the tree or were unpublished) from the previous run's cache. It must
// refetch Notion: a renderer-only warm can contain local snapshots of deleted
// pages and therefore must preserve the last authoritative index membership.
const authoritativeIndexRun = refreshNotion && !workspaceMode && pageInputs.length === 0
const cachedIndexedPageIds = new Set(
  cachedSitemapEntries.flatMap((entry) => {
    if (entry.path === '/') {
      return [normalizePageId(env.ROOT_PAGE_ID)]
    }

    const pageId = extractPageId(entry.path)
    return pageId ? [normalizePageId(pageId)] : []
  }),
)
const sitemapEntries = new Map<string, SitemapEntry>(
  authoritativeIndexRun ? [] : cachedSitemapEntries.map((entry) => [entry.path, entry]),
)
const pageMetadataEntries = new Map<string, { pageId: string; path: string; title: string; lastModified?: string; cachedAt: number }>()
const skippedPages: Array<{ pageId: string; reason: string }> = []
const renderedPages: Record<string, { lastEdited: string | null; title: string }> = {}
const discoveredPageIds = new Set<string>()
const kvWriteBudget = Number(process.env.WARM_MAX_KV_WRITES || '0')
const PAGE_DELAY_MS = Number(process.env.WARM_PAGE_DELAY_MS || '350')
const IMAGE_DELAY_MS = Number(process.env.WARM_IMAGE_DELAY_MS || '150')
const SEARCH_DELAY_MS = Number(process.env.WARM_SEARCH_DELAY_MS || '350')
const MAX_WORKSPACE_PAGES = Number(process.env.WARM_MAX_PAGES || '500')
const NOTION_ASSET_SNAPSHOT_MAX_AGE_MS = Number(process.env.WARM_SIGNED_URL_TTL_MS || `${55 * 60 * 1000}`)
const PAGE_CACHE_NAMESPACE_ID = resolvePageCacheNamespaceId()
// With an API token the script writes KV through the Cloudflare REST API (the
// server daemon); without one it uses wrangler's own login (a Mac run).
// SYNC_WRITE_URL + SYNC_WRITE_SECRET: the same calls go to the site's own Worker
// (src/sync-write.ts), which writes through its KV binding — no Cloudflare token.
const SYNC_WRITE_URL = (process.env.SYNC_WRITE_URL || '').replace(/\/$/, '')
const SYNC_WRITE_SECRET = process.env.SYNC_WRITE_SECRET || ''
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || ''
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || ''
const useWorkerWrite = Boolean(SYNC_WRITE_URL && SYNC_WRITE_SECRET)
const useKvRestApi = useWorkerWrite || Boolean(CF_API_TOKEN && CF_ACCOUNT_ID)
// KV Free allows 1,000 writes a day: a value whose content is unchanged since
// our last write is not written again. WARM_FORCE_KV_WRITE=1 writes everything.
const forceKvWrite = process.env.WARM_FORCE_KV_WRITE === '1'
const kvHashesPath = join(localWarmCacheRoot(), 'kv-hashes.json')
const kvHashes: Record<string, string> = existsSync(kvHashesPath) ? JSON.parse(readFileSync(kvHashesPath, 'utf8')) : {}
let kvWriteCount = 0
let kvSkipCount = 0
// Writes per UTC day across all runs (KV Free: 1,000/day), persisted on every
// write so a run that dies half-way is still counted.
const kvDailyPath = join(localWarmCacheRoot(), 'kv-writes-daily.json')
const kvDailyBudget = Number(process.env.KV_DAILY_BUDGET || '0')
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

  const normalizedPageId = normalizePageId(pageData.page.id)
  const shouldUpdatePageIndex = refreshNotion || cachedIndexedPageIds.has(normalizedPageId)
  if (shouldUpdatePageIndex) {
    const sitemapEntry = sitemapEntryFromPage(pageData.page.id, title, config.rootPageId, pageData.page.last_edited_time)
    sitemapEntries.set(sitemapEntry.path, sitemapEntry)
    pageMetadataEntries.set(normalizedPageId, {
      pageId: pageData.page.id,
      path: sitemapEntry.path,
      title,
      ...(pageData.page.last_edited_time ? { lastModified: pageData.page.last_edited_time } : {}),
      cachedAt: Date.now(),
    })
  } else {
    console.log(`  preserved out-of-index page metadata state: ${pageData.page.id}`)
  }

  renderedPages[normalizedPageId] = { lastEdited: pageData.page.last_edited_time || null, title }
  for (const referencedId of [...pageData.childPages.map((child) => child.id), ...extractInternalPageIds(html, config.domain, env.ROOT_PAGE_ID)]) {
    discoveredPageIds.add(normalizePageId(referencedId))
  }

  if (!noCrawl) {
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
  }

  const liveUrl = new URL(pageId === env.ROOT_PAGE_ID ? '/' : pagePath(pageId, title), `https://${config.domain}`)
  await verifyLivePage(liveUrl, title)
  await sleep(PAGE_DELAY_MS)
}

await writeCachedWarmedImages(warmedImages)
await writeCachedWarmedAssets(warmedAssets)
// A page the integration cannot see (400/403/404) is a normal skip in a crawl;
// any other failure (throttling, outage, render error) leaves stale content and
// must surface as a failed run. An explicitly requested page must never be skipped.
const failedSkips = skippedPages.filter((skipped) => !isInaccessiblePageError(skipped.reason, skipped.pageId) || (noCrawl && pageInputs.length > 0))
// An authoritative crawl that lost pages to failures is incomplete: publishing
// its sitemap or pruning by it would drop live pages from the index.
// A crawl that suddenly finds far fewer pages than the last index is treated as
// incomplete too (WARM_MIN_INDEX_RATIO, default 0.8): a real mass removal needs a
// forced run (WARM_ALLOW_INDEX_SHRINK=1).
const previousIndexSize = cachedIndexedPageIds.size
const crawledIndexSize = [...pageMetadataEntries.keys()].length
const shrinkRatio = Number(process.env.WARM_MIN_INDEX_RATIO || '0.8')
const lostPages = previousIndexSize - crawledIndexSize
const suspiciousShrink = authoritativeIndexRun && lostPages > Math.max(3, previousIndexSize * (1 - shrinkRatio))
  && process.env.WARM_ALLOW_INDEX_SHRINK !== '1'
if (suspiciousShrink) {
  failedSkips.push({ pageId: '(index)', reason: `crawl found ${crawledIndexSize} page(s), previous index had ${previousIndexSize}` })
}
const publishIndex = !(authoritativeIndexRun && failedSkips.length)
if (!publishIndex) {
  console.warn(`Index not published: ${failedSkips.length} problem(s) in an authoritative crawl; the previous sitemap and page metadata stay.`)
}
const persistedSitemapEntries = normalizeSitemapEntries(sitemapEntries.values())
const sitemapEntriesToUpload = persistedSitemapEntries.length ? persistedSitemapEntries : staticFallbackSitemapEntries()
const persistedPageMetadata = [...pageMetadataEntries.values()].sort((left, right) => left.path.localeCompare(right.path))
if (publishIndex) {
  await writeCachedSitemapEntries(persistedSitemapEntries)
  await putRemoteKvValue('sitemap', JSON.stringify({ entries: sitemapEntriesToUpload, cachedAt: Date.now() }))
}
await Promise.all(
  persistedPageMetadata.map((entry) =>
    putRemoteKvValue(`page-meta:${normalizePageId(entry.pageId)}`, JSON.stringify(entry)),
  ),
)
const prunedPageMetadataCount = authoritativeIndexRun && publishIndex
  ? await pruneRemotePageMetadata(new Set(persistedPageMetadata.map((entry) => normalizePageId(entry.pageId))))
  : 0

console.log(
  `Warmed ${seenPages.size - skippedPages.length} page(s), uploaded ${warmedImages.size - initialWarmedImagesCount} new image(s), uploaded ${warmedAssets.size - initialWarmedAssetsCount} new asset(s), reused ${reusedImageCount} cached image hit(s), reused ${reusedAssetCount} cached asset hit(s), using ${localSnapshotCount} local snapshot(s) and ${notionFetchCount} Notion fetch(es).`,
)
console.log(`Persisted sitemap with ${sitemapEntriesToUpload.length} URL(s) and ${persistedPageMetadata.length} page metadata entr${persistedPageMetadata.length === 1 ? 'y' : 'ies'}.`)
if (prunedPageMetadataCount) {
  console.log(`Pruned ${prunedPageMetadataCount} stale page metadata entr${prunedPageMetadataCount === 1 ? 'y' : 'ies'} from the live TOC.`)
}
if (skippedPages.length) {
  console.log(`Skipped ${skippedPages.length} page(s):`)
  for (const skipped of skippedPages) {
    console.log(`  - ${skipped.pageId}: ${skipped.reason}`)
  }
}

persistKvHashes()
const unknownDiscovered = [...discoveredPageIds].filter((id) => !seenPages.has(id) && ![...seenPages].some((seen) => normalizePageId(seen) === id))
console.log(`WARM_SUMMARY ${JSON.stringify({
  pages: seenPages.size - skippedPages.length,
  skipped: skippedPages.length,
  failed: failedSkips.length,
  indexPublished: publishIndex,
  authoritative: authoritativeIndexRun,
  kvWrites: kvWriteCount,
  kvSkipped: kvSkipCount,
  notionFetches: notionFetchCount,
  rendered: renderedPages,
  referenced: unknownDiscovered,
  indexPageIds: persistedPageMetadata.map((entry) => normalizePageId(entry.pageId)),
})}`)
if (failedSkips.length) {
  process.exitCode = 2
}

function isInaccessiblePageError(reason: string, pageId: string): boolean {
  // Only the page itself being unreadable is a normal crawl skip; a 403/404 on a
  // nested block (an unshared synced block) means the page failed to render.
  const match = reason.match(/Notion API error (?:400|403|404) \(\/pages\/([0-9a-f-]+)\)/i)
  return Boolean(match && normalizePageId(match[1]) === normalizePageId(pageId))
}

function kvContentHash(value: string): string {
  // Not content: cachedAt changes on every run, and Notion re-signs file URLs on
  // every fetch. Images and files are stored in R2 under their path without the
  // query (src/cache.ts imageKey), so an older signature in KV still resolves.
  // Only signature parameters are dropped; anything that selects content
  // (versionId, the path) stays in the hash.
  const normalized = value
    .replace(/"(cachedAt|updatedAt|signedUrlExpiresAt)":(\d+|null)/g, '"$1":0')
    .replace(/(?:amazonaws\.com|file\.notion\.so)[^"'\s<>]*/gi, (url) =>
      url.replace(/(\?|&|%3F|%26)(X-Amz-[A-Za-z-]+|x-id|expirationTimestamp|signature)(=|%3D)(?:(?!%26)[^&"'\s<>])*/gi, '$1$2='))
  return createHash('sha256').update(normalized).digest('hex')
}

function readKvDaily(): { date: string; count: number } {
  const today = new Date().toISOString().slice(0, 10)
  try {
    const parsed = JSON.parse(readFileSync(kvDailyPath, 'utf8'))
    if (parsed.date === today) return parsed
  } catch {}
  return { date: today, count: 0 }
}

function writeKvDaily(daily: { date: string; count: number }): void {
  mkdirSync(localWarmCacheRoot(), { recursive: true })
  writeFileSync(`${kvDailyPath}.tmp`, JSON.stringify(daily))
  renameSync(`${kvDailyPath}.tmp`, kvDailyPath)
}

function persistKvHashes(): void {
  mkdirSync(localWarmCacheRoot(), { recursive: true })
  const tempPath = `${kvHashesPath}.tmp`
  writeFileSync(tempPath, JSON.stringify(kvHashes))
  renameSync(tempPath, kvHashesPath)
}

async function cloudflareKvRequest(method: string, path: string, body?: string): Promise<Response> {
  const url = useWorkerWrite
    ? `${SYNC_WRITE_URL}/_sync/kv${path}`
    : `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${PAGE_CACHE_NAMESPACE_ID}${path}`
  let delayMs = 1000
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${useWorkerWrite ? SYNC_WRITE_SECRET : CF_API_TOKEN}`,
        ...(body !== undefined ? { 'Content-Type': 'text/plain' } : {}),
      },
      ...(body !== undefined ? { body } : {}),
      redirect: 'manual',
    })
    if (response.ok) {
      // Only an explicit acknowledgement counts: a login page or proxy answering
      // 200 must not be taken for a write (its hash would then skip the value).
      const payload = await response.clone().json().catch(() => null) as { success?: boolean } | null
      if (payload?.success === true) {
        return response
      }
      throw new Error(`Cloudflare KV ${method} ${path}: no success acknowledgement (status ${response.status})`)
    }
    const retryable = response.status === 429 || response.status >= 500
    if (!retryable || attempt >= 5) {
      throw new Error(`Cloudflare KV ${method} ${path} failed: ${response.status} ${(await response.text()).slice(0, 300)}`)
    }
    await sleep(delayMs)
    delayMs *= 2
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
    LEGACY_SITE_DOMAIN: process.env.LEGACY_SITE_DOMAIN || vars.LEGACY_SITE_DOMAIN,
    SITE_NAME: process.env.SITE_NAME || vars.SITE_NAME || '',
    SITE_DESCRIPTION: process.env.SITE_DESCRIPTION || vars.SITE_DESCRIPTION || '',
    CACHE_TTL_SECONDS: process.env.CACHE_TTL_SECONDS || vars.CACHE_TTL_SECONDS || '86400',
    LIVE_REFRESH: process.env.LIVE_REFRESH || vars.LIVE_REFRESH,
    NOTION_WORKSPACE_SLUG: process.env.NOTION_WORKSPACE_SLUG || vars.NOTION_WORKSPACE_SLUG || '',
    GOOGLE_TAG_ID: process.env.GOOGLE_TAG_ID || vars.GOOGLE_TAG_ID,
    // Without it the consent banner is not rendered and gtag loads unconsented (EEA visitors).
    GOOGLE_ANALYTICS_CONSENT_MODE: process.env.GOOGLE_ANALYTICS_CONSENT_MODE || vars.GOOGLE_ANALYTICS_CONSENT_MODE,
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

  // The Worker keys the root page by ROOT_PAGE_ID exactly as configured; any
  // other spelling of the root id would write a key the site never reads.
  if (compactId.toLowerCase() === rootPageId.replace(/-/g, '').toLowerCase()) {
    return rootPageId
  }

  const hex = compactId
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function putRemoteKvValue(key: string, value: string): Promise<void> {
  const hash = kvContentHash(value)
  if (!forceKvWrite && kvHashes[key] === hash) {
    kvSkipCount += 1
    return
  }

  if (kvWriteBudget > 0 && kvWriteCount >= kvWriteBudget) {
    throw new Error(`KV write budget of ${kvWriteBudget} exhausted (WARM_MAX_KV_WRITES); stopping before ${key}`)
  }
  const daily = readKvDaily()
  if (kvDailyBudget > 0 && daily.count >= kvDailyBudget) {
    throw new Error(`KV daily budget of ${kvDailyBudget} for ${daily.date} exhausted; stopping before ${key}`)
  }
  daily.count += 1
  writeKvDaily(daily)
  kvWriteCount += 1
  if (useKvRestApi) {
    await cloudflareKvRequest('PUT', `/values/${encodeURIComponent(key)}`, value)
  } else {
    await putRemoteKvValueWithWrangler(key, value)
  }
  kvHashes[key] = hash
  persistKvHashes()
}

async function putRemoteKvValueWithWrangler(key: string, value: string): Promise<void> {
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

async function pruneRemotePageMetadata(keepPageIds: Set<string>): Promise<number> {
  if (!useKvRestApi) {
    return pruneRemotePageMetadataWithWrangler(keepPageIds)
  }

  const keys: string[] = []
  let cursor = ''
  do {
    const query = new URLSearchParams({ prefix: 'page-meta:', limit: '1000', ...(cursor ? { cursor } : {}) })
    const payload = await (await cloudflareKvRequest('GET', `/keys?${query}`)).json() as any
    keys.push(...(payload.result || []).map((entry: { name: string }) => entry.name))
    cursor = payload.result_info?.cursor || ''
  } while (cursor)

  const staleKeys = keys.filter((key) => !keepPageIds.has(key.slice('page-meta:'.length)))
  for (const key of staleKeys) {
    // A page that left the tree also loses its cached HTML: the Worker never
    // expires KV, so the old copy would otherwise stay public indefinitely.
    const compactId = key.slice('page-meta:'.length)
    const htmlKey = `page:${toPageId(compactId, env.ROOT_PAGE_ID)}`
    await cloudflareKvRequest('DELETE', `/values/${encodeURIComponent(htmlKey)}`)
    delete kvHashes[htmlKey]
    await cloudflareKvRequest('DELETE', `/values/${encodeURIComponent(key)}`)
    delete kvHashes[key]
    persistKvHashes()
  }
  return staleKeys.length
}

async function pruneRemotePageMetadataWithWrangler(keepPageIds: Set<string>): Promise<number> {
  const proc = Bun.spawn(
    [
      'bunx',
      'wrangler',
      'kv',
      'key',
      'list',
      '--namespace-id',
      PAGE_CACHE_NAMESPACE_ID,
      '--prefix',
      'page-meta:',
      '--remote',
    ],
    {
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'inherit',
    },
  )
  const output = await new Response(proc.stdout).text()
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`wrangler kv key list failed with exit code ${exitCode}`)
  }

  const keys = JSON.parse(output) as Array<{ name?: string }>
  const staleKeys = keys
    .map((entry) => entry.name || '')
    .filter((key) => key.startsWith('page-meta:'))
    .filter((key) => !keepPageIds.has(key.slice('page-meta:'.length)))

  for (const key of staleKeys) {
    const deleteProc = Bun.spawn(
      [
        'bunx',
        'wrangler',
        'kv',
        'key',
        'delete',
        key,
        '--namespace-id',
        PAGE_CACHE_NAMESPACE_ID,
        '--remote',
      ],
      {
        cwd: process.cwd(),
        stdout: 'inherit',
        stderr: 'inherit',
      },
    )
    const deleteExitCode = await deleteProc.exited
    if (deleteExitCode !== 0) {
      throw new Error(`wrangler kv key delete failed for ${key} with exit code ${deleteExitCode}`)
    }
    delete kvHashes[key]
  }

  return staleKeys.length
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
