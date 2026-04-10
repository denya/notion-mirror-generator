import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  localAssetsManifestPath,
  localImagesManifestPath,
  readJsonFile,
  resolveSiteKey,
  siteManifestPath,
  siteStaticRoot,
  type LocalBinaryAssetEntry,
  type LocalRouteEntry,
  type LocalSiteManifest,
} from './site-data'

const siteKey = resolveSiteKey()
const port = Number(process.env.PORT || '8788')
const staticRoot = siteStaticRoot(siteKey)
const siteManifest = await readJsonFile<LocalSiteManifest>(siteManifestPath(siteKey))

if (!siteManifest) {
  throw new Error(`No local backup found for "${siteKey}". Run "bun run backup" or "bun run backup:workspace" first.`)
}

const imageEntries = await readJsonFile<LocalBinaryAssetEntry[]>(localImagesManifestPath(siteKey)) || []
const assetEntries = await readJsonFile<LocalBinaryAssetEntry[]>(localAssetsManifestPath(siteKey)) || []
const assetByPath = new Map<string, LocalBinaryAssetEntry>()

for (const entry of [...imageEntries, ...assetEntries]) {
  assetByPath.set(entry.localPath, entry)
}

// Read root page HTML to extract the page shell (head + styles + header + footer)
const rootHtml = await readFile(join(staticRoot, 'index.html'), 'utf8')
const pageShell = extractPageShell(rootHtml)

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname === '/__backup/routes.json') {
      return Response.json(siteManifest.routes)
    }

    if (url.pathname === '/__toc') {
      return new Response(renderTocPage(siteManifest, pageShell), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }

    const asset = assetByPath.get(url.pathname)
    if (asset) {
      return new Response(Bun.file(join(staticRoot, asset.localPath.replace(/^\/+/, ''))), {
        headers: {
          'content-type': asset.contentType,
          'cache-control': 'no-cache',
        },
      })
    }

    const filePath = resolvePageFilePath(url.pathname)
    if (!(await fileExists(filePath))) {
      return new Response('Not found', { status: 404 })
    }

    // Inject __toc link into the footer of every served HTML page
    const contentType = inferContentType(filePath)
    if (contentType.includes('text/html')) {
      let html = await readFile(filePath, 'utf8')
      html = injectTocFooterLink(html)
      return new Response(html, {
        headers: { 'content-type': contentType, 'cache-control': 'no-cache' },
      })
    }

    return new Response(Bun.file(filePath), {
      headers: {
        'content-type': contentType,
        'cache-control': 'no-cache',
      },
    })
  },
})

console.log(`Local backup server for "${siteKey}" running at http://localhost:${server.port}`)
console.log(`Serving static mirror from ${staticRoot}`)
console.log('Available: /__toc (table of contents) | /__backup/routes.json')

function resolvePageFilePath(pathname: string): string {
  if (pathname === '/') {
    return join(staticRoot, 'index.html')
  }

  if (pathname.endsWith('.xml') || pathname.endsWith('.html') || pathname.endsWith('.json')) {
    return join(staticRoot, pathname.replace(/^\/+/, ''))
  }

  return join(staticRoot, pathname.replace(/^\/+/, ''), 'index.html')
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error: any) {
    return error?.code === 'ENOENT' ? false : Promise.reject(error)
  }
}

function inferContentType(path: string): string {
  if (path.endsWith('.xml')) return 'application/xml; charset=utf-8'
  if (path.endsWith('.json')) return 'application/json; charset=utf-8'
  return 'text/html; charset=utf-8'
}

// --- Footer link injection ---

function injectTocFooterLink(html: string): string {
  return html.replace(
    /<\/footer>/,
    `<p style="margin-top:4px;font-size:0.85em;color:var(--text-secondary,#6b6b6b)"><a href="/__toc" class="footer-link">Table of Contents</a></p></footer>`,
  )
}

// --- Page shell extraction ---

interface PageShell {
  beforeContent: string
  afterContent: string
}

function extractPageShell(html: string): PageShell {
  const contentStart = html.indexOf('<article class="page-content">')
  const contentEnd = html.indexOf('</article>')

  if (contentStart === -1 || contentEnd === -1) {
    return { beforeContent: html.split('</main>')[0] + '<main class="page-body" id="main-content">', afterContent: '</main>' + (html.split('</main>')[1] || '') }
  }

  const beforeContent = html.slice(0, contentStart + '<article class="page-content">'.length)
  const afterContent = html.slice(contentEnd)

  return { beforeContent, afterContent }
}

// --- TOC rendering ---

interface TocNode {
  pageId: string
  title: string
  path: string
  depth: number
  children: TocNode[]
}

function isPublicPage(pageId: string, routes: LocalRouteEntry[], rootPageId: string): boolean {
  const rootCompact = rootPageId.replace(/-/g, '')
  const compact = pageId.replace(/-/g, '')
  if (compact === rootCompact) return true

  const byId = new Map(routes.map((r) => [r.pageId.replace(/-/g, ''), r]))
  const seen = new Set<string>()
  let currentId: string | null = compact

  while (currentId && !seen.has(currentId)) {
    if (currentId === rootCompact) return true
    seen.add(currentId)
    const route = byId.get(currentId)
    currentId = route?.parentPageId?.replace(/-/g, '') ?? null
  }

  return false
}

function renderTocPage(manifest: LocalSiteManifest, shell: PageShell): string {
  const routes = manifest.routes
  const rootCompact = manifest.rootPageId.replace(/-/g, '')

  const publicRoutes: LocalRouteEntry[] = []
  const privateRoutes: LocalRouteEntry[] = []

  for (const route of routes) {
    if (isPublicPage(route.pageId, routes, manifest.rootPageId)) {
      publicRoutes.push(route)
    } else {
      privateRoutes.push(route)
    }
  }

  function buildTree(routeSet: LocalRouteEntry[]): { rootNode: TocNode | null; orphans: TocNode[] } {
    const nodeMap = new Map<string, TocNode>()
    const orphans: TocNode[] = []

    for (const route of routeSet) {
      const compact = route.pageId.replace(/-/g, '')
      nodeMap.set(compact, {
        pageId: route.pageId,
        title: route.title,
        path: route.path,
        depth: route.depth ?? 0,
        children: [],
      })
    }

    const rootNode = nodeMap.get(rootCompact) ?? null

    for (const route of routeSet) {
      const compact = route.pageId.replace(/-/g, '')
      if (compact === rootCompact) continue

      const node = nodeMap.get(compact)!
      const parentCompact = route.parentPageId?.replace(/-/g, '') ?? null
      const parentNode = parentCompact ? nodeMap.get(parentCompact) : null

      if (parentNode) {
        parentNode.children.push(node)
      } else if (rootNode) {
        rootNode.children.push(node)
      } else {
        orphans.push(node)
      }
    }

    return { rootNode, orphans }
  }

  function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function renderTree(nodes: TocNode[]): string {
    if (!nodes.length) return ''
    const sorted = [...nodes].sort((a, b) => a.title.localeCompare(b.title))
    const items = sorted.map((n) => {
      const link = `<li style="margin:6px 0"><a href="${esc(n.path)}" style="color:var(--link-color-internal,#ea580c);text-decoration:none">${esc(n.title)}</a>${renderTree(n.children)}</li>`
      return link
    }).join('\n')
    return `<ul style="list-style:none;padding-left:24px;margin:4px 0">${items}</ul>`
  }

  const publicTree = buildTree(publicRoutes)
  let publicHtml = ''
  if (publicTree.rootNode) {
    publicHtml = `<h2 style="margin-top:32px;font-size:1.25em">Public Pages</h2>
<p style="color:var(--text-secondary,#6b6b6b);font-size:0.9em;margin-bottom:12px">Reachable from the root page &mdash; these are deployed to Cloudflare.</p>
<div style="font-size:1.1em;font-weight:500;margin-bottom:4px"><a href="/" style="color:var(--text-color,#171717);text-decoration:none">${esc(publicTree.rootNode.title)}</a></div>
${renderTree(publicTree.rootNode.children)}
${publicTree.orphans.length ? renderTree(publicTree.orphans) : ''}`
  }

  let privateHtml = ''
  if (privateRoutes.length) {
    const privateTree = buildTree(privateRoutes)
    const allPrivateNodes = [...(privateTree.rootNode ? [privateTree.rootNode] : []), ...privateTree.orphans]

    privateHtml = `<h2 style="margin-top:40px;font-size:1.25em;color:var(--text-secondary,#6b6b6b)">Private / Workspace Pages</h2>
<p style="color:var(--text-secondary,#6b6b6b);font-size:0.9em;margin-bottom:12px">Accessible via integration but not linked from the root page. Local backup only.</p>
${renderTree(allPrivateNodes)}`
  }

  const metaHtml = `<p style="margin-top:40px;padding-top:16px;border-top:1px solid var(--border-color,#f0e0d3);color:var(--text-secondary,#6b6b6b);font-size:0.85em">${routes.length} pages total &middot; ${publicRoutes.length} public &middot; ${privateRoutes.length} private &middot; ${manifest.sourceMode} backup &middot; <a href="/__backup/routes.json" style="color:var(--link-color-internal,#ea580c)">routes.json</a></p>`

  let before = shell.beforeContent
  before = before.replace(/<title>[^<]*<\/title>/, `<title>Table of Contents | ${esc(manifest.domain)}</title>`)

  const headerReplacement = `<header class="page-header">
        <div class="page-title-row">
          <span class="page-icon">\uD83D\uDCDA</span>
          <h1 class="page-title">Table of Contents</h1>
        </div>
      </header>`
  before = before.replace(/<header class="page-header">[\s\S]*?<\/header>/, headerReplacement)
  before = before.replace(/<div class="page-cover">[\s\S]*?<\/div>/, '')

  const tocBody = `${publicHtml}${privateHtml}${metaHtml}`
  let after = shell.afterContent
  after = injectTocFooterLink(after)

  return `${before}\n${tocBody}\n${after}`
}
