import type { Env } from './config'
import { getCachedImage, setCachedImage, imageKey } from './cache'

export interface ImageProxyOptions {
  social?: boolean
  force?: boolean
}

export async function handleImageProxy(url: string, env: Env, options: ImageProxyOptions = {}): Promise<Response> {
  const variant = options.social ? 'social' : 'default'
  const key = imageKey(url, variant)

  // Try R2 cache first
  const cached = await getCachedImage(env, key)
  if (cached) {
    const headers = new Headers()
    headers.set('content-type', cached.httpMetadata?.contentType || 'image/jpeg')
    headers.set('cache-control', 'public, max-age=31536000, immutable')
    return new Response(cached.body, { headers })
  }

  const fetched = await fetchSourceImage(url, options)
  if (!fetched.data) {
    return new Response(fetched.status === 404 ? 'Image not found' : 'Failed to fetch image', { status: fetched.status })
  }

  try {
    await setCachedImage(env, key, fetched.data, fetched.contentType)
  } catch (e) {
    console.error('Failed to cache image in R2:', e)
  }

  const headers = new Headers()
  headers.set('content-type', fetched.contentType)
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  return new Response(fetched.data, { headers })
}

export async function warmImageCache(url: string, env: Env, options: ImageProxyOptions = {}): Promise<void> {
  const variant = options.social ? 'social' : 'default'
  const key = imageKey(url, variant)
  const cached = await getCachedImage(env, key)

  if (cached && !options.force) {
    return
  }

  const fetched = await fetchSourceImage(url, options)
  if (!fetched.data) {
    return
  }

  try {
    await setCachedImage(env, key, fetched.data, fetched.contentType)
  } catch (error) {
    console.error('Failed to warm image cache in R2:', error)
  }
}

function buildFetchOptions(options: ImageProxyOptions): RequestInit {
  const init: RequestInit & { cf?: Record<string, unknown> } = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NotionMirror/1.0)',
    },
  }

  if (options.social) {
    init.cf = {
      image: {
        width: 1200,
        quality: 82,
        fit: 'scale-down',
        format: 'jpeg',
        metadata: 'none',
      },
    }
  }

  return init
}

async function fetchSourceImage(
  url: string,
  options: ImageProxyOptions,
): Promise<{ status: number; contentType: string; data: ArrayBuffer | null }> {
  try {
    const response = await fetch(url, buildFetchOptions(options))
    if (!response.ok) {
      return {
        status: response.status === 404 ? 404 : 502,
        contentType: 'image/jpeg',
        data: null,
      }
    }

    return {
      status: response.status,
      contentType: response.headers.get('content-type') || 'image/jpeg',
      data: await response.arrayBuffer(),
    }
  } catch (error) {
    console.error('Failed to fetch image:', error)
    return {
      status: 502,
      contentType: 'image/jpeg',
      data: null,
    }
  }
}
