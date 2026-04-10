import { Hono } from 'hono'
import type { Env } from './config'
import { getConfig } from './config'
import { fetchPageAncestors, fetchPageData, collectBookmarkUrls, getPageCover, getPageIcon, type Block, type PageData, warmBookmarkMetadata } from './notion-client'
import { renderGoogleTagScript, renderPage } from './template'
import { getCachedPage, getCachedSitemap, isCachedPageFresh, isCachedSitemapFresh, listCachedPageMetadata, setCachedAssetMetadataBatch, setCachedPage, setCachedPageMetadata, setCachedSitemap } from './cache'
import { handleImageProxy, warmImageCache } from './image-proxy'
import { handleAssetProxy } from './asset-proxy'
import { escapeHtml } from './rich-text'
import { canonicalPagePath, extractPageId } from './page-path'
import { getPageTitle } from './notion-client'
import { collectSitemapEntries, normalizeSitemapEntries, renderSitemapXml, staticSitemapEntries, type SitemapEntry } from './sitemap'
import { buildPageBreadcrumbs } from './breadcrumbs'
import { resolveShortLinkRedirect } from './short-links'
import { collectPageAssetMetadata } from './document-assets'

type AppEnv = { Bindings: Env }
interface RenderedPageCacheResult {
  html: string
  bookmarkUrls: string[]
  socialImageUrls: string[]
}

const app = new Hono<AppEnv>()
const pendingPageUpdates = new Map<string, Promise<RenderedPageCacheResult>>()
let pendingSitemapUpdate: Promise<SitemapEntry[]> | null = null

app.use('*', async (c, next) => {
  const config = getConfig(c.env)
  const target = resolveShortLinkRedirect(c.req.url, config.shortLinks)

  if (target) {
    return c.redirect(target, config.shortLinkRedirectStatus)
  }

  await next()
})

// Robots.txt
app.get('/robots.txt', (c) => {
  const domain = c.env.SITE_DOMAIN
  return c.text(`User-agent: *\nAllow: /\n\nSitemap: https://${domain}/sitemap.xml`)
})

// Sitemap
app.get('/sitemap.xml', async (c) => {
  const config = getConfig(c.env)
  const cached = await getCachedSitemap(c.env)

  try {
    if (cached) {
      if (!isCachedSitemapFresh(cached, config.cacheTtlSeconds)) {
        c.executionCtx.waitUntil(scheduleSitemapRefresh(c.env, config).then(() => undefined))
      }

      return xmlResponse(config.domain, cached.entries)
    }

    const indexedEntries = await getIndexedSitemapEntries(c.env, config)
    c.executionCtx.waitUntil(scheduleSitemapRefresh(c.env, config).then(() => undefined))
    return xmlResponse(config.domain, indexedEntries.length ? indexedEntries : staticSitemapEntries(config))
  } catch (e: any) {
    console.error('Sitemap refresh failed:', e?.message || e)
    const indexedEntries = await getIndexedSitemapEntries(c.env, config)
    return xmlResponse(config.domain, indexedEntries.length ? indexedEntries : staticSitemapEntries(config))
  }
})

// Image proxy
app.get('/_image/:url', async (c) => {
  // Hono already decodes route params once. Decoding again breaks signed Notion asset URLs.
  const url = c.req.param('url')
  const social = c.req.query('social') === '1'

  if (!url.startsWith('http')) {
    return c.text('Invalid URL', 400)
  }

  return handleImageProxy(url, c.env, { social })
})

app.get('/_asset/:url', async (c) => {
  const url = c.req.param('url')

  // Asset proxy accepts both legacy signed URLs and stable asset IDs.
  if (!url) {
    return c.text('Invalid URL', 400)
  }

  return handleAssetProxy(url, c.env)
})

// Favicon
app.get('/favicon.ico', async (c) => {
  const config = getConfig(c.env)
  try {
    const pageData = await fetchPageData(c.env.NOTION_API_KEY, config.rootPageId)
    const icon = pageData.page.icon
    if (icon?.type === 'emoji' && icon.emoji) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${icon.emoji}</text></svg>`
      return c.body(svg, 200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' })
    }
  } catch {}
  return c.text('', 404)
})

// Root page
app.get('/', async (c) => {
  const config = getConfig(c.env)
  return servePage(c, config.rootPageId)
})

// Page by ID (32-char hex)
app.get('/:id{[a-f0-9]{32}}', async (c) => {
  const pageId = c.req.param('id')
  return servePage(c, formatPageId(pageId))
})

// Page by UUID format
app.get('/:id{[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}}', async (c) => {
  const pageId = c.req.param('id')
  return servePage(c, pageId)
})

// Notion-style slug with ID at the end (e.g., "My-Page-Title-abc123def456...")
app.get('/:slug', async (c) => {
  const slug = c.req.param('slug')
  const config = getConfig(c.env)

  // Check slug map
  if (config.slugToPage[slug]) {
    return servePage(c, config.slugToPage[slug])
  }

  const pageId = extractPageId(slug)
  if (pageId) {
    return servePage(c, formatPageId(pageId))
  }

  return c.text('Page not found', 404)
})

async function servePage(c: any, pageId: string): Promise<Response> {
  const env: Env = c.env
  const config = getConfig(env)
  const refresh = c.req.query('refresh') === '1'
  const requestPath = c.req.path

  if (pageId.replace(/-/g, '') === config.rootPageId.replace(/-/g, '') && requestPath !== '/') {
    const target = refresh ? '/?refresh=1' : '/'
    return c.redirect(target, 301)
  }

  if (refresh) {
    try {
      const rendered = await schedulePageUpdate(env, config, pageId)
      c.executionCtx.waitUntil(warmPageDependencies(env, rendered).then(() => undefined))
      return c.html(rendered.html)
    } catch (e: any) {
      console.error(`Forced refresh failed for page ${pageId}:`, e?.message || e)
    }
  }

  const cached = await getCachedPage(env, pageId)

  if (cached) {
    const shouldRevalidate = !isCachedPageFresh(cached, config.cacheTtlSeconds)
    if (shouldRevalidate) {
      c.executionCtx.waitUntil(
        schedulePageUpdate(env, config, pageId)
          .then((rendered) => warmPageDependencies(env, rendered))
          .then(() => undefined),
      )
    }

    return c.html(cached.html)
  }

  try {
    const rendered = await schedulePageUpdate(env, config, pageId)
    c.executionCtx.waitUntil(warmPageDependencies(env, rendered).then(() => undefined))
    return c.html(rendered.html)
  } catch (e: any) {
    console.error(`Failed to fetch page ${pageId}:`, e?.message || e)
    return c.html(errorPage(config, 'Page not available', 'The page could not be loaded. Please try again later.'), 503)
  }
}

async function fetchAndCachePage(env: Env, config: ReturnType<typeof getConfig>, pageId: string): Promise<RenderedPageCacheResult> {
  const pageData = await fetchPageData(env.NOTION_API_KEY, pageId, env)
  await setCachedAssetMetadataBatch(env, collectPageAssetMetadata(pageData))
  const title = getPageTitle(pageData.page)
  const canonicalPath = canonicalPagePath(pageData.page.id, title, config.rootPageId)
  const ancestors = await fetchPageAncestors(env.NOTION_API_KEY, pageData.page, config.rootPageId)
  const breadcrumbs = buildPageBreadcrumbs(config, pageId, title, ancestors)
  const html = renderPage(pageData, config, breadcrumbs)
  const cachedAt = Date.now()
  await setCachedPage(env, pageId, html, config.cacheTtlSeconds)
  await setCachedPageMetadata(env, {
    pageId: pageData.page.id,
    path: canonicalPath,
    title,
    ...(pageData.page.last_edited_time ? { lastModified: pageData.page.last_edited_time } : {}),
    cachedAt,
  })

  return {
    html,
    bookmarkUrls: collectBookmarkUrls(pageData.blocks),
    socialImageUrls: collectSocialImageUrls(pageData),
  }
}

function schedulePageUpdate(env: Env, config: ReturnType<typeof getConfig>, pageId: string): Promise<RenderedPageCacheResult> {
  const existing = pendingPageUpdates.get(pageId)
  if (existing) {
    return existing
  }

  const next = fetchAndCachePage(env, config, pageId)
    .finally(() => {
      pendingPageUpdates.delete(pageId)
    })

  pendingPageUpdates.set(pageId, next)
  return next
}

async function refreshSitemap(env: Env, config: ReturnType<typeof getConfig>): Promise<SitemapEntry[]> {
  const entries = await collectSitemapEntries(env.NOTION_API_KEY, config, {
    onError(pageId, error) {
      console.warn(`Skipping sitemap page ${pageId}:`, error instanceof Error ? error.message : error)
    },
  })
  const resolvedEntries = entries.length ? entries : staticSitemapEntries(config)
  await setCachedSitemap(env, resolvedEntries)
  return resolvedEntries
}

function scheduleSitemapRefresh(env: Env, config: ReturnType<typeof getConfig>): Promise<SitemapEntry[]> {
  if (pendingSitemapUpdate) {
    return pendingSitemapUpdate
  }

  pendingSitemapUpdate = refreshSitemap(env, config).finally(() => {
    pendingSitemapUpdate = null
  })

  return pendingSitemapUpdate
}

async function getIndexedSitemapEntries(env: Env, config: ReturnType<typeof getConfig>): Promise<SitemapEntry[]> {
  const pages = await listCachedPageMetadata(env)
  if (!pages.length) {
    return []
  }

  return normalizeSitemapEntries([
    ...pages.map((page) => page.lastModified ? { path: page.path, lastModified: page.lastModified } : { path: page.path }),
    ...staticSitemapEntries(config),
  ])
}

async function warmPageDependencies(env: Env, rendered: RenderedPageCacheResult): Promise<void> {
  await Promise.all([
    warmBookmarkMetadata(env, rendered.bookmarkUrls),
    warmSocialImages(env, rendered.socialImageUrls),
  ])
}

async function warmSocialImages(env: Env, imageUrls: string[]): Promise<void> {
  const uniqueUrls = [...new Set(imageUrls)].filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url))
  if (!uniqueUrls.length) {
    return
  }

  await Promise.all(uniqueUrls.map((url) => Promise.all([
    warmImageCache(url, env, { force: true }),
    warmImageCache(url, env, { social: true, force: true }),
  ])))
}

function collectSocialImageUrls(pageData: PageData): string[] {
  const urls = new Set<string>()
  const cover = getPageCover(pageData.page)
  const icon = getPageIcon(pageData.page)
  const firstImage = findFirstImage(pageData.blocks)

  if (cover) {
    urls.add(cover)
  }
  if (firstImage) {
    urls.add(firstImage)
  }
  if (icon?.startsWith('http')) {
    urls.add(icon)
  }

  return [...urls]
}

function findFirstImage(blocks: Block[]): string | null {
  for (const block of blocks) {
    if (block.type === 'image') {
      const imageUrl = getFileUrl(block.image)
      if (imageUrl) {
        return imageUrl
      }
    }

    if (block._children?.length) {
      const nested = findFirstImage(block._children)
      if (nested) {
        return nested
      }
    }
  }

  return null
}

function getFileUrl(file: any): string | null {
  if (file?.type === 'file') {
    return typeof file.file?.url === 'string' ? file.file.url : null
  }

  if (file?.type === 'external') {
    return typeof file.external?.url === 'string' ? file.external.url : null
  }

  return null
}

function xmlResponse(domain: string, entries: SitemapEntry[]): Response {
  return new Response(renderSitemapXml(domain, entries), {
    status: 200,
    headers: {
      'content-type': 'application/xml',
      'cache-control': 'public, max-age=300, stale-while-revalidate=31536000',
    },
  })
}

function formatPageId(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function errorPage(config: any, title: string, message: string): string {
  const googleTagScript = renderGoogleTagScript(config.googleTagId)
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | ${escapeHtml(config.siteName)}</title>
  ${googleTagScript}
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #fff; color: #37352f; }
    .error { text-align: center; }
    h1 { font-size: 1.5em; margin-bottom: 8px; }
    p { color: #6b6b6b; }
  </style>
</head>
<body>
  <div class="error">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`
}

export default app
