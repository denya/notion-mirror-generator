export function slugifyPageTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function pagePath(pageId: string, title?: string | null): string {
  const compactId = pageId.replace(/-/g, '')
  const slug = slugifyPageTitle(title || '')
  return slug ? `/${slug}-${compactId}` : `/${compactId}`
}

export function canonicalPagePath(pageId: string, title: string | null | undefined, rootPageId: string): string {
  const compactId = pageId.replace(/-/g, '')
  const compactRootId = rootPageId.replace(/-/g, '')

  if (compactId === compactRootId) {
    return '/'
  }

  return pagePath(compactId, title)
}

export function rewriteNotionPageUrl(url: string, workspaceSlug?: string): string | null {
  try {
    const parsed = new URL(url)
    const isNotionHost =
      parsed.hostname === 'www.notion.so' ||
      parsed.hostname === 'notion.so' ||
      parsed.hostname.endsWith('.notion.site')

    if (!isNotionHost) return null

    const segments = parsed.pathname.split('/').filter(Boolean)
    if (!segments.length) return null

    const notionSiteHostSlug = parsed.hostname.endsWith('.notion.site')
      ? parsed.hostname.replace(/\.notion\.site$/i, '')
      : ''

    if (workspaceSlug) {
      if (notionSiteHostSlug && notionSiteHostSlug !== workspaceSlug) {
        return null
      }

      if ((parsed.hostname === 'www.notion.so' || parsed.hostname === 'notion.so') && segments.length > 1 && segments[0] !== workspaceSlug) {
        return null
      }
    }

    const lastSegment = segments[segments.length - 1]
    const compactId = extractPageId(lastSegment)
    if (!compactId) return null
    if ((parsed.hostname === 'www.notion.so' || parsed.hostname === 'notion.so') && segments.length === 1) {
      const normalizedLastSegment = lastSegment.replace(/-/g, '').toLowerCase()
      if (normalizedLastSegment === compactId) {
        return null
      }
    }
    const rawTitle = lastSegment.slice(0, Math.max(0, lastSegment.length - 33))
    const title = rawTitle.replace(/-/g, ' ').trim()
    return pagePath(compactId, title)
  } catch {
    return null
  }
}

export function extractPageId(input: string): string | null {
  const compactInput = input.replace(/-/g, '')
  const match = compactInput.match(/([a-f0-9]{32})$/i)
  return match ? match[1].toLowerCase() : null
}
