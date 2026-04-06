import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_SITE_KEY = <%- jsString(packageJsonName) %>
const DATA_ROOT = fileURLToPath(new URL('../data/sites', import.meta.url))

export interface LocalRouteEntry {
  pageId: string
  title: string
  path: string
  htmlPath: string
  lastEditedTime?: string
}

export interface LocalSiteManifest {
  siteKey: string
  domain: string
  rootPageId: string
  sourceMode: 'root-crawl' | 'workspace'
  generatedAt: number
  routes: LocalRouteEntry[]
}

export interface LocalBinaryAssetEntry {
  key: string
  localPath: string
  sourceUrl: string
  contentType: string
  updatedAt: number
}

export function resolveSiteKey(explicitSiteKey?: string): string {
  return explicitSiteKey || process.env.SITE_KEY || DEFAULT_SITE_KEY
}

export function dataSitesRoot(): string {
  return DATA_ROOT
}

export function siteDataRoot(siteKey: string): string {
  return join(DATA_ROOT, siteKey)
}

export function siteBackupRoot(siteKey: string): string {
  return join(siteDataRoot(siteKey), 'backup')
}

export function siteStaticRoot(siteKey: string): string {
  return join(siteDataRoot(siteKey), 'site')
}

export function pageBackupPath(siteKey: string, pageId: string): string {
  return join(siteBackupRoot(siteKey), 'pages', `${pageId}.json`)
}

export function siteManifestPath(siteKey: string): string {
  return join(siteBackupRoot(siteKey), 'site-manifest.json')
}

export function localImagesManifestPath(siteKey: string): string {
  return join(siteBackupRoot(siteKey), 'images.json')
}

export function localAssetsManifestPath(siteKey: string): string {
  return join(siteBackupRoot(siteKey), 'assets.json')
}

export function staticHtmlFilePath(siteKey: string, routePath: string): string {
  return join(siteStaticRoot(siteKey), toStaticHtmlRelativePath(routePath))
}

export function staticBinaryFilePath(siteKey: string, localPath: string): string {
  return join(siteStaticRoot(siteKey), localPath.replace(/^\/+/, ''))
}

export function staticSiteFilePath(siteKey: string, relativePath: string): string {
  return join(siteStaticRoot(siteKey), relativePath.replace(/^\/+/, ''))
}

export function toStaticHtmlRelativePath(routePath: string): string {
  if (routePath === '/') {
    return 'index.html'
  }

  return join(routePath.replace(/^\/+/, ''), 'index.html')
}

export async function readJsonFile<T>(path: string): Promise<T | null> {
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

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2))
}

export async function writeTextFile(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, value)
}
