import { describe, expect, test } from 'bun:test'
import { handleSyncWrite } from '../src/sync-write'

function fakeEnv(secret?: string) {
  const store = new Map<string, string>()
  const kv = {
    put: async (k: string, v: string | ArrayBuffer) => { store.set(k, typeof v === "string" ? v : new TextDecoder().decode(v)) },
    delete: async (k: string) => { store.delete(k) },
    list: async ({ prefix }: { prefix: string }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true, cursor: '' }),
  }
  return { store, env: { PAGE_CACHE: kv, SYNC_WRITE_SECRET: secret } as any }
}

const req = (method: string, path: string, token?: string, body?: string) =>
  new Request(`https://mirror.example.com/_sync/kv/${path}`, { method, body, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-length': String(body.length) } : {}) } })

describe('sync write endpoint', () => {
  test('is invisible without the secret configured', async () => {
    const { env } = fakeEnv()
    expect((await handleSyncWrite(req('PUT', 'values/sitemap', 'x', '{}'), env, 'values/sitemap')).status).toBe(404)
  })

  test('rejects a wrong token', async () => {
    const { env, store } = fakeEnv('s3cret-value')
    expect((await handleSyncWrite(req('PUT', 'values/sitemap', 'wrong', '{}'), env, 'values/sitemap')).status).toBe(404)
    expect((await handleSyncWrite(req('PUT', 'values/sitemap', undefined, '{}'), env, 'values/sitemap')).status).toBe(404)
    expect(store.size).toBe(0)
  })

  test('writes, lists and deletes allowed keys', async () => {
    const { env, store } = fakeEnv('s3cret-value')
    const key = 'page:188230bb-b2ce-48d7-823c-e96b15391606'
    expect((await handleSyncWrite(req('PUT', `values/${encodeURIComponent(key)}`, 's3cret-value', '{"html":"x"}'), env, `values/${encodeURIComponent(key)}`)).status).toBe(200)
    expect(store.get(key)).toBe('{"html":"x"}')
    await handleSyncWrite(req('PUT', 'values/page-meta%3Aabc', 's3cret-value', '{}'), env, 'values/page-meta%3Aabc')
    const listed = await (await handleSyncWrite(req('GET', 'keys?prefix=page-meta%3A', 's3cret-value'), env, 'keys')).json() as any
    expect(listed.result).toEqual([{ name: 'page-meta:abc' }])
    expect((await handleSyncWrite(req('DELETE', 'values/page-meta%3Aabc', 's3cret-value'), env, 'values/page-meta%3Aabc')).status).toBe(200)
    expect(store.has('page-meta:abc')).toBe(false)
  })

  test('refuses keys outside the mirror', async () => {
    const { env } = fakeEnv('s3cret-value')
    expect((await handleSyncWrite(req('PUT', 'values/image%3Ax', 's3cret-value', '{}'), env, 'values/image%3Ax')).status).toBe(400)
    expect((await handleSyncWrite(req('GET', 'keys?prefix=', 's3cret-value'), env, 'keys')).status).toBe(400)
  })
})

describe('sync write endpoint limits', () => {
  test('bad key encoding is a 400, not a crash', async () => {
    const { env } = fakeEnv('s3cret-value')
    expect((await handleSyncWrite(req('PUT', 'values/%ZZ', 's3cret-value', '{}'), env, 'values/%ZZ')).status).toBe(400)
  })
})
