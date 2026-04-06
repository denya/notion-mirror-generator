export function toProxiedAssetUrl(url: string): string {
  if (!url || !/^https?:\/\//i.test(url)) {
    return url
  }

  return `/_image/${encodeURIComponent(url)}`
}

export function toCachedDocumentUrl(assetId: string): string {
  if (!assetId) {
    return assetId
  }

  return `/_asset/${encodeURIComponent(assetId)}`
}

export function toSocialImageUrl(url: string): string {
  if (!url || !/^https?:\/\//i.test(url)) {
    return url
  }

  return `/_image/${encodeURIComponent(url)}?social=1`
}

export function fromCachedDocumentUrl(value: string, domain?: string): string | null {
  return fromProxiedUrl(value, '/_asset/', domain)
}

function fromProxiedUrl(value: string, prefix: string, domain?: string): string | null {
  if (!value) {
    return null
  }

  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      if (domain && url.hostname !== domain) {
        return null
      }

      if (!url.pathname.startsWith(prefix)) {
        return null
      }

      return decodeURIComponent(url.pathname.slice(prefix.length))
    } catch {
      return null
    }
  }

  if (!value.startsWith(prefix)) {
    return null
  }

  try {
    return decodeURIComponent(value.slice(prefix.length))
  } catch {
    return null
  }
}
