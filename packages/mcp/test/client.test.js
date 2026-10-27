import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, EchoThreadClient, routes } from '../src/client.js'

// A client whose fetch is a stub, plus every request it made.
function clientWith(respond, { baseUrl = 'https://api.test/api/public/v1/', token = 'et_secret' } = {}) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return respond(String(url), init)
  }
  const client = new EchoThreadClient({ token, baseUrl, fetch, userAgent: 'echothread-mcp/0.1.0' })
  return { client, calls }
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('normalizes the base URL and sends the token only in the Authorization header', async () => {
  const { client, calls } = clientWith(() => json(200, { ok: true }))
  assert.deepEqual(await client.request('GET', '/sites/'), { ok: true })
  assert.equal(calls[0].url, 'https://api.test/api/public/v1/sites/')
  assert.equal(calls[0].url.includes('et_secret'), false)
  assert.equal(calls[0].init.headers.authorization, 'Bearer et_secret')
  assert.equal(calls[0].init.headers.accept, 'application/json')
  assert.equal(calls[0].init.headers['user-agent'], 'echothread-mcp/0.1.0')
  assert.equal(calls[0].init.headers['content-type'], undefined)
  assert.equal(calls[0].init.body, undefined)
})

test('adds query parameters and skips empty ones', async () => {
  const { client, calls } = clientWith(() => json(200, {}))
  await client.request('GET', '/comments', { query: { since: '2026-10-01T00:00:00Z', cursor: undefined, empty: '', nil: null } })
  const url = new URL(calls[0].url)
  assert.deepEqual(Object.fromEntries(url.searchParams), { since: '2026-10-01T00:00:00Z' })
  assert.equal(url.searchParams.has('cursor'), false)
})

test('encodes ids so a slash cannot escape the route', async () => {
  const { client, calls } = clientWith(() => json(200, {}))
  await routes.getComment(client, { comment_id: 'a/../b c' })
  assert.equal(calls[0].url, 'https://api.test/api/public/v1/comments/a%2F..%2Fb%20c')
  assert.equal(new URL(calls[0].url).pathname, '/api/public/v1/comments/a%2F..%2Fb%20c')
})

test('sends a JSON body and content-type only when there is a body', async () => {
  const { client, calls } = clientWith(() => json(200, { id: 'r1' }))
  await routes.reply(client, { comment_id: 'c1', body: 'Thanks!' })
  assert.equal(calls[0].init.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(calls[0].init.body), { body: 'Thanks!' })
})

test('a 204 with no body returns null', async () => {
  const { client } = clientWith(() => new Response(null, { status: 204 }))
  assert.equal(await client.request('POST', '/comments/c1/approve'), null)
})

test('an error carries the status, code and scope, and truncates a non-JSON body', async () => {
  const { client } = clientWith(() => new Response('<html>bad gateway</html>', { status: 502 }))
  await assert.rejects(client.request('GET', '/sites/'), (err) => {
    assert.ok(err instanceof ApiError)
    assert.equal(err.status, 502)
    assert.equal(err.code, undefined)
    assert.equal(err.message, '<html>bad gateway</html>')
    return true
  })

  const scoped = clientWith(() => json(403, { detail: 'Needs moderate', code: 'scope_required', scope: 'moderate' }))
  await assert.rejects(scoped.client.request('POST', '/comments/c1/approve'), (err) => {
    assert.equal(err.status, 403)
    assert.equal(err.code, 'scope_required')
    assert.equal(err.scope, 'moderate')
    assert.equal(err.message, 'Needs moderate')
    return true
  })
})

test('an error detail longer than 300 characters is not passed on whole', async () => {
  const { client } = clientWith(() => new Response('x'.repeat(500), { status: 500 }))
  await assert.rejects(client.request('GET', '/sites/'), (err) => {
    assert.equal(err.message.length, 300)
    return true
  })
})

test('a network failure is the original error, not an ApiError', async () => {
  const boom = new Error('ECONNRESET')
  const { client } = clientWith(() => { throw boom })
  await assert.rejects(client.request('GET', '/sites/'), (err) => err === boom)
})

test('the token is never put in the URL or an error message', async () => {
  const { client, calls } = clientWith(() => json(401, { detail: 'Invalid API token' }))
  await assert.rejects(client.request('GET', '/sites/'), (err) => {
    assert.doesNotMatch(err.message, /et_secret/)
    return true
  })
  assert.doesNotMatch(calls[0].url, /et_secret/)
})
