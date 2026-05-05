import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalRedirectTarget, extractCanonicalPathFromHtml } from '../templates/notion-mirror/src/canonical-redirect'

test('canonicalRedirectTarget redirects duplicate page paths to the sitemap canonical path', () => {
  const canonicalPath = '/digital-nomad-residence-in-spain-2026-97dfbe479af04e8b94d269f07bf7e0a2'

  assert.equal(
    canonicalRedirectTarget('/97dfbe479af04e8b94d269f07bf7e0a2', canonicalPath),
    canonicalPath,
  )
  assert.equal(
    canonicalRedirectTarget('/old-title-97dfbe479af04e8b94d269f07bf7e0a2', canonicalPath),
    canonicalPath,
  )
  assert.equal(canonicalRedirectTarget(canonicalPath, canonicalPath), null)
})

test('canonicalRedirectTarget preserves manual refresh on non-root redirects', () => {
  assert.equal(
    canonicalRedirectTarget(
      '/97dfbe479af04e8b94d269f07bf7e0a2',
      '/digital-nomad-residence-in-spain-2026-97dfbe479af04e8b94d269f07bf7e0a2',
      true,
    ),
    '/digital-nomad-residence-in-spain-2026-97dfbe479af04e8b94d269f07bf7e0a2?refresh=1',
  )
  assert.equal(canonicalRedirectTarget('/root-id', '/', true), '/')
})

test('extractCanonicalPathFromHtml reads the rendered self-canonical URL', () => {
  const html = '<link rel="canonical" href="https://spain.denyamsk.ru/startup-visa-188230bbb2ce48d7823ce96b15391606">'

  assert.equal(
    extractCanonicalPathFromHtml(html, 'spain.denyamsk.ru'),
    '/startup-visa-188230bbb2ce48d7823ce96b15391606',
  )
  assert.equal(extractCanonicalPathFromHtml(html, 'other.example'), null)
})
