export function canonicalRedirectTarget(
  requestPath: string,
  canonicalPath: string,
  preserveRefresh = false,
): string | null {
  const normalizedRequestPath = requestPath || '/'
  const normalizedCanonicalPath = normalizePagePath(canonicalPath)

  if (normalizedRequestPath === normalizedCanonicalPath) {
    return null
  }

  return preserveRefresh && normalizedCanonicalPath !== '/'
    ? `${normalizedCanonicalPath}?refresh=1`
    : normalizedCanonicalPath
}

export function extractCanonicalPathFromHtml(html: string, domain: string): string | null {
  const escapedDomain = escapeRegExp(domain)
  const match = html.match(new RegExp(`<link\\s+rel=["']canonical["']\\s+href=["']https://${escapedDomain}([^"']*)["']`, 'i'))
  if (!match?.[1]) {
    return null
  }

  try {
    return normalizePagePath(new URL(match[1], `https://${domain}`).pathname)
  } catch {
    return null
  }
}

function normalizePagePath(path: string): string {
  if (!path || path === '/') {
    return '/'
  }

  return path.replace(/\/+$/, '') || '/'
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
