import type { PageData, Block } from './notion-client'

export interface AssetMetadata {
  id: string
  pageId: string
  blockId: string
  blockType: string
  field: string
  sourceType: 'file' | 'external'
  sourceUrl: string
  fileName: string | null
  signedUrlExpiresAt: number | null
  updatedAt: number
}

export function collectPageAssetMetadata(pageData: PageData): AssetMetadata[] {
  const assets: AssetMetadata[] = []

  const visit = (blocks: Block[]) => {
    for (const block of blocks) {
      const asset = getBlockAssetMetadata(pageData.page.id, block)
      if (asset) {
        assets.push(asset)
      }

      if (block._children?.length) {
        visit(block._children)
      }
    }
  }

  visit(pageData.blocks)
  return assets
}

export function getBlockAssetId(pageId: string, blockId: string, field: string): string {
  return `${normalizeId(pageId)}_${normalizeId(blockId)}_${field}`
}

export function getBlockAssetMetadata(pageId: string, block: Block): AssetMetadata | null {
  const blockAny = block as any
  switch (block.type) {
    case 'file':
      return buildAssetMetadata(pageId, block, 'file', blockAny.file, blockAny.file?.name || null)
    case 'pdf':
      return buildAssetMetadata(pageId, block, 'pdf', blockAny.pdf, blockAny.pdf?.name || null)
    case 'audio':
      return buildAssetMetadata(pageId, block, 'audio', blockAny.audio, blockAny.audio?.name || null)
    case 'video': {
      const url = getFileUrl(blockAny.video)
      if (blockAny.video?.type !== 'file' && !isDirectVideoFile(url)) {
        return null
      }
      return buildAssetMetadata(pageId, block, 'video', blockAny.video, blockAny.video?.name || null)
    }
    default:
      return null
  }
}

export function parseSignedUrlExpiry(url: string): number | null {
  try {
    const parsed = new URL(url)
    const xAmzDate = parsed.searchParams.get('X-Amz-Date')
    const expires = Number(parsed.searchParams.get('X-Amz-Expires') || '0')
    if (!xAmzDate || !expires) {
      return null
    }

    const isoDate = xAmzDate.replace(
      /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
      '$1-$2-$3T$4:$5:$6Z',
    )
    const issuedAt = Date.parse(isoDate)
    if (Number.isNaN(issuedAt)) {
      return null
    }

    return issuedAt + (expires * 1000)
  } catch {
    return null
  }
}

function buildAssetMetadata(
  pageId: string,
  block: Block,
  field: string,
  fileValue: any,
  fallbackName: string | null,
): AssetMetadata | null {
  const url = getFileUrl(fileValue)
  if (!url) {
    return null
  }

  const sourceType = fileValue?.type === 'external' ? 'external' : 'file'
  return {
    id: getBlockAssetId(pageId, block.id, field),
    pageId,
    blockId: block.id,
    blockType: block.type,
    field,
    sourceType,
    sourceUrl: url,
    fileName: fallbackName || inferFileName(url),
    signedUrlExpiresAt: sourceType === 'file' ? parseSignedUrlExpiry(url) : null,
    updatedAt: Date.now(),
  }
}

function getFileUrl(file: any): string {
  if (file?.type === 'external') return file.external?.url || ''
  if (file?.type === 'file') return file.file?.url || ''
  return ''
}

function inferFileName(url: string): string | null {
  try {
    const pathname = new URL(url).pathname
    return pathname.split('/').filter(Boolean).pop() || null
  } catch {
    return null
  }
}

function normalizeId(value: string): string {
  return value.replace(/-/g, '')
}

function isDirectVideoFile(url: string): boolean {
  return /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url)
}
