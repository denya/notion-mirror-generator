import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assetKey } from '../src/cache'
import { fromCachedDocumentUrl } from '../src/asset-url'
import type { PageData } from '../src/notion-client'
import type { SitemapEntry } from '../src/sitemap'

const DEFAULT_CACHE_ROOT = fileURLToPath(new URL('../.cache/warm-cache', import.meta.url))

interface CachedPageSnapshot {
  pageData: PageData
  pageId: string
  fetchedAt: number
}

interface CachedWorkspacePageList {
  pageIds: string[]
  rootPageId: string
  fetchedAt: number
}

interface WarmedImageManifest {
  imageUrls: string[]
  updatedAt: number
}

interface WarmedAssetManifest {
  assetKeys?: string[]
  assetUrls?: string[]
  updatedAt: number
}

interface CachedSitemapManifest {
  entries: SitemapEntry[]
  updatedAt: number
}

function resolveCacheRoot(cacheRoot?: string): string {
  return cacheRoot ?? DEFAULT_CACHE_ROOT
}

function pageSnapshotPath(pageId: string, cacheRoot?: string): string {
  return join(resolveCacheRoot(cacheRoot), 'pages', `${pageId}.json`)
}

function workspaceSeedPath(cacheRoot?: string): string {
  return join(resolveCacheRoot(cacheRoot), 'workspace-pages.json')
}

function warmedImagesPath(cacheRoot?: string): string {
  return join(resolveCacheRoot(cacheRoot), 'warmed-images.json')
}

function warmedAssetsPath(cacheRoot?: string): string {
  return join(resolveCacheRoot(cacheRoot), 'warmed-assets.json')
}

function sitemapEntriesPath(cacheRoot?: string): string {
  return join(resolveCacheRoot(cacheRoot), 'sitemap-entries.json')
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as T
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return null
    }

    throw error
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2))
}

export async function readCachedPageSnapshot(pageId: string, cacheRoot?: string): Promise<CachedPageSnapshot | null> {
  const snapshot = await readJsonFile<CachedPageSnapshot>(pageSnapshotPath(pageId, cacheRoot))
  if (!snapshot || snapshot.pageId !== pageId || !snapshot.pageData) {
    return null
  }

  return snapshot
}

export async function writeCachedPageSnapshot(pageId: string, pageData: PageData, cacheRoot?: string): Promise<void> {
  await writeJsonFile(pageSnapshotPath(pageId, cacheRoot), {
    pageData,
    pageId,
    fetchedAt: Date.now(),
  } satisfies CachedPageSnapshot)
}

export async function readCachedWorkspacePageIds(rootPageId: string, cacheRoot?: string): Promise<CachedWorkspacePageList | null> {
  const snapshot = await readJsonFile<CachedWorkspacePageList>(workspaceSeedPath(cacheRoot))
  if (!snapshot || snapshot.rootPageId !== rootPageId || !Array.isArray(snapshot.pageIds)) {
    return null
  }

  return snapshot
}

export async function writeCachedWorkspacePageIds(rootPageId: string, pageIds: string[], cacheRoot?: string): Promise<void> {
  await writeJsonFile(workspaceSeedPath(cacheRoot), {
    pageIds,
    rootPageId,
    fetchedAt: Date.now(),
  } satisfies CachedWorkspacePageList)
}

export async function readCachedWarmedImages(cacheRoot?: string): Promise<Set<string>> {
  const manifest = await readJsonFile<WarmedImageManifest>(warmedImagesPath(cacheRoot))
  if (!manifest || !Array.isArray(manifest.imageUrls)) {
    return new Set<string>()
  }

  return new Set(manifest.imageUrls.filter((url): url is string => typeof url === 'string' && url.length > 0))
}

export async function writeCachedWarmedImages(imageUrls: Iterable<string>, cacheRoot?: string): Promise<void> {
  const uniqueUrls = [...new Set(imageUrls)].sort()
  await writeJsonFile(warmedImagesPath(cacheRoot), {
    imageUrls: uniqueUrls,
    updatedAt: Date.now(),
  } satisfies WarmedImageManifest)
}

export async function readCachedWarmedAssets(cacheRoot?: string): Promise<Set<string>> {
  const manifest = await readJsonFile<WarmedAssetManifest>(warmedAssetsPath(cacheRoot))
  if (!manifest) {
    return new Set<string>()
  }

  const rawValues = Array.isArray(manifest.assetKeys)
    ? manifest.assetKeys
    : Array.isArray(manifest.assetUrls)
      ? manifest.assetUrls
      : []

  return new Set(
    rawValues
      .map(toWarmedAssetKey)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  )
}

export async function writeCachedWarmedAssets(assetKeys: Iterable<string>, cacheRoot?: string): Promise<void> {
  const uniqueKeys = [...new Set(assetKeys)].sort()
  await writeJsonFile(warmedAssetsPath(cacheRoot), {
    assetKeys: uniqueKeys,
    updatedAt: Date.now(),
  } satisfies WarmedAssetManifest)
}

export async function readCachedSitemapEntries(cacheRoot?: string): Promise<SitemapEntry[]> {
  const manifest = await readJsonFile<CachedSitemapManifest>(sitemapEntriesPath(cacheRoot))
  if (!manifest || !Array.isArray(manifest.entries)) {
    return []
  }

  return manifest.entries
    .filter((entry): entry is SitemapEntry => !!entry && typeof entry.path === 'string' && entry.path.startsWith('/'))
    .map((entry) => entry.lastModified ? { path: entry.path, lastModified: entry.lastModified } : { path: entry.path })
    .sort((left, right) => left.path.localeCompare(right.path))
}

export async function writeCachedSitemapEntries(entries: Iterable<SitemapEntry>, cacheRoot?: string): Promise<void> {
  const normalizedEntries = [...entries]
    .filter((entry): entry is SitemapEntry => !!entry && typeof entry.path === 'string' && entry.path.startsWith('/'))
    .map((entry) => entry.lastModified ? { path: entry.path, lastModified: entry.lastModified } : { path: entry.path })
    .sort((left, right) => left.path.localeCompare(right.path))

  await writeJsonFile(sitemapEntriesPath(cacheRoot), {
    entries: normalizedEntries,
    updatedAt: Date.now(),
  } satisfies CachedSitemapManifest)
}

export function localWarmCacheRoot(): string {
  return resolveCacheRoot()
}

function toWarmedAssetKey(value: string): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null
  }

  if (/^https?:\/\//i.test(value)) {
    const sourceUrl = fromCachedDocumentUrl(value) ?? value
    return /^https?:\/\//i.test(sourceUrl) ? assetKey(sourceUrl) : sourceUrl
  }

  const sourceUrl = fromCachedDocumentUrl(value)
  if (sourceUrl) {
    return assetKey(sourceUrl)
  }

  return value
}
