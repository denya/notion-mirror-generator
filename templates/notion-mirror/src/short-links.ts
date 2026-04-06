export type ShortLinkMap = Record<string, string>
export type ShortLinkRedirectStatus = 301 | 302 | 307

const DEFAULT_SHORT_LINK_REDIRECT_STATUS: ShortLinkRedirectStatus = 302
const ALLOWED_REDIRECT_STATUSES = new Set<ShortLinkRedirectStatus>([301, 302, 307])

export function normalizeShortLinkPath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed || trimmed === '/') {
    return '/'
  }

  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return normalized.replace(/\/+$/, '') || '/'
}

export function parseShortLinks(raw?: string): ShortLinkMap {
  if (!raw?.trim()) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw) as unknown

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.error('SHORT_LINKS_JSON must be a JSON object')
      return {}
    }

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([path, target]) => {
        if (typeof target !== 'string' || !target.trim()) {
          return []
        }

        return [[normalizeShortLinkPath(path), target.trim()]]
      }),
    )
  } catch (error) {
    console.error('Failed to parse SHORT_LINKS_JSON:', error)
    return {}
  }
}

export function parseShortLinkRedirectStatus(raw?: string): ShortLinkRedirectStatus {
  const parsed = Number.parseInt(raw ?? '', 10)
  return ALLOWED_REDIRECT_STATUSES.has(parsed as ShortLinkRedirectStatus)
    ? (parsed as ShortLinkRedirectStatus)
    : DEFAULT_SHORT_LINK_REDIRECT_STATUS
}

export function resolveShortLinkRedirect(requestUrl: string, shortLinks: ShortLinkMap): string | null {
  const url = new URL(requestUrl)
  const target = shortLinks[normalizeShortLinkPath(url.pathname)]

  if (!target) {
    return null
  }

  const redirectUrl = new URL(target, url)
  url.searchParams.forEach((value, key) => {
    redirectUrl.searchParams.append(key, value)
  })

  return redirectUrl.toString()
}
