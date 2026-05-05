import { createHash } from 'node:crypto'
import { mkdir, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { collectPageAssetMetadata, type AssetMetadata } from '../src/document-assets'
import { getConfig, type Env } from '../src/config'
import { fetchPageData, getPageTitle, type Block, type PageData, type Page } from '../src/notion-client'
import { extractPageId, pagePath, rewriteNotionPageUrl } from '../src/page-path'
import { normalizeSitemapEntries, renderSitemapXml, sitemapEntryFromPage } from '../src/sitemap'
import { renderPage, type Breadcrumb } from '../src/template'
import {
  localAssetsManifestPath,
  localImagesManifestPath,
  pageBackupPath,
  readJsonFile,
  readWranglerVars,
  resolveSiteKey,
  siteManifestPath,
  staticBinaryFilePath,
  staticHtmlFilePath,
  staticSiteFilePath,
  type LocalBinaryAssetEntry,
  type LocalRouteEntry,
  type LocalSiteManifest,
  writeJsonFile,
  writeTextFile,
} from './site-data'

interface BackedUpPageSnapshot {
  pageData: PageData
  pageId: string
  fetchedAt: number
}

const cliArgs = process.argv.slice(2)
const workspaceMode = cliArgs.includes('--workspace')
const refreshNotion = cliArgs.includes('--refresh-notion')
const optionArgs = new Set(['--workspace', '--refresh-notion'])
const pageInputs = cliArgs.filter((arg) => !optionArgs.has(arg))
const siteKey = resolveSiteKey()
const env = buildEnv()
const config = getConfig(env)
const pageQueue = pageInputs.length ? pageInputs.map((value) => toPageId(value, env.ROOT_PAGE_ID)) : [env.ROOT_PAGE_ID]
const pageDataById = new Map<string, PageData>()
const routeEntries: LocalRouteEntry[] = []
const imageEntries = new Map<string, LocalBinaryAssetEntry>(
  ((await readJsonFile<LocalBinaryAssetEntry[]>(localImagesManifestPath(siteKey))) || []).map((entry) => [entry.key, entry]),
)
const assetEntries = new Map<string, LocalBinaryAssetEntry>(
  ((await readJsonFile<LocalBinaryAssetEntry[]>(localAssetsManifestPath(siteKey))) || []).map((entry) => [entry.key, entry]),
)
const visitedPageIds = new Set<string>()
const sourceMode = workspaceMode ? 'workspace' : 'root-crawl'
let fetchedFromNotion = 0
let reusedLocalSnapshots = 0

console.log(`Backing up site "${siteKey}" into data/sites/${siteKey}`)

if (workspaceMode) {
  const accessiblePageIds = await fetchWorkspaceAccessiblePageIds(env.NOTION_API_KEY)
  console.log(`Discovered ${accessiblePageIds.length} accessible page(s) via Notion search.`)

  for (const pageId of accessiblePageIds) {
    if (!pageQueue.includes(pageId)) {
      pageQueue.push(pageId)
    }
  }
}

while (pageQueue.length) {
  const pageId = pageQueue.shift()
  if (!pageId || visitedPageIds.has(pageId)) {
    continue
  }

  visitedPageIds.add(pageId)

  const { pageData, source } = await loadPageData(pageId)
  pageDataById.set(pageId, pageData)

  if (source === 'notion') {
    fetchedFromNotion += 1
  } else {
    reusedLocalSnapshots += 1
  }

  console.log(`Fetched ${pageId} (${source})`)

  if (!workspaceMode) {
    for (const reachablePageId of extractReachablePageIds(pageData.blocks, config.notionWorkspaceSlug)) {
      if (!visitedPageIds.has(reachablePageId) && !pageQueue.includes(reachablePageId)) {
        pageQueue.push(reachablePageId)
      }
    }
  }
}

const blockToPage = buildBlockToPageLookup(pageDataById)
const parentMap = new Map<string, string | null>()
for (const [pageId, pageData] of pageDataById.entries()) {
  parentMap.set(pageId, resolveParentPageId(pageData.page, blockToPage))
}

for (const [pageId, pageData] of pageDataById.entries()) {
  const title = getPageTitle(pageData.page)
  const breadcrumbs = buildLocalBreadcrumbs(pageData.page, pageDataById, config.rootPageId)
  const html = renderPage(pageData, config, breadcrumbs)
  const assetPathMap = await ensureLocalAssets(collectPageAssetMetadata(pageData))
  const imagePathMap = await ensureLocalImages(extractImageSources(html))
  const localHtml = rewriteHtmlForLocal(html, imagePathMap, assetPathMap)
  const routePath = normalizeRoutePath(pageData.page.id, title, config.rootPageId)
  const parentPageId = parentMap.get(pageId) ?? null
  const depth = computeDepth(pageId, parentMap, config.rootPageId)

  await writeJsonFile(pageBackupPath(siteKey, pageId), {
    pageData,
    pageId,
    fetchedAt: Date.now(),
  } satisfies BackedUpPageSnapshot)
  await writeTextFile(staticHtmlFilePath(siteKey, routePath), localHtml)

  routeEntries.push({
    pageId,
    title,
    path: routePath,
    htmlPath: routePath === '/' ? '/index.html' : `/${routePath.replace(/^\/+/, '')}/index.html`,
    ...(pageData.page.last_edited_time ? { lastEditedTime: pageData.page.last_edited_time } : {}),
    parentPageId,
    depth,
  })
}

const normalizedRoutes = normalizeRoutes(routeEntries)
const sitemapEntries = normalizeSitemapEntries(
  normalizedRoutes.map((route) =>
    sitemapEntryFromPage(route.pageId, route.title, config.rootPageId, route.lastEditedTime),
  ),
)

await writeJsonFile(siteManifestPath(siteKey), {
  siteKey,
  domain: config.domain,
  rootPageId: config.rootPageId,
  sourceMode,
  generatedAt: Date.now(),
  routes: normalizedRoutes,
} satisfies LocalSiteManifest)
await writeJsonFile(localImagesManifestPath(siteKey), [...imageEntries.values()].sort(sortAssetEntries))
await writeJsonFile(localAssetsManifestPath(siteKey), [...assetEntries.values()].sort(sortAssetEntries))
await writeTextFile(staticSiteFilePath(siteKey, 'sitemap.xml'), renderSitemapXml(config.domain, sitemapEntries))

console.log('')
console.log(`Backed up ${normalizedRoutes.length} page(s).`)
console.log(`Used ${fetchedFromNotion} Notion fetch(es) and ${reusedLocalSnapshots} local snapshot(s).`)
console.log(`Stored local site at data/sites/${siteKey}/site`)
console.log(`Stored JSON backups at data/sites/${siteKey}/backup`)
console.log('')
console.log('Launch locally with:')
console.log('  bun run serve:local')

function buildEnv(): Env {
  const notionApiKey = process.env.NOTION_API_KEY
  if (!notionApiKey) {
    throw new Error('NOTION_API_KEY must be set in the environment before creating a backup.')
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
  }
}

async function loadPageData(pageId: string): Promise<{ pageData: PageData; source: 'local-backup' | 'notion' }> {
  if (!refreshNotion) {
    const existing = await readJsonFile<BackedUpPageSnapshot>(pageBackupPath(siteKey, pageId))
    if (existing?.pageData) {
      return { pageData: existing.pageData, source: 'local-backup' }
    }
  }

  return {
    pageData: await fetchPageData(env.NOTION_API_KEY, pageId),
    source: 'notion',
  }
}

function buildLocalBreadcrumbs(
  page: Page,
  pageDataMap: Map<string, PageData>,
  rootPageId: string,
): Breadcrumb[] {
  const breadcrumbs: Breadcrumb[] = [{ label: 'Home', href: '/' }]
  const rootCompact = rootPageId.replace(/-/g, '')
  const ancestors: Array<{ id: string; title: string }> = []
  let currentParentId = page.parent?.type === 'page_id' ? page.parent.page_id || null : null
  const seenParents = new Set<string>()

  while (currentParentId) {
    const compactParentId = currentParentId.replace(/-/g, '')
    if (compactParentId === rootCompact || seenParents.has(compactParentId)) {
      break
    }

    seenParents.add(compactParentId)
    const parentPage = pageDataMap.get(currentParentId)?.page
    if (!parentPage) {
      break
    }

    ancestors.unshift({
      id: parentPage.id,
      title: getPageTitle(parentPage),
    })

    currentParentId = parentPage.parent?.type === 'page_id' ? parentPage.parent.page_id || null : null
  }

  for (const ancestor of ancestors) {
    breadcrumbs.push({
      label: ancestor.title,
      href: pagePath(ancestor.id, ancestor.title),
    })
  }

  return breadcrumbs
}

function normalizeRoutePath(pageId: string, title: string, rootPageId: string): string {
  if (pageId.replace(/-/g, '') === rootPageId.replace(/-/g, '')) {
    return '/'
  }

  return pagePath(pageId, title)
}

async function ensureLocalImages(originUrls: Iterable<string>): Promise<Map<string, string>> {
  const localPaths = new Map<string, string>()

  for (const originUrl of originUrls) {
    const existingEntry = imageEntries.get(originUrl)
    const localPath = existingEntry?.localPath || `/assets/images/${createHash('sha1').update(originUrl).digest('hex')}`
    localPaths.set(originUrl, localPath)

    if (!existingEntry || !(await fileExists(staticBinaryFilePath(siteKey, existingEntry.localPath)))) {
      const { contentType } = await downloadBinary(originUrl, staticBinaryFilePath(siteKey, localPath))
      imageEntries.set(originUrl, {
        key: originUrl,
        localPath,
        sourceUrl: originUrl,
        contentType,
        updatedAt: Date.now(),
      })
    }
  }

  return localPaths
}

async function ensureLocalAssets(assets: AssetMetadata[]): Promise<Map<string, string>> {
  const localPaths = new Map<string, string>()

  for (const asset of assets) {
    const existingEntry = assetEntries.get(asset.id)
    const localPath = existingEntry?.localPath || `/assets/files/${asset.id}`
    localPaths.set(asset.id, localPath)

    if (!existingEntry || !(await fileExists(staticBinaryFilePath(siteKey, existingEntry.localPath)))) {
      const { contentType } = await downloadBinary(asset.sourceUrl, staticBinaryFilePath(siteKey, localPath))
      assetEntries.set(asset.id, {
        key: asset.id,
        localPath,
        sourceUrl: asset.sourceUrl,
        contentType,
        updatedAt: Date.now(),
      })
    }
  }

  return localPaths
}

async function downloadBinary(url: string, targetPath: string): Promise<{ contentType: string }> {
  await mkdir(dirname(targetPath), { recursive: true })

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NotionMirrorBackup/1.0)',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`)
  }

  const contentType = response.headers.get('content-type') || 'application/octet-stream'
  await Bun.write(targetPath, await response.arrayBuffer())
  return { contentType }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const existing = await stat(path)
    return existing.isFile() && existing.size > 0
  } catch {
    return false
  }
}

function extractImageSources(html: string): string[] {
  const matches = html.matchAll(/\/_image\/([^"' )?]+)(?:\?social=1)?/g)
  const originUrls = new Set<string>()

  for (const match of matches) {
    const encoded = match[1]
    if (!encoded) {
      continue
    }

    try {
      originUrls.add(decodeURIComponent(encoded))
    } catch {
      // Ignore malformed URLs in rendered HTML.
    }
  }

  return [...originUrls]
}

function rewriteHtmlForLocal(
  html: string,
  imagePathMap: Map<string, string>,
  assetPathMap: Map<string, string>,
): string {
  let next = html.replace(/\/_image\/([^"' )?]+)(\?social=1)?/g, (full, encoded) => {
    try {
      return imagePathMap.get(decodeURIComponent(encoded)) || full
    } catch {
      return full
    }
  })

  next = next.replace(/\/_asset\/([^"' )?]+)/g, (full, encoded) => {
    try {
      return assetPathMap.get(decodeURIComponent(encoded)) || full
    } catch {
      return full
    }
  })

  return next
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

function getRichTextArrays(block: Block): Array<Array<{ type: string; href: string | null; resolvedPageId?: string | null; mention?: { type: string; page?: { id: string } } }>> {
  const arrays = []
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

function normalizeRoutes(routes: LocalRouteEntry[]): LocalRouteEntry[] {
  const deduped = new Map<string, LocalRouteEntry>()

  for (const route of routes) {
    const existing = deduped.get(route.path)
    if (!existing || (route.lastEditedTime || '') > (existing.lastEditedTime || '')) {
      deduped.set(route.path, route)
    }
  }

  return [...deduped.values()].sort((left, right) => left.path.localeCompare(right.path))
}

function sortAssetEntries(left: LocalBinaryAssetEntry, right: LocalBinaryAssetEntry): number {
  return left.localPath.localeCompare(right.localPath)
}

function toPageId(input: string, rootPageId: string): string {
  if (!input || input === '/') {
    return rootPageId
  }

  const compactId = extractPageId(input)
  if (!compactId) {
    throw new Error(`Could not extract a Notion page id from: ${input}`)
  }

  return `${compactId.slice(0, 8)}-${compactId.slice(8, 12)}-${compactId.slice(12, 16)}-${compactId.slice(16, 20)}-${compactId.slice(20)}`
}

async function fetchWorkspaceAccessiblePageIds(apiKey: string): Promise<string[]> {
  const pageIds = new Set<string>([env.ROOT_PAGE_ID])
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
    for (const page of response.results as Array<{ id: string; in_trash?: boolean; archived?: boolean; is_archived?: boolean }>) {
      if (page.in_trash || page.archived || page.is_archived) {
        continue
      }

      pageIds.add(page.id)
    }

    cursor = response.has_more ? response.next_cursor : undefined
  } while (cursor)

  return [...pageIds]
}

function buildBlockToPageLookup(pageDataMap: Map<string, PageData>): Map<string, string> {
  const lookup = new Map<string, string>()

  function walkBlocks(blocks: Block[], ownerPageId: string) {
    for (const block of blocks) {
      lookup.set(block.id, ownerPageId)
      if (block._children?.length) {
        walkBlocks(block._children, ownerPageId)
      }
    }
  }

  for (const [pageId, pageData] of pageDataMap.entries()) {
    lookup.set(pageId, pageId)
    walkBlocks(pageData.blocks, pageId)
  }

  return lookup
}

function resolveParentPageId(page: Page, blockToPage: Map<string, string>): string | null {
  const parent = page.parent
  if (!parent) {
    return null
  }

  if (parent.type === 'page_id' && parent.page_id) {
    return parent.page_id
  }

  if (parent.type === 'block_id' && parent.block_id) {
    return blockToPage.get(parent.block_id) ?? null
  }

  return null
}

function computeDepth(pageId: string, parentMap: Map<string, string | null>, rootPageId: string): number {
  const rootCompact = rootPageId.replace(/-/g, '')
  if (pageId.replace(/-/g, '') === rootCompact) {
    return 0
  }

  let depth = 0
  let currentId: string | null = pageId
  const seen = new Set<string>()

  while (currentId) {
    const compactId = currentId.replace(/-/g, '')
    if (compactId === rootCompact || seen.has(compactId)) {
      break
    }

    seen.add(compactId)
    const parentId = parentMap.get(currentId) ?? null
    if (!parentId) {
      break
    }

    depth++
    currentId = parentId
  }

  return depth
}

async function notionApiRequest(apiKey: string, path: string, body: Record<string, unknown>): Promise<any> {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`Notion API request failed (${response.status}): ${await response.text()}`)
  }

  return response.json()
}
