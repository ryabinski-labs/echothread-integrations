const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EchoThreadTrigger, OVERLAP_MS } = require('../dist/nodes/EchoThread/EchoThreadTrigger.node.js')
const { EchoThread } = require('../dist/nodes/EchoThread/EchoThread.node.js')

const node = { id: 'n1', name: 'EchoThread', type: 'x', typeVersion: 1, position: [0, 0], parameters: {} }

function ctx({ mode = 'trigger', params = {}, items = [{ json: {} }], state = {}, respond, continueOnFail = false }) {
  const calls = []
  return {
    calls,
    state,
    getMode: () => mode,
    getNode: () => node,
    getWorkflowStaticData: () => state,
    getNodeParameter: (name, idxOrDefault, fallback) => (name in params ? params[name] : typeof idxOrDefault === 'number' ? fallback : idxOrDefault),
    getCredentials: async () => ({ apiToken: 't', baseUrl: 'https://api.test/api/public/v1' }),
    getInputData: () => items,
    continueOnFail: () => continueOnFail,
    helpers: {
      returnJsonArray: (a) => a.map((json) => ({ json })),
      httpRequestWithAuthentication: async function (cred, opts) {
        calls.push({ cred, ...opts })
        return respond(opts)
      },
    },
  }
}
const ok = (body) => ({ statusCode: 200, body })
const iso = (ms) => new Date(ms).toISOString()

test('first activation starts from now and replays no history', async () => {
  const now = Date.now()
  const c = ctx({ respond: () => ok({ items: [], next_cursor: null }) })
  const out = await new EchoThreadTrigger().poll.call(c)
  assert.equal(out, null)
  assert.ok(Math.abs(Date.parse(c.calls[0].qs.since) - now) < 5000)
  assert.equal(c.calls[0].url, 'https://api.test/api/public/v1/comments')
  assert.equal(c.calls[0].cred, 'echoThreadApi')
})

test('each comment starts the workflow exactly once across overlapping polls and pages', async () => {
  const t = Date.now() - 60_000
  const c1 = { id: 'c1', created_at: iso(t), status: 'pending' }
  const c2 = { id: 'c2', created_at: iso(t + 1000), status: 'approved' }
  const c3 = { id: 'c3', created_at: iso(t + 2000), status: 'pending' }
  const state = { since: iso(t - 1000), seen: {} }
  const pages = [
    // poll 1: two pages
    [ok({ items: [c1], next_cursor: 'p2' }), ok({ items: [c2], next_cursor: null })],
    // poll 2: the overlap window returns c1 and c2 again, plus c3
    [ok({ items: [c1, c2, c3], next_cursor: null })],
    // poll 3: nothing new but the overlap
    [ok({ items: [c2, c3], next_cursor: null })],
  ]
  const emitted = []
  for (const responses of pages) {
    const c = ctx({ state, respond: () => responses.shift() })
    const out = await new EchoThreadTrigger().poll.call(c)
    for (const it of out?.[0] ?? []) emitted.push(it.json.id)
    if (responses.length === 0 && c.calls.length > 1) assert.equal(c.calls[1].qs.cursor, 'p2')
    assert.ok(Date.parse(state.since) <= Date.parse(c3.created_at), 'since never passes a comment it might miss')
  }
  assert.deepEqual(emitted, ['c1', 'c2', 'c3'])
  assert.ok(Date.parse(state.since) >= Date.parse(c3.created_at) - OVERLAP_MS - 1)
})

// SC-n8n-exactly-once (tdd/p1-owner-channels.tdd.yaml): a property over 200
// generated histories. Comments arrive over simulated time, each visible to
// the API up to OVERLAP_MS after its created_at (the lag the overlap window
// exists for); the trigger polls at random moments against a fake API that
// pages with a random page size. Once everything has arrived and two more
// polls ran, the emitted ids are exactly the created ids, each once.
function rng(seed) {
  let x = seed >>> 0 || 1
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

test('property: every created comment is emitted exactly once (200 histories)', async () => {
  const realNow = Date.now
  try {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed)
      let clock = 1_800_000_000_000
      Date.now = () => clock
      const start = clock
      const n = 1 + Math.floor(r() * 40)
      const comments = []
      for (let i = 0; i < n; i++) {
        // Clustered arrivals, and lags biased toward the edge of the window,
        // so a since that advanced even a few seconds too far loses one.
        const created = start + 1000 + Math.floor(r() * 180_000)
        const lag = OVERLAP_MS - 1 - Math.floor(r() ** 3 * (OVERLAP_MS - 1))
        comments.push({ id: `c${i}`, created, visible: created + lag })
      }
      const pageSize = 1 + Math.floor(r() * 5)
      const api = (opts) => {
        const since = Date.parse(opts.qs.since)
        const rows = comments
          .filter((c) => c.visible <= clock && c.created > since)
          .sort((a, b) => a.created - b.created || a.id.localeCompare(b.id))
        const offset = opts.qs.cursor ? Number(opts.qs.cursor) : 0
        const page = rows.slice(offset, offset + pageSize)
        const next = offset + pageSize < rows.length ? String(offset + pageSize) : null
        return ok({ items: page.map((c) => ({ id: c.id, created_at: iso(c.created), status: 'pending' })), next_cursor: next })
      }
      const state = {}
      const emitted = []
      const poll = async () => {
        const out = await new EchoThreadTrigger().poll.call(ctx({ state, respond: api }))
        for (const it of out?.[0] ?? []) emitted.push(it.json.id)
      }
      await poll() // activation at `start`, before any comment exists
      const end = Math.max(...comments.map((c) => c.visible)) + 1
      while (clock < end) {
        clock += 1 + Math.floor(r() * 20_000)
        await poll()
      }
      clock += 1000
      await poll()
      clock += 1000
      await poll()
      const want = comments.map((c) => c.id).sort()
      assert.deepEqual([...emitted].sort(), want, `seed ${seed}: emitted ${emitted.length}, created ${n}`)
    }
  } finally {
    Date.now = realNow
  }
})

test('a Hobby token fails activation with "The n8n node needs Starter" and a pricing link', async () => {
  const c = ctx({ respond: () => ({ statusCode: 403, body: { code: 'feature_required', detail: 'Your Hobby plan does not include this feature (webhooks_api).' } }) })
  await assert.rejects(new EchoThreadTrigger().poll.call(c), (e) => {
    assert.equal(e.message, 'The n8n node needs Starter')
    assert.match(e.description, /https:\/\/echothread\.io\/pricing/)
    return true
  })
})

test('the status filter emits only the chosen statuses', async () => {
  const t = Date.now() - 10_000
  const c = ctx({
    params: { statuses: ['pending'] },
    state: { since: iso(t - 1000), seen: {} },
    respond: () => ok({ items: [{ id: 'a', created_at: iso(t), status: 'spam' }, { id: 'b', created_at: iso(t), status: 'pending' }], next_cursor: null }),
  })
  const out = await new EchoThreadTrigger().poll.call(c)
  assert.deepEqual(out[0].map((i) => i.json.id), ['b'])
})

test('actions call the matching public API route', async () => {
  for (const [op, path] of [['approve', '/comments/c%201/approve'], ['reject', '/comments/c%201/reject'], ['spam', '/comments/c%201/spam'], ['get', '/comments/c%201']]) {
    const c = ctx({ params: { operation: op, commentId: 'c 1' }, respond: () => ok({ id: 'c 1', status: op }) })
    const [[item]] = await new EchoThread().execute.call(c)
    assert.equal(c.calls[0].url, 'https://api.test/api/public/v1' + path, op)
    assert.equal(c.calls[0].method, op === 'get' ? 'GET' : 'POST')
    assert.equal(item.json.id, 'c 1')
  }
  const c = ctx({ params: { operation: 'reply', commentId: 'c1', body: 'Thanks!' }, respond: () => ok({ id: 'r1' }) })
  await new EchoThread().execute.call(c)
  assert.equal(c.calls[0].url, 'https://api.test/api/public/v1/comments/c1/reply')
  assert.deepEqual(c.calls[0].body, { body: 'Thanks!' })
})

test('a token lacking a scope fails the item with the API scope_required message', async () => {
  const detail = 'This API token does not have the moderate scope. Create a token with it on the API tokens page.'
  const refuse = () => ({ statusCode: 403, body: { code: 'scope_required', scope: 'moderate', detail } })
  const c = ctx({ params: { operation: 'approve', commentId: 'c1' }, respond: refuse })
  await assert.rejects(new EchoThread().execute.call(c), (e) => { assert.equal(e.message, detail); return true })
  const soft = ctx({ params: { operation: 'approve', commentId: 'c1' }, respond: refuse, continueOnFail: true, items: [{ json: {} }, { json: {} }] })
  const [out] = await new EchoThread().execute.call(soft)
  assert.equal(out.length, 2)
  assert.equal(out[0].json.error, detail)
})
