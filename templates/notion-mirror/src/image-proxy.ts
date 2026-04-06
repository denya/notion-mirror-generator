import type { Env } from './config'
import { getCachedImage, setCachedImage, imageKey } from './cache'

export interface ImageProxyOptions {
  social?: boolean
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

  // Fetch from origin
  try {
    const response = await fetch(url, buildFetchOptions(options))

    if (!response.ok) {
      return new Response('Image not found', { status: 404 })
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg'
    const data = await response.arrayBuffer()

    // Store in R2 (fire and forget)
    try {
      await setCachedImage(env, key, data, contentType)
    } catch (e) {
      console.error('Failed to cache image in R2:', e)
    }

    const headers = new Headers()
    headers.set('content-type', contentType)
    headers.set('cache-control', 'public, max-age=86400')
    return new Response(data, { headers })
  } catch (e) {
    console.error('Failed to fetch image:', e)
    return new Response('Failed to fetch image', { status: 502 })
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
