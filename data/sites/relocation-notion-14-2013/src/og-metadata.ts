export interface OgMetadata {
  title: string | null
  description: string | null
  image: string | null
  favicon: string | null
  siteName: string | null
}

const DOCUMENT_PREFIX_READ_LIMIT_BYTES = 128 * 1024
const FETCH_TIMEOUT_MS = 5000
const KNOWN_METADATA_BY_HOST: Record<string, OgMetadata> = {
  'spain.denyamsk.com': {
    title: "Startup in Barcelona",
    description: "Relocate to Spain: Digital Nomads and Startup founders residency permits",
    image: "https://startupvisa.barcelona/favicon.png",
    favicon: "https://startupvisa.barcelona/favicon.png",
    siteName: "Startup in Barcelona",
  },
  'spain.denyamsk.ru': {
    title: "Startup in Barcelona",
    description: "Relocate to Spain: Digital Nomads and Startup founders residency permits",
    image: "https://startupvisa.barcelona/favicon.png",
    favicon: "https://startupvisa.barcelona/favicon.png",
    siteName: "Startup in Barcelona",
  },
}

export async function fetchOgMetadata(url: string): Promise<OgMetadata | null> {
  const knownMetadata = getKnownOgMetadata(url)

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NotionMirror/1.0)',
        'Accept': 'text/html',
      },
      redirect: 'follow',
    })

    clearTimeout(timeoutId)

    const contentType = response.headers.get('content-type') || ''
    if (!response.ok || !contentType.includes('text/html')) {
      return knownMetadata
    }

    const html = await readDocumentPrefix(response.body, DOCUMENT_PREFIX_READ_LIMIT_BYTES)
    if (!html) {
      return knownMetadata
    }

    const origin = response.url ? new URL(response.url).origin : new URL(url).origin
    const extracted = {
      title: extractMeta(html, 'og:title') || extractMeta(html, 'twitter:title') || extractTitle(html),
      description: extractMeta(html, 'og:description') || extractMeta(html, 'description') || extractMeta(html, 'twitter:description'),
      image: resolveUrl(extractMeta(html, 'og:image') || extractMeta(html, 'twitter:image'), origin),
      favicon: resolveUrl(extractFavicon(html), origin) || `${origin}/favicon.ico`,
      siteName: extractMeta(html, 'og:site_name'),
    }

    if (extracted.title || extracted.description || extracted.image) {
      return extracted
    }

    return knownMetadata
  } catch {
    return knownMetadata
  }
}

export function getKnownOgMetadata(url: string): OgMetadata | null {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.replace(/^www\./, '')
    return KNOWN_METADATA_BY_HOST[hostname] || null
  } catch {
    return null
  }
}

async function readDocumentPrefix(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<string | null> {
  if (!body) {
    return null
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let result = ''
  let bytesRead = 0

  try {
    while (bytesRead < maxBytes) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      bytesRead += value.byteLength
      result += decoder.decode(value, { stream: true })
      if (result.toLowerCase().includes('</body>')) {
        break
      }
    }

    result += decoder.decode()
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  return result
}

function extractMeta(html: string, name: string): string | null {
  const escapedName = escapeRegex(name)
  const htmlPatterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escapedName}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escapedName}["']`, 'i'),
  ]

  for (const pattern of htmlPatterns) {
    const match = html.match(pattern)
    if (match?.[1]) {
      return decodeExtractedValue(match[1].trim())
    }
  }

  const normalizedHtml = html.replace(/\\"/g, '"')
  const scriptPatterns = [
    new RegExp(`"(?:property|name)":"${escapedName}","content":"((?:[^"\\\\]|\\\\.)+)"`, 'i'),
    new RegExp(`"content":"((?:[^"\\\\]|\\\\.)+)","(?:property|name)":"${escapedName}"`, 'i'),
  ]

  for (const pattern of scriptPatterns) {
    const match = normalizedHtml.match(pattern)
    if (match?.[1]) {
      return decodeExtractedValue(match[1].trim())
    }
  }

  return null
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  return match?.[1] ? decodeHtmlEntities(match[1].trim()) : null
}

function extractFavicon(html: string): string | null {
  const relPattern = /<link[^>]+rel=["']([^"']+)["'][^>]+href=["']([^"']+)["']/ig
  let match: RegExpExecArray | null

  while ((match = relPattern.exec(html)) !== null) {
    const rel = match[1].toLowerCase()
    if (rel.includes('icon')) {
      return match[2]
    }
  }

  const hrefFirstPattern = /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']([^"']+)["']/ig
  while ((match = hrefFirstPattern.exec(html)) !== null) {
    const rel = match[2].toLowerCase()
    if (rel.includes('icon')) {
      return match[1]
    }
  }

  return null
}

function resolveUrl(url: string | null, origin: string): string | null {
  if (!url) {
    return null
  }

  try {
    return new URL(url, origin).toString()
  } catch {
    return null
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
}

function decodeExtractedValue(str: string): string {
  const withJsonEscapes = decodeJsonString(str)
  return decodeHtmlEntities(withJsonEscapes)
}

function decodeJsonString(str: string): string {
  if (!str.includes('\\')) {
    return str
  }

  try {
    return JSON.parse(`"${str.replace(/"/g, '\\"')}"`)
  } catch {
    return str
      .replace(/\\u0026/g, '&')
      .replace(/\\u003c/g, '<')
      .replace(/\\u003e/g, '>')
      .replace(/\\"/g, '"')
      .replace(/\\\//g, '/')
      .replace(/\\\\/g, '\\')
  }
}
