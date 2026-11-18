import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const TEMPLATE_DIR = join(REPO_ROOT, 'templates/notion-mirror')

// Scripts that build the Worker Env from wrangler.toml and render pages with it.
const RENDERING_SCRIPTS = ['scripts/warm-cache.ts', 'scripts/backup-site.ts']

// The template files are EJS sources and the scripts run their work at import
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

function buildEnvBody(scriptSource, scriptPath) {
  const body = scriptSource.match(/\nfunction buildEnv\(\): Env \{\n([\s\S]*?)\n\}\n/)?.[1]
  assert.ok(body, `function buildEnv(): Env not found in ${scriptPath}`)
  return body
}

async function sharedEnvVarKeys() {
  const [configSource, wranglerSource] = await Promise.all([
    readFile(join(TEMPLATE_DIR, 'src/config.ts'), 'utf8'),
    readFile(join(TEMPLATE_DIR, 'wrangler.toml'), 'utf8'),
  ])
  const envKeys = envInterfaceKeys(configSource)
  const varKeys = wranglerVarKeys(wranglerSource)

  // Guard the parsers themselves: an empty intersection would pass vacuously.
  assert.ok(varKeys.has('GOOGLE_ANALYTICS_CONSENT_MODE'), 'wrangler [vars] parser missed GOOGLE_ANALYTICS_CONSENT_MODE')
  assert.ok(envKeys.has('GOOGLE_ANALYTICS_CONSENT_MODE'), 'Env parser missed GOOGLE_ANALYTICS_CONSENT_MODE')

  const shared = [...varKeys].filter((key) => envKeys.has(key)).sort()
  assert.ok(shared.length >= 10, `expected the shared Env/[vars] keys, got ${shared.join(', ')}`)
  return shared
}

for (const scriptPath of RENDERING_SCRIPTS) {
  test(`${scriptPath} buildEnv passes every Env key that wrangler.toml [vars] defines`, async () => {
    const required = await sharedEnvVarKeys()
    const body = buildEnvBody(await readFile(join(TEMPLATE_DIR, scriptPath), 'utf8'), scriptPath)

    // Pages are rendered with this Env and stored as final HTML, so a dropped key
    // silently changes the output (e.g. no consent banner without GOOGLE_ANALYTICS_CONSENT_MODE).
    const missing = required.filter((key) => !new RegExp(`^\\s*${key}:[^\\n]*\\bvars\\.${key}\\b`, 'm').test(body))
    assert.deepEqual(missing, [], `buildEnv() in ${scriptPath} does not read these [vars] keys: ${missing.join(', ')}`)
  })
}
