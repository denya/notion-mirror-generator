// Notion → KV sync daemon for this mirror (runs as a container, e.g. on Coolify).
//
// Every SYNC_INTERVAL_MIN minutes: one Notion search; pages edited since their
// last render are re-rendered with warm-cache (--no-crawl); a rename, a new or
// removed page, or the nightly slot runs a full authoritative crawl. The
// Worker itself no longer re-renders (LIVE_REFRESH=false in wrangler.toml).
//
//   bun run sync/daemon.ts            run forever
//   bun run sync/daemon.ts --once     one tick, then exit (exit 1 on failure)
//   bun run sync/daemon.ts --dry-run  poll and print the decision, no warm run

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPageTitle, type Page } from '../src/notion-client'
import { readWranglerVars } from '../scripts/site-data'
import {
  applyWarmResult,
  compactId,
  decide,
  emptyState,
  parseWarmSummary,
  type Decision,
  type NotionPageInfo,
  type SyncState,
} from './decide'

const env = process.env
const NOTION_API_KEY = required('NOTION_API_KEY')
const INTERVAL_MS = minutes(env.SYNC_INTERVAL_MIN, 15)
const DEBOUNCE_MS = minutes(env.DEBOUNCE_MIN, 3)
const FULL_RUN_HOUR = Number(env.FULL_RUN_HOUR ?? '4')
const FULL_RUN_TZ = env.FULL_RUN_TZ || 'Europe/Madrid'
const FULL_RETRY_MS = minutes(env.FULL_RETRY_MIN, 60)
const RUN_TIMEOUT_MS = minutes(env.RUN_TIMEOUT_MIN, 60)
const KV_DAILY_BUDGET = Number(env.KV_DAILY_BUDGET || '900')
const KV_ALERT_AT = Number(env.KV_ALERT_AT || '700')
const FAILURE_ALERT_AFTER = Number(env.FAILURE_ALERT_AFTER || '3')
const STATE_DIR = env.STATE_DIR || join(import.meta.dir, '..', '.cache', 'sync')
const WARM_CACHE_ROOT = env.WARM_CACHE_ROOT || join(import.meta.dir, '..', '.cache', 'warm-cache')
const STATE_PATH = join(STATE_DIR, 'sync-state.json')
const HEARTBEAT_PATH = join(STATE_DIR, 'heartbeat')
const SITE_LABEL = env.SITE_LABEL || env.SITE_DOMAIN || readWranglerVars().SITE_DOMAIN || 'notion mirror'
const once = process.argv.includes('--once')
const dryRun = process.argv.includes('--dry-run')

mkdirSync(STATE_DIR, { recursive: true })

if (once || dryRun) {
  const ok = await tick()
  process.exit(ok ? 0 : 1)
}

log(`daemon started: every ${INTERVAL_MS / 60000} min, full run from ${FULL_RUN_HOUR}:00 ${FULL_RUN_TZ}, KV budget ${KV_DAILY_BUDGET}/day`)
for (;;) {
  const started = Date.now()
  await tick()
  const wait = Math.max(INTERVAL_MS - (Date.now() - started), 60_000)
  await Bun.sleep(wait)
}

async function tick(): Promise<boolean> {
  heartbeat()
  const state = loadState()
  const now = Date.now()
  const { date: madridDate, hour: madridHour } = madridClock(now)
  const utcDate = new Date(now).toISOString().slice(0, 10)
  state.kvWrites = readKvDaily(utcDate)

  let decision: Decision
  try {
    const notion = await readNotionPages(state)
    decision = decide(state, notion, { now, debounceMs: DEBOUNCE_MS, madridDate, madridHour, fullRunHour: FULL_RUN_HOUR })
  } catch (error: any) {
    return await recordFailure(state, `Notion poll failed: ${error?.message || error}`, false)
  }

  if (decision.kind === 'idle') {
    log(`poll ok: no change${decision.deferred.length ? `, waiting for edits to settle: ${decision.deferred.join(', ')}` : ''}${state.fullRetryNotBefore > now ? ', full run pending after a failure' : ''}`)
    await recordSuccess(state, now)
    return true
  }

  log(decision.kind === 'full' ? `full run: ${decision.reason}` : `refresh ${decision.ids.length} page(s): ${decision.ids.join(', ')}`)
  if (dryRun) {
    return true
  }

  const remainingBudget = KV_DAILY_BUDGET - state.kvWrites.count
  if (remainingBudget <= 0) {
    return await recordFailure(state, `KV write budget for ${utcDate} is spent (${state.kvWrites.count}/${KV_DAILY_BUDGET}); refresh postponed to the next UTC day`, false)
  }

  const kind = decision.kind
  const args = kind === 'full' ? ['--refresh-notion'] : ['--refresh-notion', '--no-crawl', ...decision.ids]
  const before = state.kvWrites.count
  const result = await runWarm(args)
  const summary = parseWarmSummary(result.output)
  const ok = result.exitCode === 0 && summary !== null
  // warm-cache counts every write in the shared daily file, also when it dies.
  state.kvWrites = readKvDaily(utcDate)

  if (summary) {
    applyWarmResult(state, summary, kind, ok, madridDate, now)
    log(`warm ${ok ? 'ok' : 'FAILED'}: pages=${summary.pages} failed=${summary.failed} kvWrites=${summary.kvWrites} kvSkipped=${summary.kvSkipped} notion=${summary.notionFetches} (KV today ${state.kvWrites.count})`)
  }
  if (before < KV_ALERT_AT && state.kvWrites.count >= KV_ALERT_AT) {
    await notify(`KV writes today reached ${state.kvWrites.count} of the 1,000 free-plan limit (budget ${KV_DAILY_BUDGET}).`)
  }

  if (!ok) {
    const reason = result.timedOut
      ? `warm-cache timed out after ${RUN_TIMEOUT_MS / 60000} min`
      : `warm-cache exited ${result.exitCode}${summary ? ` (${summary.failed} page(s) failed)` : ' without a summary'}: ${lastLines(result.output, 6)}`
    if (kind === 'full') {
      state.fullRetryNotBefore = now + FULL_RETRY_MS
    }
    return await recordFailure(state, `${kind === 'full' ? 'Full' : 'Partial'} refresh failed: ${reason}`, kind === 'full')
  }

  if (kind === 'full') {
    state.fullRetryNotBefore = 0
  }
  await recordSuccess(state, now)
  return true
}

async function readNotionPages(state: SyncState): Promise<Map<string, NotionPageInfo>> {
  const pages = new Map<string, NotionPageInfo>()
  let cursor: string | undefined
  do {
    const payload: any = await notionRequest('POST', '/search', {
      filter: { property: 'object', value: 'page' },
      sort: { timestamp: 'last_edited_time', direction: 'descending' },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    for (const page of payload.results || []) {
      const info = toPageInfo(page)
      pages.set(info.id, info)
    }
    cursor = payload.has_more ? payload.next_cursor : undefined
  } while (cursor)

  // Search may omit a page (index lag, coverage): ask for each missing index page directly.
  for (const id of state.siteIds) {
    if (pages.has(id)) continue
    try {
      pages.set(id, toPageInfo(await notionRequest('GET', `/pages/${id}`)))
    } catch (error: any) {
      if (error?.status === 404 || error?.status === 403) {
        pages.set(id, { id, lastEdited: null, title: '', parentPageId: null, removed: true })
      } else {
        throw error
      }
    }
  }
  return pages
}

function toPageInfo(page: any): NotionPageInfo {
  return {
    id: compactId(page.id),
    lastEdited: page.last_edited_time || null,
    title: getPageTitle(page as Page),
    parentPageId: page.parent?.type === 'page_id' && page.parent.page_id ? compactId(page.parent.page_id) : null,
    removed: Boolean(page.archived || page.in_trash),
  }
}

async function notionRequest(method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
  for (let attempt = 1; ; attempt += 1) {
    let response: Response
    try {
      response = await fetch(`https://api.notion.com/v1${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30_000),
      })
    } catch (error) {
      if (attempt >= 5) throw error
      await Bun.sleep(1000 * 2 ** attempt)
      continue
    }
    if (response.ok) {
      return response.json()
    }
    const text = await response.text()
    if ((response.status === 429 || response.status >= 500) && attempt < 5) {
      const retryAfter = Number(response.headers.get('Retry-After'))
      await Bun.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt)
      continue
    }
    throw Object.assign(new Error(`Notion ${method} ${path}: ${response.status} ${text.slice(0, 200)}`), { status: response.status })
  }
}

async function runWarm(args: string[]): Promise<{ exitCode: number; output: string; timedOut: boolean }> {
  const proc = Bun.spawn(['bun', 'run', join(import.meta.dir, '..', 'scripts', 'warm-cache.ts'), ...args], {
    cwd: join(import.meta.dir, '..'),
    env: { ...process.env, KV_DAILY_BUDGET: String(KV_DAILY_BUDGET) },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, RUN_TIMEOUT_MS)
  const [stdout, stderr] = await Promise.all([
    streamLines(proc.stdout, 'warm'),
    streamLines(proc.stderr, 'warm!'),
  ])
  const exitCode = await proc.exited
  clearTimeout(timer)
  return { exitCode: timedOut ? 124 : exitCode, output: `${stdout}\n${stderr}`, timedOut }
}

async function streamLines(stream: ReadableStream<Uint8Array>, prefix: string): Promise<string> {
  let all = ''
  let pending = ''
  const decoder = new TextDecoder()
  for await (const chunk of stream) {
    const text = decoder.decode(chunk, { stream: true })
    all += text
    pending += text
    const lines = pending.split('\n')
    pending = lines.pop() || ''
    for (const line of lines) {
      if (line && !line.startsWith('WARM_SUMMARY ')) console.log(`  ${prefix} ${line}`)
    }
  }
  if (pending && !pending.startsWith('WARM_SUMMARY ')) console.log(`  ${prefix} ${pending}`)
  return all
}

async function recordSuccess(state: SyncState, now: number): Promise<void> {
  // While a failed full run waits for its retry, the failure is not over:
  // idle polls and partial refreshes neither reset it nor announce recovery.
  if (state.fullRetryNotBefore > 0) {
    saveState(state)
    heartbeat()
    return
  }
  if (state.alerting && await notify('Recovered: Notion sync works again.')) {
    state.alerting = false
  }
  if (!state.alerting) {
    state.consecutiveFailures = 0
  }
  saveState(state)
  heartbeat()
  void now
}

async function recordFailure(state: SyncState, message: string, alertNow: boolean): Promise<false> {
  state.consecutiveFailures += 1
  log(`FAILURE ${state.consecutiveFailures}: ${message}`)
  if ((alertNow || state.consecutiveFailures >= FAILURE_ALERT_AFTER) && !state.alerting) {
    // Only a delivered alert silences the next ones; an undelivered one is retried next tick.
    state.alerting = await notify(`${message}\n(failures in a row: ${state.consecutiveFailures}; the site keeps serving its last copy)`)
  }
  saveState(state)
  heartbeat()
  return false
}

async function notify(text: string): Promise<boolean> {
  const token = env.TELEGRAM_TOKEN
  const chatId = env.TELEGRAM_CHAT_ID
  if (!token || !chatId) {
    log(`(no Telegram configured) ALERT: ${text}`)
    return false
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: `${SITE_LABEL} sync: ${text}`, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      log(`Telegram alert failed: ${response.status}`)
      return false
    }
    return true
  } catch (error: any) {
    log(`Telegram alert failed: ${error?.message || error}`)
    return false
  }
}

function readKvDaily(utcDate: string): { date: string; count: number } {
  try {
    const parsed = JSON.parse(readFileSync(join(WARM_CACHE_ROOT, 'kv-writes-daily.json'), 'utf8'))
    if (parsed.date === utcDate) return parsed
  } catch {}
  return { date: utcDate, count: 0 }
}

function loadState(): SyncState {
  if (!existsSync(STATE_PATH)) return emptyState()
  return { ...emptyState(), ...JSON.parse(readFileSync(STATE_PATH, 'utf8')) }
}

function saveState(state: SyncState): void {
  if (dryRun) return
  const temp = `${STATE_PATH}.tmp`
  writeFileSync(temp, JSON.stringify(state, null, 2))
  renameSync(temp, STATE_PATH)
}

function heartbeat(): void {
  writeFileSync(HEARTBEAT_PATH, String(Date.now()))
}

function madridClock(now: number): { date: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: FULL_RUN_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(now))
      .map((part) => [part.type, part.value]),
  )
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) }
}

function lastLines(text: string, count: number): string {
  return text.trim().split('\n').filter((line) => !line.startsWith('WARM_SUMMARY ')).slice(-count).join(' | ').slice(0, 800)
}

function minutes(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return (Number.isFinite(parsed) && parsed > 0 ? parsed : fallback) * 60_000
}

function required(name: string): string {
  const value = env[name]
  if (!value) throw new Error(`${name} must be set`)
  return value
}

function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`)
}

