import type { Block } from './notion-client'
import { renderRichText, escapeHtml, escapeAttr } from './rich-text'
import { toCachedDocumentUrl, toProxiedAssetUrl } from './asset-url'
import { pagePath } from './page-path'
import { getBlockAssetId } from './document-assets'
import { getKnownOgMetadata, type OgMetadata } from './og-metadata'

export function renderBlocks(
  blocks: Block[],
  domain: string,
  notionWorkspaceSlug?: string,
  toggleDepth = 0,
  usedSlugs: Map<string, number> = new Map(),
  currentPageId?: string,
): string {
  let html = ''
  let i = 0

  while (i < blocks.length) {
    const block = blocks[i]

    // Group consecutive list items into <ul>/<ol>
    if (block.type === 'bulleted_list_item') {
      html += '<ul>'
      while (i < blocks.length && blocks[i].type === 'bulleted_list_item') {
        html += renderBlock(blocks[i] as Block, domain, notionWorkspaceSlug, toggleDepth, usedSlugs, currentPageId)
        i++
      }
      html += '</ul>'
      continue
    }

    if (block.type === 'numbered_list_item') {
      html += '<ol>'
      while (i < blocks.length && blocks[i].type === 'numbered_list_item') {
        html += renderBlock(blocks[i] as Block, domain, notionWorkspaceSlug, toggleDepth, usedSlugs, currentPageId)
        i++
      }
      html += '</ol>'
      continue
    }

    html += renderBlock(block, domain, notionWorkspaceSlug, toggleDepth, usedSlugs, currentPageId)
    i++
  }

  return html
}

function renderBlock(
  block: Block,
  domain: string,
  notionWorkspaceSlug?: string,
  toggleDepth = 0,
  usedSlugs: Map<string, number> = new Map(),
  currentPageId?: string,
): string {
  const children = block._children
    ? renderBlocks(block._children, domain, notionWorkspaceSlug, toggleDepth + 1, usedSlugs, currentPageId)
    : ''
  const rt = (richTexts: any[]) => renderRichText(richTexts, domain, notionWorkspaceSlug)
  const isTopLevelToggle = toggleDepth === 0
  const topLevelHeadingToggleOpen = isTopLevelToggle ? ' open' : ''

  switch (block.type) {
    case 'paragraph': {
      const text = rt(block.paragraph.rich_text)
      if (!text && !children) return '<p>&nbsp;</p>'
      return `<p>${text}</p>${children}`
    }

    case 'heading_1': {
      const text = rt(block.heading_1.rich_text)
      const id = uniqueSlug(slugify(block.heading_1.rich_text.map((t: any) => t.plain_text).join('')), usedSlugs)
      if (block.heading_1.is_toggleable) {
        return `<details class="toggle-heading"${topLevelHeadingToggleOpen} data-block-id="${escapeAttr(block.id)}"><summary><span class="toggle-heading-summary"><h1 id="${id}">${text}</h1></span></summary><div class="toggle-content">${children}</div></details>`
      }
      return `<h1 id="${id}">${text}</h1>${children}`
    }

    case 'heading_2': {
      const text = rt(block.heading_2.rich_text)
      const id = uniqueSlug(slugify(block.heading_2.rich_text.map((t: any) => t.plain_text).join('')), usedSlugs)
      if (block.heading_2.is_toggleable) {
        return `<details class="toggle-heading"${topLevelHeadingToggleOpen} data-block-id="${escapeAttr(block.id)}"><summary><span class="toggle-heading-summary"><h2 id="${id}">${text}</h2></span></summary><div class="toggle-content">${children}</div></details>`
      }
      return `<h2 id="${id}">${text}</h2>${children}`
    }

    case 'heading_3': {
      const text = rt(block.heading_3.rich_text)
      const id = uniqueSlug(slugify(block.heading_3.rich_text.map((t: any) => t.plain_text).join('')), usedSlugs)
      if (block.heading_3.is_toggleable) {
        return `<details class="toggle-heading" data-block-id="${escapeAttr(block.id)}"><summary><span class="toggle-heading-summary"><h3 id="${id}">${text}</h3></span></summary><div class="toggle-content">${children}</div></details>`
      }
      return `<h3 id="${id}">${text}</h3>${children}`
    }

    case 'bulleted_list_item': {
      const text = rt(block.bulleted_list_item.rich_text)
      return `<li>${text}${children}</li>`
    }

    case 'numbered_list_item': {
      const text = rt(block.numbered_list_item.rich_text)
      return `<li>${text}${children}</li>`
    }

    case 'to_do': {
      const text = rt(block.to_do.rich_text)
      const checked = block.to_do.checked ? ' checked' : ''
      const childHtml = children ? `<div class="to-do-children">${children}</div>` : ''
      return `<div class="to-do-block"><div class="to-do"><input type="checkbox"${checked} data-block-id="${escapeAttr(block.id)}" aria-label="Toggle checklist item"><span>${text}</span></div>${childHtml}</div>`
    }

    case 'toggle': {
      const text = rt(block.toggle.rich_text)
      return `<details class="toggle" data-block-id="${escapeAttr(block.id)}"><summary><span class="toggle-summary">${text}</span></summary><div class="toggle-content">${children}</div></details>`
    }

    case 'code': {
      const text = rt(block.code.rich_text)
      const lang = block.code.language || 'plain text'
      const caption = block.code.caption?.length
        ? `<figcaption>${rt(block.code.caption)}</figcaption>`
        : ''
      return `<figure class="code-block"><pre><code class="language-${escapeAttr(lang)}">${text}</code></pre>${caption}</figure>`
    }

    case 'quote': {
      const text = rt(block.quote.rich_text)
      return `<blockquote>${text}${children}</blockquote>`
    }

    case 'callout': {
      const text = rt(block.callout.rich_text)
      const icon = getCalloutIcon(block)
      const color = block.callout.color || 'default'
      const body = text ? `<div class="callout-text">${text}</div>` : ''
      return `<div class="callout callout-${color}"><span class="callout-icon">${icon}</span><div class="callout-content">${body}${children}</div></div>`
    }

    case 'image': {
      const url = getFileUrl(block.image)
      const caption = block.image.caption?.length
        ? `<figcaption>${rt(block.image.caption)}</figcaption>`
        : ''
      return `<figure class="image-block"><img src="${escapeAttr(toProxiedAssetUrl(url))}" alt="${block.image.caption?.map((cap: any) => cap.plain_text).join('') || ''}" loading="lazy">${caption}</figure>`
    }

    case 'video': {
      const url = getFileUrl(block.video)
      const embedUrl = embeddableUrl(url)
      if (embedUrl) {
        return `<div class="video-block"><iframe src="${escapeAttr(embedUrl)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen loading="lazy"></iframe></div>`
      }
      if (isDirectVideoFile(url)) {
        return `<div class="video-block"><video src="${escapeAttr(getRenderableFileUrl(block, 'video', block.video, currentPageId))}" controls></video></div>`
      }
      return renderExternalCard(url, escapeHtml(url), 'Video')
    }

    case 'embed': {
      const url = block.embed.url
      const embedUrl = embeddableUrl(url)
      if (embedUrl) {
        return `<div class="embed-block"><iframe src="${escapeAttr(embedUrl)}" frameborder="0" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>`
      }
      return renderExternalCard(url, '', 'Embed')
    }

    case 'bookmark': {
      const url = block.bookmark.url
      const caption = block.bookmark.caption?.length
        ? `<div class="bookmark-caption">${rt(block.bookmark.caption)}</div>`
        : ''
      return `${renderBookmarkCard(url, block.bookmark._ogMetadata)}${caption}`
    }

    case 'divider':
      return '<hr>'

    case 'table_of_contents':
      return '<nav class="toc" data-toc></nav>'

    case 'column_list':
      return `<div class="columns">${children}</div>`

    case 'column':
      return `<div class="column">${children}</div>`

    case 'table': {
      const hasColumnHeader = block.table.has_column_header
      const hasRowHeader = block.table.has_row_header
      return renderTable(block._children || [], hasColumnHeader, hasRowHeader, domain)
    }

    case 'child_page': {
      const title = (block as any).child_page?.title || 'Untitled'
      const icon = renderChildPageIcon((block as any).child_page_icon)
      return `<div class="child-page"><a href="${escapeAttr(pagePath(block.id, title))}">${icon}<span class="child-page-title">${escapeHtml(title)}</span></a></div>`
    }

    case 'link_to_page': {
      const pageId = (block as any).link_to_page?.page_id
      if (typeof pageId !== 'string' || !pageId) {
        return ''
      }

      const title = (block as any).link_to_page?.resolvedTitle || 'Linked page'
      const href = (block as any).link_to_page?.resolvedHref || pagePath(pageId, title)
      const icon = renderChildPageIcon((block as any).link_to_page?.resolvedIcon)
      return `<div class="child-page link-to-page"><a href="${escapeAttr(href)}">${icon}<span class="child-page-title">${escapeHtml(title)}</span></a></div>`
    }

    case 'child_database': {
      const title = (block as any).child_database?.title || 'Untitled Database'
      return `<div class="child-database">📊 ${escapeHtml(title)}</div>`
    }

    case 'synced_block':
      return children

    case 'link_preview': {
      const url = (block as any).link_preview?.url || ''
      return renderBookmarkCard(url, (block as any).link_preview?._ogMetadata)
    }

    case 'equation': {
      const expr = (block as any).equation?.expression || ''
      return `<div class="equation">${escapeHtml(expr)}</div>`
    }

    case 'breadcrumb':
      return ''

    case 'file': {
      const url = getRenderableFileUrl(block, 'file', block.file, currentPageId)
      const name = (block.file as any).name || 'Download file'
      return `<div class="file-block"><a href="${escapeAttr(url)}" target="_blank" rel="noopener">📎 ${escapeHtml(name)}</a></div>`
    }

    case 'pdf': {
      const url = getRenderableFileUrl(block, 'pdf', block.pdf, currentPageId)
      return `<div class="pdf-block"><iframe src="${escapeAttr(url)}" frameborder="0" loading="lazy"></iframe></div>`
    }

    case 'audio': {
      const url = getRenderableFileUrl(block, 'audio', block.audio, currentPageId)
      return `<div class="audio-block"><audio src="${escapeAttr(url)}" controls></audio></div>`
    }

    default:
      return `<!-- unsupported block type: ${block.type} -->`
  }
}

function getCalloutIcon(block: any): string {
  const icon = block.callout?.icon
  if (!icon) return '💡'
  if (icon.type === 'emoji') return icon.emoji
  if (icon.type === 'external') return `<img src="${escapeAttr(toProxiedAssetUrl(icon.external.url))}" class="icon" alt="">`
  if (icon.type === 'file') return `<img src="${escapeAttr(toProxiedAssetUrl(icon.file.url))}" class="icon" alt="">`
  return '💡'
}

function getFileUrl(file: any): string {
  if (file.type === 'external') return file.external.url
  if (file.type === 'file') return file.file.url
  return ''
}

function getRenderableFileUrl(block: Block, field: string, file: any, currentPageId?: string): string {
  const url = getFileUrl(file)
  if (file?.type !== 'file') {
    return url
  }

  return toCachedDocumentUrl(getBlockAssetId(currentPageId || block.id, block.id, field))
}

function renderTable(rows: Block[], hasColumnHeader: boolean, hasRowHeader: boolean, domain: string): string {
  let html = '<div class="table-block"><table>'
  rows.forEach((row, i) => {
    const cells = (row as any).table_row?.cells || []
    const isHeaderRow = hasColumnHeader && i === 0
    html += '<tr>'
    cells.forEach((cell: any[], j: number) => {
      const isHeaderCell = isHeaderRow || (hasRowHeader && j === 0)
      const tag = isHeaderCell ? 'th' : 'td'
      const text = cell.map((item: any) => renderRichText([item], domain)).join('')
      html += `<${tag}>${text}</${tag}>`
    })
    html += '</tr>'
  })
  html += '</table></div>'
  return html
}

function youtubeEmbed(url: string): string {
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/)|youtu\.be\/|youtube-nocookie\.com\/embed\/)([a-zA-Z0-9_-]+)/)
  if (match) return `https://www.youtube-nocookie.com/embed/${match[1]}`
  return url
}

function isDirectVideoFile(url: string): boolean {
  return /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url)
}

function embeddableUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')

    if (host === 'youtube.com' || host === 'youtu.be') {
      return youtubeEmbed(url)
    }

    if (host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      return youtubeEmbed(url)
    }

    if (host === 'vimeo.com') {
      const match = parsed.pathname.match(/\/(\d+)/)
      return match ? `https://player.vimeo.com/video/${match[1]}` : null
    }

    if (host === 'loom.com') {
      const match = parsed.pathname.match(/\/share\/([a-zA-Z0-9]+)/)
      return match ? `https://www.loom.com/embed/${match[1]}` : null
    }

    if (host.includes('google.') && parsed.pathname.startsWith('/maps')) {
      const params = new URLSearchParams(parsed.search)
      if (!params.has('output')) {
        params.set('output', 'embed')
      }
      const search = params.toString()
      return `${parsed.origin}${parsed.pathname}${search ? `?${search}` : ''}`
    }

    return null
  } catch {
    return null
  }
}

function renderExternalCard(url: string, titleHtml: string, kicker: string): string {
  const safeTitle = titleHtml || escapeHtml(url)
  let hostname = url

  try {
    hostname = new URL(url).hostname.replace(/^www\./, '')
  } catch {}

  return `<a class="link-card" href="${escapeAttr(url)}" target="_blank" rel="noopener"><span class="link-card-kicker">${escapeHtml(kicker)}</span><span class="link-card-title">${safeTitle}</span><span class="link-card-url">${escapeHtml(hostname)}</span></a>`
}

function renderBookmarkCard(url: string, og?: OgMetadata | null): string {
  const fallbackOg = getKnownOgMetadata(url)
  const effectiveOg = og && (og.title || og.description || og.image)
    ? og
    : fallbackOg

  if (!effectiveOg || (!effectiveOg.title && !effectiveOg.description)) {
    return renderExternalCard(url, escapeHtml(url), 'Link')
  }

  let hostname = url
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '')
  } catch {}

  const titleHtml = effectiveOg.title
    ? `<div class="bookmark-card-title">${escapeHtml(effectiveOg.title)}</div>`
    : ''
  const descriptionHtml = effectiveOg.description
    ? `<div class="bookmark-card-description">${escapeHtml(effectiveOg.description)}</div>`
    : ''
  const faviconHtml = effectiveOg.favicon
    ? `<img class="bookmark-card-favicon" src="${escapeAttr(effectiveOg.favicon)}" alt="" loading="lazy" onerror="this.style.display='none'">`
    : ''
  const imageHtml = effectiveOg.image
    ? `<div class="bookmark-card-cover"><img src="${escapeAttr(effectiveOg.image)}" alt="" loading="lazy"></div>`
    : ''

  return `<a class="bookmark-card" href="${escapeAttr(url)}" target="_blank" rel="noopener"><div class="bookmark-card-info">${titleHtml}${descriptionHtml}<div class="bookmark-card-url">${faviconHtml}<span>${escapeHtml(hostname)}</span></div></div>${imageHtml}</a>`
}

function renderChildPageIcon(icon: string | null | undefined): string {
  if (!icon) {
    return '<span class="child-page-icon" aria-hidden="true">📄</span>'
  }

  if (/^https?:\/\//i.test(icon)) {
    return `<img class="child-page-icon child-page-icon-image" src="${escapeAttr(toProxiedAssetUrl(icon))}" alt="">`
  }

  return `<span class="child-page-icon" aria-hidden="true">${icon}</span>`
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

function uniqueSlug(base: string, used: Map<string, number>): string {
  const slug = base || 'section'
  const count = used.get(slug) || 0
  used.set(slug, count + 1)
  return count === 0 ? slug : `${slug}-${count + 1}`
}
