import { describe, expect, test } from 'bun:test'
import { applyWarmResult, decide, emptyState, parseWarmSummary, type NotionPageInfo, type SyncState, type WarmSummary } from '../sync/decide'

const NOW = Date.parse('2026-11-25T12:00:00Z')
const opts = { now: NOW, debounceMs: 3 * 60_000, madridDate: '2026-11-25', madridHour: 13, fullRunHour: 4 }

function state(overrides: Partial<SyncState> = {}): SyncState {
  return {
    ...emptyState(),
    siteIds: ['root', 'a', 'b'],
    pages: {
      root: { lastEdited: '2026-11-20T10:00:00.000Z', title: 'Root' },
      a: { lastEdited: '2026-11-20T10:00:00.000Z', title: 'A' },
      b: { lastEdited: '2026-11-20T10:00:00.000Z', title: 'B' },
    },
    lastFullRunDate: '2026-11-25',
    lastFullRunAt: Date.parse('2026-11-25T03:00:00Z'),
    ...overrides,
  }
}

function notion(changes: Record<string, Partial<NotionPageInfo>> = {}): Map<string, NotionPageInfo> {
  const base: Record<string, NotionPageInfo> = {
    root: { id: 'root', lastEdited: '2026-11-20T10:00:00.000Z', title: 'Root', parentPageId: null, removed: false },
    a: { id: 'a', lastEdited: '2026-11-20T10:00:00.000Z', title: 'A', parentPageId: 'root', removed: false },
    b: { id: 'b', lastEdited: '2026-11-20T10:00:00.000Z', title: 'B', parentPageId: 'root', removed: false },
  }
  for (const [id, change] of Object.entries(changes)) {
    base[id] = { ...(base[id] ?? { id, lastEdited: null, title: id, parentPageId: null, removed: false }), ...change }
  }
  return new Map(Object.entries(base))
}

describe('sync decide', () => {
  test('first run is a full run', () => {
    expect(decide(emptyState(), notion(), opts).kind).toBe('full')
  })

  test('nothing changed: idle, no Notion work', () => {
    expect(decide(state(), notion(), opts)).toEqual({ kind: 'idle', deferred: [] })
  })

  test('a content edit refreshes only that page', () => {
    const d = decide(state(), notion({ a: { lastEdited: '2026-11-25T11:00:00.000Z' } }), opts)
    expect(d).toEqual({ kind: 'partial', ids: ['a'], deferred: [] })
  })

  test('an edit younger than the debounce waits', () => {
    const d = decide(state(), notion({ a: { lastEdited: '2026-11-25T11:59:00.000Z' } }), opts)
    expect(d).toEqual({ kind: 'idle', deferred: ['a'] })
  })

  test('a rename triggers a full run', () => {
    expect(decide(state(), notion({ a: { title: 'A renamed' } }), opts).kind).toBe('full')
  })

  test('a removed page triggers a full run', () => {
    expect(decide(state(), notion({ b: { removed: true } }), opts).kind).toBe('full')
  })

  test('a new child page edited after the last full run triggers a full run', () => {
    const d = decide(state(), notion({ c: { parentPageId: 'a', lastEdited: '2026-11-25T11:00:00.000Z' } }), opts)
    expect(d.kind).toBe('full')
  })

  test('a child page the last full crawl already left out does not loop', () => {
    const d = decide(state(), notion({ c: { parentPageId: 'a', lastEdited: '2026-11-24T11:00:00.000Z' } }), opts)
    expect(d.kind).toBe('idle')
  })

  test('nightly slot runs once per Madrid day', () => {
    expect(decide(state({ lastFullRunDate: '2026-11-24' }), notion(), opts).kind).toBe('full')
    expect(decide(state({ lastFullRunDate: '2026-11-24' }), notion(), { ...opts, madridHour: 3 }).kind).toBe('idle')
  })

  test('a failed full run is not retried before its cooldown', () => {
    const s = state({ lastFullRunDate: '2026-11-24', fullRetryNotBefore: NOW + 60_000 })
    expect(decide(s, notion(), opts).kind).toBe('idle')
    // content edits still flow during the cooldown
    expect(decide(s, notion({ a: { lastEdited: '2026-11-25T11:00:00.000Z' } }), opts).kind).toBe('partial')
  })
})

describe('applyWarmResult', () => {
  const summary = (over: Partial<WarmSummary>): WarmSummary => ({
    pages: 1, skipped: 0, failed: 0, indexPublished: true, authoritative: false, kvWrites: 2, kvSkipped: 0, notionFetches: 5,
    rendered: {}, referenced: [], indexPageIds: [], ...over,
  })

  test('partial run records the rendered version, not the poll time', () => {
    const s = state()
    applyWarmResult(s, summary({ rendered: { a: { lastEdited: '2026-11-25T11:00:00.000Z', title: 'A' } } }), 'partial', true, '2026-11-25', NOW)
    expect(s.pages.a.lastEdited).toBe('2026-11-25T11:00:00.000Z')
    expect(s.fullRunRequested).toBe(false)
  })

  test('partial run that links to a page outside the index requests a full run', () => {
    const s = state()
    applyWarmResult(s, summary({ referenced: ['root', 'zzz'] }), 'partial', true, '2026-11-25', NOW)
    expect(s.fullRunRequested).toBe(true)
  })

  test('full run replaces the index and drops pages that left it', () => {
    const s = state({ lastFullRunDate: '2026-11-24' })
    applyWarmResult(s, summary({ authoritative: true, indexPageIds: ['root', 'a'], rendered: { root: { lastEdited: null, title: 'Root' }, a: { lastEdited: null, title: 'A' } } }), 'full', true, '2026-11-25', NOW)
    expect(s.siteIds).toEqual(['root', 'a'])
    expect(s.pages.b).toBeUndefined()
    expect(s.lastFullRunDate).toBe('2026-11-25')
  })

  test('a failed full run keeps the old index', () => {
    const s = state({ lastFullRunDate: '2026-11-24' })
    applyWarmResult(s, summary({ indexPublished: false, indexPageIds: ['root'] }), 'full', false, '2026-11-25', NOW)
    expect(s.siteIds).toEqual(['root', 'a', 'b'])
    expect(s.lastFullRunDate).toBe('2026-11-24')
  })

  test('parses the last WARM_SUMMARY line', () => {
    expect(parseWarmSummary('x\nWARM_SUMMARY {"pages":3}\n')?.pages).toBe(3)
    expect(parseWarmSummary('no summary')).toBeNull()
  })
})
