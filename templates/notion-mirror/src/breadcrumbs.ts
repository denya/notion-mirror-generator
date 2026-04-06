import type { SiteConfig } from './config'
import { canonicalPagePath } from './page-path'
import type { Breadcrumb } from './template'

export interface AncestorPage {
  id: string
  title: string
}

function normalizePageId(pageId: string): string {
  return pageId.replace(/-/g, '')
}

export function buildPageBreadcrumbs(
  config: SiteConfig,
  currentPageId: string,
  currentTitle: string,
  ancestors: AncestorPage[],
): Breadcrumb[] {
  if (normalizePageId(currentPageId) === normalizePageId(config.rootPageId)) {
    return []
  }

  return [
    ...ancestors.map((ancestor) => ({
      label: ancestor.title,
      href: canonicalPagePath(ancestor.id, ancestor.title, config.rootPageId),
    })),
    { label: currentTitle, href: null },
  ]
}
