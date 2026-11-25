// Docker HEALTHCHECK: the daemon writes a heartbeat at the start and end of every
// tick; a full run may take up to RUN_TIMEOUT_MIN. Older than that plus one
// interval and a margin means the loop is dead or hung.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const stateDir = process.env.STATE_DIR || join(import.meta.dir, '..', '.cache', 'sync')
const limitMs = (Number(process.env.SYNC_INTERVAL_MIN || 15) + Number(process.env.RUN_TIMEOUT_MIN || 60) + 15) * 60_000
try {
  const age = Date.now() - Number(readFileSync(join(stateDir, 'heartbeat'), 'utf8'))
  if (age > limitMs) {
    console.error(`heartbeat is ${Math.round(age / 60000)} min old`)
    process.exit(1)
  }
} catch (error: any) {
  console.error(`no heartbeat: ${error?.message || error}`)
  process.exit(1)
}
