import type { Env } from './config'
import { getCachedAsset, getCachedAssetMetadata, setCachedAsset, setCachedAssetMetadata } from './cache'
import { collectPageAssetMetadata, type AssetMetadata } from './document-assets'
import { fetchPageData } from './notion-client'

const SIGNED_URL_REFRESH_SKEW_MS = 60 * 1000

export async function handleAssetProxy(identifier: string, env: Env): Promise<Response> {
  if (identifier.startsWith('http')) {
    return handleLegacyAssetProxy(identifier, env)
  }

  const cached = await getCachedAsset(env, identifier)
  if (cached) {
    return new Response(cached.body, {
      headers: buildHeaders(
        cached.httpMetadata?.contentType || 'application/octet-stream',
        cached.httpMetadata?.contentDisposition || undefined,
        cached.httpMetadata?.cacheControl || 'public, max-age=31536000, immutable',
      ),
    })
  }

  let metadata = await getCachedAssetMetadata(env, identifier)
  if (!metadata) {
    return new Response('Asset metadata not found', { status: 404 })
  }

  metadata = await refreshMetadataIfNeeded(metadata, env)
  const freshResponse = await fetchAssetResponse(metadata.sourceUrl)
  if (!freshResponse.ok && metadata.sourceType === 'file') {
    const refreshed = await refreshMetadataFromNotion(metadata, env)
    if (refreshed) {
      metadata = refreshed
    }
  }

  const response = freshResponse.ok ? freshResponse : await fetchAssetResponse(metadata.sourceUrl)
  if (!response.ok) {
    return new Response('Asset not found', { status: 404 })
  }

  const contentType = response.headers.get('content-type') || 'application/octet-stream'
  const contentDisposition = resolveContentDisposition(response, metadata, contentType)
  const data = await response.arrayBuffer()

  try {
    await setCachedAsset(env, metadata.id, data, contentType, contentDisposition)
  } catch (error) {
    console.error('Failed to cache asset in R2:', error)
  }

  return new Response(data, {
    headers: buildHeaders(contentType, contentDisposition, 'public, max-age=86400'),
  })
}

async function refreshMetadataIfNeeded(metadata: AssetMetadata, env: Env): Promise<AssetMetadata> {
  if (metadata.sourceType !== 'file' || !metadata.signedUrlExpiresAt) {
    return metadata
  }

  if (Date.now() < metadata.signedUrlExpiresAt - SIGNED_URL_REFRESH_SKEW_MS) {
    return metadata
  }

  return (await refreshMetadataFromNotion(metadata, env)) || metadata
}

async function refreshMetadataFromNotion(metadata: AssetMetadata, env: Env): Promise<AssetMetadata | null> {
  try {
    const pageData = await fetchPageData(env.NOTION_API_KEY, metadata.pageId)
    const refreshed = collectPageAssetMetadata(pageData).find((asset) => asset.id === metadata.id) || null
    if (!refreshed) {
      return null
    }

    await setCachedAssetMetadata(env, refreshed)
    return refreshed
  } catch (error) {
    console.error('Failed to refresh asset metadata from Notion:', error)
    return null
  }
}

async function fetchAssetResponse(url: string): Promise<Response> {
  try {
    return await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NotionMirror/1.0)',
      },
    })
  } catch {
    return new Response(null, { status: 502 })
  }
}

async function handleLegacyAssetProxy(url: string, env: Env): Promise<Response> {
  const legacyKey = `legacy:${url}`
  const cached = await getCachedAsset(env, legacyKey)

  if (cached) {
    return new Response(cached.body, {
      headers: buildHeaders(
        cached.httpMetadata?.contentType || 'application/octet-stream',
        cached.httpMetadata?.contentDisposition || undefined,
        cached.httpMetadata?.cacheControl || 'public, max-age=31536000, immutable',
      ),
    })
  }

  const response = await fetchAssetResponse(url)
  if (!response.ok) {
    return new Response('Asset not found', { status: 404 })
  }

  const contentType = response.headers.get('content-type') || 'application/octet-stream'
  const contentDisposition = resolveContentDisposition(response, {
    fileName: fallbackFileName(url),
    sourceType: 'file',
  } as AssetMetadata, contentType)
  const data = await response.arrayBuffer()

  try {
    await setCachedAsset(env, legacyKey, data, contentType, contentDisposition)
  } catch (error) {
    console.error('Failed to cache legacy asset in R2:', error)
  }

  return new Response(data, {
    headers: buildHeaders(contentType, contentDisposition, 'public, max-age=86400'),
  })
}

function buildHeaders(contentType: string, contentDisposition?: string, cacheControl?: string): Headers {
  const headers = new Headers()
  headers.set('content-type', contentType)
  headers.set('cache-control', cacheControl || 'public, max-age=86400')

  if (contentDisposition) {
    headers.set('content-disposition', contentDisposition)
  }

  return headers
}

function resolveContentDisposition(response: Response, metadata: AssetMetadata, contentType: string): string | undefined {
  if (contentType === 'application/pdf' || contentType.startsWith('audio/') || contentType.startsWith('video/')) {
    return 'inline'
  }

  return response.headers.get('content-disposition') || fallbackAttachmentName(metadata.fileName)
}

function fallbackAttachmentName(fileName: string | null | undefined): string | undefined {
  if (!fileName) {
    return undefined
  }

  return `attachment; filename="${fileName.replace(/"/g, '')}"`
}

function fallbackFileName(url: string): string | null {
  try {
    const pathname = new URL(url).pathname
    return pathname.split('/').filter(Boolean).pop() || null
  } catch {
    return null
  }
}
