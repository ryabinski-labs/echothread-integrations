import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { EchoThreadClient } from '../src/client.js'
import { createServer } from '../src/server.js'

// fakeAPI answers like the public API for a token with the given scopes.
function fakeAPI({ scopes = ['read', 'moderate', 'reply', 'delete'], starter = true } = {}) {
  const calls = []
  const need = { approve: 'moderate', reject: 'moderate', spam: 'moderate', reply: 'reply', delete: 'delete' }
  const fetch = async (url, init) => {
    const u = new URL(url)
    calls.push({ method: init.method, path: u.pathname + u.search, headers: init.headers, body: init.body })
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    const action = u.pathname.match(/\/comments\/[^/]+\/(approve|reject|spam|reply|delete)$/)?.[1]
    if (action && !scopes.includes(need[action])) {
      return json(403, { detail: `This API token does not have the ${need[action]} scope.`, code: 'scope_required', scope: need[action] })
    }
    if (u.pathname.endsWith('/comments') && u.searchParams.has('since') && !starter) {
      return json(403, { detail: 'Your Hobby plan does not include this feature (webhooks_api). Starter includes it, from $5/month — upgrade at /pricing.', code: 'feature_required' })
    }
    if (action) return json(200, { id: 'c1', status: action })
    return json(200, { items: [{ id: 'x' }], next_cursor: null })
  }
  return { fetch, calls }
}

async function connect(api) {
  const client = new EchoThreadClient({ token: 'et_test', baseUrl: 'https://api.test/api/public/v1', fetch: api.fetch, userAgent: 'echothread-mcp/0.1.0' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const mcp = new Client({ name: 'test', version: '0' })
  await Promise.all([createServer(client).connect(a), mcp.connect(b)])
  return mcp
}

test('lists exactly the eleven tools', async () => {
  const mcp = await connect(fakeAPI())
  const { tools } = await mcp.listTools()
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'approve_comment', 'delete_comment', 'get_comment', 'get_thread', 'list_pending', 'list_recent_comments',
    'list_sites', 'mark_spam', 'reject_comment', 'reply_to_comment', 'site_stats',
  ])
  const del = tools.find((t) => t.name === 'delete_comment')
  assert.equal(del.annotations.destructiveHint, true)
  assert.equal(tools.find((t) => t.name === 'list_sites').annotations.readOnlyHint, true)
})

test('each tool calls the matching public API route with the token and user agent', async () => {
  const api = fakeAPI()
  const mcp = await connect(api)
  const cases = [
    ['list_sites', {}, 'GET /api/public/v1/sites/'],
    ['list_pending', { site_id: 's 1' }, 'GET /api/public/v1/sites/s%201/comments?status=pending'],
    ['list_recent_comments', { since: '2026-10-01T00:00:00Z' }, 'GET /api/public/v1/comments?since=2026-10-01T00%3A00%3A00Z'],
    ['get_comment', { comment_id: 'c1' }, 'GET /api/public/v1/comments/c1'],
    ['site_stats', { site_id: 's1' }, 'GET /api/public/v1/sites/s1/stats'],
    ['approve_comment', { comment_id: 'c1' }, 'POST /api/public/v1/comments/c1/approve'],
    ['reject_comment', { comment_id: 'c1' }, 'POST /api/public/v1/comments/c1/reject'],
    ['mark_spam', { comment_id: 'c1' }, 'POST /api/public/v1/comments/c1/spam'],
    ['reply_to_comment', { comment_id: 'c1', body: 'Thanks!' }, 'POST /api/public/v1/comments/c1/reply'],
    ['delete_comment', { comment_id: 'c1' }, 'POST /api/public/v1/comments/c1/delete'],
  ]
  for (const [name, args, want] of cases) {
    api.calls.length = 0
    const res = await mcp.callTool({ name, arguments: args })
    assert.ok(!res.isError, `${name}: ${res.content?.[0]?.text}`)
    const c = api.calls[0]
    assert.equal(`${c.method} ${c.path}`, want, name)
    assert.equal(c.headers.authorization, 'Bearer et_test')
    assert.equal(c.headers['user-agent'], 'echothread-mcp/0.1.0')
  }
  api.calls.length = 0
  await mcp.callTool({ name: 'reply_to_comment', arguments: { comment_id: 'c1', body: 'Thanks!' } })
  assert.deepEqual(JSON.parse(api.calls[0].body), { body: 'Thanks!' })
  api.calls.length = 0
  await mcp.callTool({ name: 'get_thread', arguments: { thread_id: 't1' } })
  assert.deepEqual(api.calls.map((c) => c.path), ['/api/public/v1/threads/t1', '/api/public/v1/threads/t1/comments'])
})

test('a read-only token gets "This token lacks the <scope> scope" from every write tool', async () => {
  const mcp = await connect(fakeAPI({ scopes: ['read'] }))
  for (const [name, scope] of [['approve_comment', 'moderate'], ['reject_comment', 'moderate'], ['mark_spam', 'moderate'],
    ['reply_to_comment', 'reply'], ['delete_comment', 'delete']]) {
    const args = name === 'reply_to_comment' ? { comment_id: 'c1', body: 'hi' } : { comment_id: 'c1' }
    const res = await mcp.callTool({ name, arguments: args })
    assert.equal(res.isError, true, name)
    assert.match(res.content[0].text, new RegExp(`^This token lacks the ${scope} scope`), name)
  }
})

test('a Hobby token gets the API feature_required message from list_recent_comments', async () => {
  const mcp = await connect(fakeAPI({ starter: false }))
  const res = await mcp.callTool({ name: 'list_recent_comments', arguments: { since: '2026-10-01T00:00:00Z' } })
  assert.equal(res.isError, true)
  assert.match(res.content[0].text, /does not include this feature.*\/pricing/)
})

test('a network failure is a tool error, not a crash', async () => {
  const client = new EchoThreadClient({ token: 't', fetch: async () => { throw new Error('ECONNRESET') } })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const mcp = new Client({ name: 't', version: '0' })
  await Promise.all([createServer(client).connect(a), mcp.connect(b)])
  const res = await mcp.callTool({ name: 'list_sites', arguments: {} })
  assert.equal(res.isError, true)
  assert.match(res.content[0].text, /Could not reach EchoThread: ECONNRESET/)
})

test('refuses to start without a token', () => {
  assert.throws(() => new EchoThreadClient({}), /ECHOTHREAD_API_TOKEN is not set/)
})
