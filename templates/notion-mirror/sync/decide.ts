// Pure decision logic of the sync daemon, kept apart from I/O so it can be tested.

export interface RenderedPage {
  lastEdited: string | null
  title: string
}

export interface SyncState {
  /** Rendered version of every page in the site index, keyed by compact lowercase id. */
  pages: Record<string, RenderedPage>
  /** Page ids of the last published authoritative index (full run). */
  siteIds: string[]
  /** Europe/Madrid date (YYYY-MM-DD) of the last successful full run. */
  lastFullRunDate: string | null
  /** Epoch ms when the last successful full run started. */
  lastFullRunAt: number
  /** Epoch ms before which a failed full run is not retried. */
  fullRetryNotBefore: number
  consecutiveFailures: number
  alerting: boolean
  kvWrites: { date: string; count: number }
  /** Set when a partial run found a page outside the index: the next tick runs a full crawl. */
  fullRunRequested: boolean
}

export interface NotionPageInfo {
  id: string
  lastEdited: string | null
  title: string
  parentPageId: string | null
  removed: boolean
}

export type Decision =
  | { kind: 'idle'; deferred: string[] }
  | { kind: 'partial'; ids: string[]; deferred: string[] }
  | { kind: 'full'; reason: string }

export function emptyState(): SyncState {
  return {
    pages: {},
    siteIds: [],
    lastFullRunDate: null,
    lastFullRunAt: 0,
    fullRetryNotBefore: 0,
    consecutiveFailures: 0,
    alerting: false,
    kvWrites: { date: '', count: 0 },
    fullRunRequested: false,
  }
}

export function compactId(id: string): string {
  return id.replace(/-/g, '').toLowerCase()
}

export interface DecideOptions {
  now: number
  debounceMs: number
  madridDate: string
  madridHour: number
  fullRunHour: number
}

/**
 * Decide what one tick does. `notion` holds what Notion says about each page
 * (search results, plus a direct lookup for any index page search omitted).
 */
export function decide(state: SyncState, notion: Map<string, NotionPageInfo>, options: DecideOptions): Decision {
  const fullAllowed = options.now >= state.fullRetryNotBefore

  if (!state.siteIds.length) {
    return fullAllowed ? { kind: 'full', reason: 'no index yet (first run)' } : { kind: 'idle', deferred: [] }
  }
  if (fullAllowed && state.fullRunRequested) {
    return { kind: 'full', reason: 'a refreshed page links to a page outside the index' }
  }
  if (fullAllowed && options.madridHour >= options.fullRunHour && state.lastFullRunDate !== options.madridDate) {
    return { kind: 'full', reason: 'nightly full run' }
  }

  const siteSet = new Set(state.siteIds)
  const changed: string[] = []
  const deferred: string[] = []
  let structural: string | null = null

  for (const id of state.siteIds) {
    const info = notion.get(id)
    const rendered = state.pages[id]
    if (!info || info.removed) {
      structural ??= `page ${id} was removed or unshared`
      continue
    }
    if (rendered && info.title !== rendered.title) {
      structural ??= `page ${id} was renamed`
      continue
    }
    if (!rendered || isNewer(info.lastEdited, rendered.lastEdited)) {
      const editedAt = info.lastEdited ? Date.parse(info.lastEdited) : 0
      if (options.now - editedAt < options.debounceMs) {
        deferred.push(id)
      } else {
        changed.push(id)
      }
    }
  }

  for (const info of notion.values()) {
    // Only a child page edited after the last full crawl counts: one the crawl
    // already saw and left out (not renderable) must not trigger a crawl every tick.
    const editedAt = info.lastEdited ? Date.parse(info.lastEdited) : 0
    if (!info.removed && !siteSet.has(info.id) && info.parentPageId && siteSet.has(info.parentPageId)
      && editedAt >= state.lastFullRunAt && options.now - editedAt >= options.debounceMs) {
      structural ??= `new child page ${info.id}`
    }
  }

  if (structural) {
    return fullAllowed ? { kind: 'full', reason: structural } : { kind: 'idle', deferred }
  }
  if (changed.length) {
    return { kind: 'partial', ids: changed, deferred }
  }
  return { kind: 'idle', deferred }
}

function isNewer(candidate: string | null, rendered: string | null): boolean {
  if (!candidate) return false
  if (!rendered) return true
  return Date.parse(candidate) > Date.parse(rendered)
}

export interface WarmSummary {
  pages: number
  skipped: number
  failed: number
  indexPublished: boolean
  authoritative: boolean
  kvWrites: number
  kvSkipped: number
  notionFetches: number
  rendered: Record<string, RenderedPage>
  referenced: string[]
  indexPageIds: string[]
}

export function parseWarmSummary(output: string): WarmSummary | null {
  const line = output.split('\n').reverse().find((candidate) => candidate.startsWith('WARM_SUMMARY '))
  if (!line) return null
  try {
    return JSON.parse(line.slice('WARM_SUMMARY '.length)) as WarmSummary
  } catch {
    return null
  }
}

/** Apply a warm run's result to the state. Versions come from the render itself, never from a later poll. */
export function applyWarmResult(state: SyncState, summary: WarmSummary, kind: 'partial' | 'full', ok: boolean, madridDate: string, startedAt: number): void {
  for (const [id, page] of Object.entries(summary.rendered)) {
    state.pages[compactId(id)] = page
  }

  if (kind === 'full' && ok && summary.indexPublished) {
    state.siteIds = summary.indexPageIds.map(compactId)
    const keep = new Set(state.siteIds)
    for (const id of Object.keys(state.pages)) {
      if (!keep.has(id)) delete state.pages[id]
    }
    state.lastFullRunDate = madridDate
    state.lastFullRunAt = startedAt
    state.fullRunRequested = false
  }

  if (kind === 'partial') {
    const siteSet = new Set(state.siteIds)
    if (summary.referenced.some((id) => !siteSet.has(compactId(id)))) {
      state.fullRunRequested = true
    }
  }
}
