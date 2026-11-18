import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const TEMPLATE_DIR = join(REPO_ROOT, 'templates/notion-mirror')

// The template files are EJS sources and warm-cache.ts runs its warm at import
// time, so the check reads them as text instead of importing them.

function envInterfaceKeys(configSource) {
  const body = configSource.match(/export interface Env \{([\s\S]*?)\n\}/)?.[1]
  assert.ok(body, 'export interface Env not found in src/config.ts')
  return new Set([...body.matchAll(/^\s*([A-Z][A-Z0-9_]*)\??:/gm)].map((match) => match[1]))
}

function wranglerVarKeys(wranglerSource) {
  const section = wranglerSource.match(/^\[vars\]\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1]
  assert.ok(section, '[vars] section not found in wrangler.toml')
  return new Set([...section.matchAll(/^([A-Z][A-Z0-9_]*)\s*=/gm)].map((match) => match[1]))
}

function buildEnvBody(scriptSource) {
  const body = scriptSource.match(/\nfunction buildEnv\(\): Env \{\n([\s\S]*?)\n\}\n/)?.[1]
  assert.ok(body, 'function buildEnv(): Env not found in scripts/warm-cache.ts')
  return body
}

test('warm-cache buildEnv passes every Env key that wrangler.toml [vars] defines', async () => {
  const [configSource, wranglerSource, warmCacheSource] = await Promise.all([
    readFile(join(TEMPLATE_DIR, 'src/config.ts'), 'utf8'),
    readFile(join(TEMPLATE_DIR, 'wrangler.toml'), 'utf8'),
    readFile(join(TEMPLATE_DIR, 'scripts/warm-cache.ts'), 'utf8'),
  ])

  const envKeys = envInterfaceKeys(configSource)
  const varKeys = wranglerVarKeys(wranglerSource)
  const body = buildEnvBody(warmCacheSource)

  // Guard the parsers themselves: an empty intersection would pass vacuously.
  assert.ok(varKeys.has('GOOGLE_ANALYTICS_CONSENT_MODE'), 'wrangler [vars] parser missed GOOGLE_ANALYTICS_CONSENT_MODE')
  assert.ok(envKeys.has('GOOGLE_ANALYTICS_CONSENT_MODE'), 'Env parser missed GOOGLE_ANALYTICS_CONSENT_MODE')

  const required = [...varKeys].filter((key) => envKeys.has(key)).sort()
  assert.ok(required.length >= 10, `expected the shared Env/[vars] keys, got ${required.join(', ')}`)

  // Pages rendered by warm are cached as final HTML, so a dropped key silently
  // changes the live site (e.g. no consent banner without GOOGLE_ANALYTICS_CONSENT_MODE).
  const missing = required.filter((key) => !new RegExp(`^\\s*${key}:[^\\n]*\\bvars\\.${key}\\b`, 'm').test(body))
  assert.deepEqual(missing, [], `buildEnv() in scripts/warm-cache.ts does not read these [vars] keys: ${missing.join(', ')}`)
})
