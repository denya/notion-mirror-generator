import type { RichTextItem } from './notion-client'
import { rewriteNotionPageUrl } from './page-path'
import { toProxiedAssetUrl } from './asset-url'

export function renderRichText(richTexts: RichTextItem[], domain?: string, notionWorkspaceSlug?: string): string {
  return richTexts.map((item) => renderRichTextItem(item, domain, notionWorkspaceSlug)).join('')
}

function renderRichTextItem(item: RichTextItem, domain?: string, notionWorkspaceSlug?: string): string {
  let text = escapeHtml(item.plain_text).replace(/\n/g, '<br>')
  const pageIcon = renderPageReferenceIcon(item.pageIcon)

  const { annotations } = item
  if (annotations.code) text = `<code>${text}</code>`
  if (annotations.bold) text = `<strong>${text}</strong>`
  if (annotations.italic) text = `<em>${text}</em>`
  if (annotations.underline) text = `<u>${text}</u>`
  if (annotations.strikethrough) text = `<s>${text}</s>`

  if (annotations.color && annotations.color !== 'default') {
    const cls = colorToClass(annotations.color)
    text = `<span class="${cls}">${text}</span>`
  }

  if (item.type === 'mention') {
    text = renderMention(item, `${pageIcon}${text}`, domain, notionWorkspaceSlug)
  } else if (item.href) {
    const href = item.resolvedHref || rewriteNotionUrl(item.href, domain, notionWorkspaceSlug)
    const kind = href.startsWith('/') ? 'link-internal' : 'link-external'
    text = `<a class="link ${kind}${pageIcon ? ' link-with-icon' : ''}" href="${escapeAttr(href)}">${pageIcon}${text}</a>`
  }

  return text
}

function renderMention(item: RichTextItem, text: string, domain?: string, notionWorkspaceSlug?: string): string {
  const mentionType = item.mention?.type || 'generic'
  const cls = `mention mention-${mentionType}${item.pageIcon ? ' mention-with-icon' : ''}`

  if (item.href) {
    const href = item.resolvedHref || rewriteNotionUrl(item.href, domain, notionWorkspaceSlug)
    return `<a class="${cls}" href="${escapeAttr(href)}">${text}</a>`
  }

  if (mentionType === 'date') {
    return `<span class="${cls}">${text}</span>`
  }

  return `<span class="${cls}">${text}</span>`
}

function renderPageReferenceIcon(icon: string | null | undefined): string {
  if (!icon) {
    return ''
  }

  if (/^https?:\/\//i.test(icon)) {
    return `<img class="inline-page-icon inline-page-icon-image" src="${escapeAttr(toProxiedAssetUrl(icon))}" alt="">`
  }

  return `<span class="inline-page-icon" aria-hidden="true">${escapeHtml(icon)}</span>`
}

// Rewrite notion.so and *.notion.site URLs to our domain
function rewriteNotionUrl(url: string, domain?: string, notionWorkspaceSlug?: string): string {
  if (!domain) return url

  return rewriteNotionPageUrl(url, notionWorkspaceSlug) || url
}

function colorToClass(color: string): string {
  if (color.endsWith('_background')) {
    return `bg-${color.replace('_background', '')}`
  }
  return `text-${color}`
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function escapeAttr(str: string): string {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
