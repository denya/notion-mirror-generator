import type { Env } from './config'
import type { OgMetadata } from './og-metadata'
import type { AssetMetadata } from './document-assets'
import type { SitemapEntry } from './sitemap'

export interface CachedPageEntry {
  html: string
  cachedAt: number
}

export interface CachedOgEntry {
  metadata: OgMetadata | null
  cachedAt: number
}

export interface CachedSitemapEntry {
  entries: SitemapEntry[]
  cachedAt: number
}

export interface CachedPageMetadataEntry {
  pageId: string
  path: string
  title: string
  icon?: string | null
  parentPageId?: string | null
  lastModified?: string
  cachedAt: number
}

export async function getCachedPage(env: Env, pageId: string): Promise<CachedPageEntry | null> {
  const raw = await env.PAGE_CACHE.get(`page:${pageId}`)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CachedPageEntry>
    if (typeof parsed.html === 'string') {
      return {
        html: parsed.html,
        cachedAt: typeof parsed.cachedAt === 'number' ? parsed.cachedAt : 0,
      }
    }
  } catch {
    // Backward compatibility with older plain-string cache entries.
  }

  return {
    html: raw,
    cachedAt: 0,
  }
}

export async function setCachedPage(env: Env, pageId: string, html: string, ttlSeconds: number): Promise<void> {
  const payload: CachedPageEntry = {
    html,
    cachedAt: Date.now(),
  }

  await env.PAGE_CACHE.put(`page:${pageId}`, JSON.stringify(payload))
}

export async function getCachedSitemap(env: Env): Promise<CachedSitemapEntry | null> {
  const raw = await env.PAGE_CACHE.get('sitemap')
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CachedSitemapEntry>
    if (Array.isArray(parsed.entries)) {
      const entries = parsed.entries
        .filter((entry): entry is SitemapEntry => !!entry && typeof entry.path === 'string' && entry.path.startsWith('/'))
        .map((entry) => entry.lastModified ? { path: entry.path, lastModified: entry.lastModified } : { path: entry.path })

      if (!entries.length) {
        return null
      }

      return {
        entries,
        cachedAt: typeof parsed.cachedAt === 'number' ? parsed.cachedAt : 0,
      }
    }
  } catch {
    // Ignore invalid sitemap cache payloads.
  }

  return null
}

export async function setCachedSitemap(env: Env, entries: SitemapEntry[]): Promise<void> {
  const payload: CachedSitemapEntry = {
    entries,
    cachedAt: Date.now(),
  }

  await env.PAGE_CACHE.put('sitemap', JSON.stringify(payload))
}

export async function getCachedOgMetadata(env: Env, url: string): Promise<CachedOgEntry | null> {
  const raw = await env.PAGE_CACHE.get(`og:${ogKey(url)}`)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CachedOgEntry>
    return {
      metadata: parsed.metadata === undefined ? null : (parsed.metadata as OgMetadata | null),
      cachedAt: typeof parsed.cachedAt === 'number' ? parsed.cachedAt : 0,
    }
  } catch {
    return null
  }
}

export async function setCachedOgMetadata(env: Env, url: string, metadata: OgMetadata | null): Promise<void> {
  const payload: CachedOgEntry = {
    metadata,
    cachedAt: Date.now(),
  }

  await env.PAGE_CACHE.put(`og:${ogKey(url)}`, JSON.stringify(payload))
}

export function isCachedPageFresh(entry: CachedPageEntry, ttlSeconds: number): boolean {
  if (!entry.cachedAt) {
    return false
  }

  return (Date.now() - entry.cachedAt) < (ttlSeconds * 1000)
}

export function isCachedSitemapFresh(entry: CachedSitemapEntry, ttlSeconds: number): boolean {
  if (!entry.cachedAt) {
    return false
  }

  return (Date.now() - entry.cachedAt) < (ttlSeconds * 1000)
}

export function isCachedOgFresh(entry: CachedOgEntry, ttlSeconds: number): boolean {
  if (!entry.cachedAt) {
    return false
  }

  return (Date.now() - entry.cachedAt) < (ttlSeconds * 1000)
}

export async function listCachedPageMetadata(
  env: Env,
): Promise<CachedPageMetadataEntry[]> {
  const pages: CachedPageMetadataEntry[] = []
  let cursor: string | undefined

  do {
    const result = await env.PAGE_CACHE.list({ prefix: 'page-meta:', cursor })
    for (const key of result.keys) {
      const raw = await env.PAGE_CACHE.get(key.name)
      if (!raw) {
        continue
      }

      try {
        const parsed = JSON.parse(raw) as Partial<CachedPageMetadataEntry>
        const entry = normalizeCachedPageMetadataEntry(parsed)
        if (entry) {
          pages.push(entry)
        }
      } catch {
        // Ignore invalid page metadata entries.
      }
    }

    cursor = result.list_complete ? undefined : result.cursor
  } while (cursor)

  return normalizeCachedPageMetadataEntries(pages)
}

export async function setCachedPageMetadata(
  env: Env,
  entry: Omit<CachedPageMetadataEntry, 'cachedAt'> & { cachedAt?: number },
): Promise<void> {
  const payload = {
    ...entry,
    cachedAt: typeof entry.cachedAt === 'number' ? entry.cachedAt : Date.now(),
  } satisfies CachedPageMetadataEntry

  await env.PAGE_CACHE.put(`page-meta:${normalizePageId(entry.pageId)}`, JSON.stringify(payload))
}

export async function getCachedPageMetadata(env: Env, pageId: string): Promise<CachedPageMetadataEntry | null> {
  const raw = await env.PAGE_CACHE.get(`page-meta:${normalizePageId(pageId)}`)
  if (!raw) {
    return null
  }

  try {
    return normalizeCachedPageMetadataEntry(JSON.parse(raw))
  } catch {
    return null
  }
}

// Deletes every page-meta entry whose normalized page id is not in keepPageIds.
// Used to keep the page index (TOC + sitemap) authoritative: pages that are no
// longer part of the mirror's root page tree are evicted instead of lingering.
export async function pruneCachedPageMetadata(env: Env, keepPageIds: Set<string>): Promise<void> {
  const keep = new Set([...keepPageIds].map((id) => normalizePageId(id)))
  let cursor: string | undefined

  do {
    const result = await env.PAGE_CACHE.list({ prefix: 'page-meta:', cursor })
    for (const key of result.keys) {
      const normalizedId = key.name.slice('page-meta:'.length)
      if (!keep.has(normalizedId)) {
        await env.PAGE_CACHE.delete(key.name)
      }
    }

    cursor = result.list_complete ? undefined : result.cursor
  } while (cursor)
}

export async function getCachedImage(env: Env, key: string): Promise<R2ObjectBody | null> {
  return env.IMAGE_STORE.get(`img/${key}`)
}

export async function setCachedImage(env: Env, key: string, data: ArrayBuffer, contentType: string): Promise<void> {
  await env.IMAGE_STORE.put(`img/${key}`, data, {
    httpMetadata: { contentType },
  })
}

export async function getCachedAsset(env: Env, key: string): Promise<R2ObjectBody | null> {
  return env.IMAGE_STORE.get(`asset/${key}`)
}

export async function setCachedAsset(
  env: Env,
  key: string,
  data: ArrayBuffer,
  contentType: string,
  contentDisposition?: string,
): Promise<void> {
  await env.IMAGE_STORE.put(`asset/${key}`, data, {
    httpMetadata: {
      contentType,
      cacheControl: 'public, max-age=31536000, immutable',
      ...(contentDisposition ? { contentDisposition } : {}),
    },
  })
}

export function imageKey(url: string, variant = 'default'): string {
  // Create a deterministic key from the URL (strip query params for Notion S3 URLs)
  const u = new URL(url)
  // For Notion S3 URLs, strip the signature params but keep the path
  const cleanPath = u.pathname
  // Simple hash based on the path
  let hash = 0
  const str = `${variant}:${u.host}${cleanPath}`
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit int
  }
  const ext = cleanPath.split('.').pop() || 'bin'
  return `${Math.abs(hash).toString(36)}.${ext}`
}

export function assetKey(url: string): string {
  const u = new URL(url)
  const normalizedUrl = `${u.host}${u.pathname}${normalizedSearch(u)}`
  let hash = 0

  for (let i = 0; i < normalizedUrl.length; i++) {
    const char = normalizedUrl.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash &= hash
  }

  const ext = u.pathname.split('.').pop() || 'bin'
  return `${Math.abs(hash).toString(36)}.${ext}`
}

export async function getCachedAssetMetadata(env: Env, assetId: string): Promise<AssetMetadata | null> {
  const raw = await env.PAGE_CACHE.get(`asset:${assetId}`)
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as AssetMetadata
  } catch {
    return null
  }
}

export async function setCachedAssetMetadata(env: Env, metadata: AssetMetadata): Promise<void> {
  await env.PAGE_CACHE.put(`asset:${metadata.id}`, JSON.stringify(metadata))
}

export async function setCachedAssetMetadataBatch(env: Env, assets: AssetMetadata[]): Promise<void> {
  await Promise.all(assets.map((asset) => setCachedAssetMetadata(env, asset)))
}

function ogKey(url: string): string {
  let hash = 0
  for (let i = 0; i < url.length; i += 1) {
    const char = url.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash &= hash
  }
  return Math.abs(hash).toString(36)
}

function normalizedSearch(url: URL): string {
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !isTransientSignedParam(key))
    .sort(([left], [right]) => left.localeCompare(right))

  if (!params.length) {
    return ''
  }

  return `?${new URLSearchParams(params).toString()}`
}

function isTransientSignedParam(key: string): boolean {
  const normalized = key.toLowerCase()
  return normalized.startsWith('x-amz-') || normalized === 'x-id'
}

function normalizeCachedPageMetadataEntries(entries: unknown[]): CachedPageMetadataEntry[] {
  const deduped = new Map<string, CachedPageMetadataEntry>()

  for (const entry of entries) {
    const candidate = normalizeCachedPageMetadataEntry(entry)
    if (!candidate) {
      continue
    }

    const normalizedPageId = normalizePageId(candidate.pageId)
    const existing = deduped.get(normalizedPageId)

    if (!existing || candidate.cachedAt >= existing.cachedAt) {
      deduped.set(normalizedPageId, candidate)
    }
  }

  return [...deduped.values()].sort((left, right) => left.path.localeCompare(right.path))
}

function normalizeCachedPageMetadataEntry(entry: unknown): CachedPageMetadataEntry | null {
  if (!entry || typeof entry !== 'object') {
    return null
  }

  const page = entry as Partial<CachedPageMetadataEntry>
  if (typeof page.pageId !== 'string' || typeof page.path !== 'string' || !page.path.startsWith('/')) {
    return null
  }

  return {
    pageId: page.pageId,
    path: page.path,
    title: typeof page.title === 'string' ? page.title : 'Untitled',
    ...(typeof page.icon === 'string' ? { icon: page.icon } : {}),
    ...(typeof page.parentPageId === 'string' ? { parentPageId: page.parentPageId } : {}),
    ...(typeof page.lastModified === 'string' ? { lastModified: page.lastModified } : {}),
    cachedAt: typeof page.cachedAt === 'number' ? page.cachedAt : 0,
  }
}

function normalizePageId(pageId: string): string {
  return pageId.replace(/-/g, '').toLowerCase()
}
