import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  localAssetsManifestPath,
  localImagesManifestPath,
  readJsonFile,
  resolveSiteKey,
  siteManifestPath,
  siteStaticRoot,
  type LocalBinaryAssetEntry,
  type LocalSiteManifest,
} from './site-data'

const siteKey = resolveSiteKey()
const port = Number(process.env.PORT || '8788')
const staticRoot = siteStaticRoot(siteKey)
const siteManifest = await readJsonFile<LocalSiteManifest>(siteManifestPath(siteKey))

if (!siteManifest) {
  throw new Error(`No local backup found for "${siteKey}". Run "bun run backup" or "bun run backup:workspace" first.`)
}

const imageEntries = await readJsonFile<LocalBinaryAssetEntry[]>(localImagesManifestPath(siteKey)) || []
const assetEntries = await readJsonFile<LocalBinaryAssetEntry[]>(localAssetsManifestPath(siteKey)) || []
const assetByPath = new Map<string, LocalBinaryAssetEntry>()

for (const entry of [...imageEntries, ...assetEntries]) {
  assetByPath.set(entry.localPath, entry)
}

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname === '/__backup/routes.json') {
      return Response.json(siteManifest.routes)
    }

    const asset = assetByPath.get(url.pathname)
    if (asset) {
      return new Response(Bun.file(join(staticRoot, asset.localPath.replace(/^\/+/, ''))), {
        headers: {
          'content-type': asset.contentType,
          'cache-control': 'no-cache',
        },
      })
    }

    const filePath = resolvePageFilePath(url.pathname)
    if (!(await fileExists(filePath))) {
      return new Response('Not found', { status: 404 })
    }

    const contentType = inferContentType(filePath)
    return new Response(Bun.file(filePath), {
      headers: {
        'content-type': contentType,
        'cache-control': 'no-cache',
      },
    })
  },
})

console.log(`Local backup server for "${siteKey}" running at http://localhost:${server.port}`)
console.log(`Serving static mirror from ${staticRoot}`)
console.log('Available routes manifest: /__backup/routes.json')

function resolvePageFilePath(pathname: string): string {
  if (pathname === '/') {
    return join(staticRoot, 'index.html')
  }

  if (pathname.endsWith('.xml') || pathname.endsWith('.html') || pathname.endsWith('.json')) {
    return join(staticRoot, pathname.replace(/^\/+/, ''))
  }

  return join(staticRoot, pathname.replace(/^\/+/, ''), 'index.html')
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error: any) {
    return error?.code === 'ENOENT' ? false : Promise.reject(error)
  }
}

function inferContentType(path: string): string {
  if (path.endsWith('.xml')) {
    return 'application/xml; charset=utf-8'
  }

  if (path.endsWith('.json')) {
    return 'application/json; charset=utf-8'
  }

  return 'text/html; charset=utf-8'
}
