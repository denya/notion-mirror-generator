import type { Env } from './config'

// Write access to this site's KV for the sync daemon, so it needs no Cloudflare
// API token. Enabled only when the SYNC_WRITE_SECRET Worker secret is set; the
// daemon sends it as a bearer token. Keys are limited to what warm-cache writes.
const ALLOWED_KEY = /^(page:|page-meta:|asset:|og:)[A-Za-z0-9:_.-]{1,400}$|^sitemap$/
const MAX_VALUE_BYTES = 20 * 1024 * 1024

export async function handleSyncWrite(request: Request, env: Env, path: string): Promise<Response> {
  if (!env.SYNC_WRITE_SECRET || !(await authorized(request, env.SYNC_WRITE_SECRET))) {
    return new Response('Not found', { status: 404 })
  }

  if (path === 'keys' && request.method === 'GET') {
    const url = new URL(request.url)
    const prefix = url.searchParams.get('prefix') || ''
    if (!prefix || !ALLOWED_KEY.test(`${prefix}x`)) {
      return json({ success: false, errors: [{ message: 'prefix not allowed' }] }, 400)
    }
    const listed = await env.PAGE_CACHE.list({ prefix, cursor: url.searchParams.get('cursor') || undefined, limit: 1000 })
    return json({
      success: true,
      result: listed.keys.map((key) => ({ name: key.name })),
      result_info: { cursor: listed.list_complete ? '' : listed.cursor },
    })
  }

  if (!path.startsWith('values/')) {
    return json({ success: false, errors: [{ message: 'unknown route' }] }, 404)
  }
  let key: string
  try {
    key = decodeURIComponent(path.slice('values/'.length))
  } catch {
    return json({ success: false, errors: [{ message: 'bad key encoding' }] }, 400)
  }
  if (!ALLOWED_KEY.test(key)) {
    return json({ success: false, errors: [{ message: 'key not allowed' }] }, 400)
  }

  if (request.method === 'PUT') {
    const declared = Number(request.headers.get('content-length') || NaN)
    if (!Number.isFinite(declared) || declared > MAX_VALUE_BYTES) {
      return json({ success: false, errors: [{ message: 'content-length required, at most 20 MiB' }] }, 413)
    }
    const body = await request.arrayBuffer()
    if (body.byteLength > MAX_VALUE_BYTES) {
      return json({ success: false, errors: [{ message: 'value too large' }] }, 413)
    }
    await env.PAGE_CACHE.put(key, body)
    return json({ success: true })
  }
  if (request.method === 'DELETE') {
    await env.PAGE_CACHE.delete(key)
    return json({ success: true })
  }
  return json({ success: false, errors: [{ message: 'method not allowed' }] }, 405)
}

async function authorized(request: Request, secret: string): Promise<boolean> {
  const header = request.headers.get('Authorization') || ''
  const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  const encoder = new TextEncoder()
  // Compare digests so the comparison is constant-time and length-independent.
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(secret)),
  ])
  const left = new Uint8Array(a)
  const right = new Uint8Array(b)
  let diff = 0
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index]
  }
  return provided.length > 0 && diff === 0
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}
