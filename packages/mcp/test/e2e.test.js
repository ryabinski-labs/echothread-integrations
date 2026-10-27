import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

// End to end: spawn the real stdio entry point against a local HTTP API and
// talk to it with the MCP client, the way an MCP host does.

function mockApi() {
  const calls = []
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const chunks = []
    for await (const c of req) chunks.push(c)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined
    calls.push({ method: req.method, path: url.pathname + url.search, headers: req.headers, body })
    const send = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    }
    if (req.headers.authorization !== 'Bearer et_test') return send(401, { detail: 'Invalid API token' })
    if (url.pathname.endsWith('/comments') && url.searchParams.has('since')) return send(403, { detail: 'Your Hobby plan does not include this feature.', code: 'feature_required' })
    const action = url.pathname.match(/\/comments\/[^/]+\/(approve|reject|spam|reply|delete)$/)?.[1]
    if (action === 'delete') return send(403, { detail: 'This API token does not have the delete scope.', code: 'scope_required', scope: 'delete' })
    if (action) return send(200, { id: 'c1', status: action })
    if (url.pathname.endsWith('/threads/t1')) return send(200, { id: 't1' })
    return send(200, { items: [{ id: 'x' }], next_cursor: null })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, port: server.address().port })))
}

async function connect(api, token = 'et_test') {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../src/index.js', import.meta.url))],
    env: { ...process.env, ECHOTHREAD_API_TOKEN: token, ECHOTHREAD_API_URL: `http://127.0.0.1:${api.port}/api/public/v1` },
    stderr: 'pipe',
  })
  const client = new Client({ name: 'e2e', version: '0' })
  await client.connect(transport)
  return client
}

test('e2e: the real stdio server lists and calls tools against the API', async () => {
  const api = await mockApi()
  const client = await connect(api)
  try {
    const { tools } = await client.listTools()
    assert.equal(tools.length, 11)
    const approve = tools.find((t) => t.name === 'approve_comment')
    assert.deepEqual(approve.inputSchema.required, ['comment_id'])

    const list = await client.callTool({ name: 'list_sites', arguments: {} })
    assert.ok(!list.isError)
    assert.equal(api.calls[0].method, 'GET')
    assert.equal(api.calls[0].path, '/api/public/v1/sites/')
    assert.equal(api.calls[0].headers.authorization, 'Bearer et_test')

    api.calls.length = 0
    await client.callTool({ name: 'list_pending', arguments: { site_id: 's 1/../2' } })
    assert.equal(api.calls[0].path, '/api/public/v1/sites/s%201%2F..%2F2/comments?status=pending')

    api.calls.length = 0
    const reply = await client.callTool({ name: 'reply_to_comment', arguments: { comment_id: 'c1', body: 'Thanks!' } })
    assert.ok(!reply.isError)
    assert.deepEqual(api.calls[0].body, { body: 'Thanks!' })

    api.calls.length = 0
    const recent = await client.callTool({ name: 'list_recent_comments', arguments: { since: '2026-10-01T00:00:00Z' } })
    assert.equal(recent.isError, true)
    assert.match(recent.content[0].text, /does not include this feature/)
  } finally {
    await client.close()
    api.server.close()
  }
})

test('e2e: invalid input is rejected before it reaches the API', async () => {
  const api = await mockApi()
  const client = await connect(api)
  try {
    api.calls.length = 0
    const missing = await client.callTool({ name: 'approve_comment', arguments: {} })
    assert.equal(missing.isError, true)
    assert.match(missing.content[0].text, /comment_id/)
    assert.equal(api.calls.length, 0, 'no request for a missing comment_id')

    const oversized = await client.callTool({ name: 'reply_to_comment', arguments: { comment_id: 'c1', body: 'x'.repeat(10001) } })
    assert.equal(oversized.isError, true)
    assert.match(oversized.content[0].text, /10000/)
    assert.equal(api.calls.length, 0, 'no request for an oversized reply')
  } finally {
    await client.close()
    api.server.close()
  }
})

test('e2e: API refusals become tool errors without leaking the token', async () => {
  const api = await mockApi()
  const client = await connect(api, 'et_supersecret')
  try {
    const res = await client.callTool({ name: 'list_sites', arguments: {} })
    assert.equal(res.isError, true)
    assert.match(res.content[0].text, /rejected the API token/)
    assert.doesNotMatch(res.content[0].text, /et_supersecret/)
  } finally {
    await client.close()
    api.server.close()
  }
})
