// A small client for the EchoThread public API (https://echothread.io/docs/api).
// Every call carries the token as a Bearer credential; the API decides what the
// token may do (its scopes) and what the account's plan includes.

export const DEFAULT_BASE_URL = 'https://api.echothread.io/api/public/v1'

export class ApiError extends Error {
  constructor(status, body) {
    super((body && body.detail) || `EchoThread API returned HTTP ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.code = body?.code
    this.scope = body?.scope
    this.feature = body?.feature
  }
}

export class EchoThreadClient {
  constructor({ token, baseUrl = DEFAULT_BASE_URL, fetch: fetchImpl = globalThis.fetch, userAgent = 'echothread-mcp' } = {}) {
    if (!token) throw new Error('ECHOTHREAD_API_TOKEN is not set. Create a token at https://echothread.io/api-tokens.')
    this.token = token
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.fetch = fetchImpl
    this.userAgent = userAgent
  }

  async request(method, path, { query, body } = {}) {
    const url = new URL(this.baseUrl + path)
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
    }
    const res = await this.fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: 'application/json',
        'user-agent': this.userAgent,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let json = null
    if (text) {
      try {
        json = JSON.parse(text)
      } catch {
        json = { detail: text.slice(0, 300) }
      }
    }
    if (!res.ok) throw new ApiError(res.status, json)
    return json
  }
}

const seg = (id) => encodeURIComponent(String(id))

export const routes = {
  listSites: (c) => c.request('GET', '/sites/'),
  listPending: (c, { site_id, cursor }) => c.request('GET', `/sites/${seg(site_id)}/comments`, { query: { status: 'pending', cursor } }),
  listRecent: (c, { since, cursor }) => c.request('GET', '/comments', { query: { since, cursor } }),
  getThread: (c, { thread_id }) => c.request('GET', `/threads/${seg(thread_id)}`),
  getThreadComments: (c, { thread_id, cursor }) => c.request('GET', `/threads/${seg(thread_id)}/comments`, { query: { cursor } }),
  getComment: (c, { comment_id }) => c.request('GET', `/comments/${seg(comment_id)}`),
  siteStats: (c, { site_id }) => c.request('GET', `/sites/${seg(site_id)}/stats`),
  approve: (c, { comment_id }) => c.request('POST', `/comments/${seg(comment_id)}/approve`),
  reject: (c, { comment_id }) => c.request('POST', `/comments/${seg(comment_id)}/reject`),
  spam: (c, { comment_id }) => c.request('POST', `/comments/${seg(comment_id)}/spam`),
  reply: (c, { comment_id, body }) => c.request('POST', `/comments/${seg(comment_id)}/reply`, { body: { body } }),
  remove: (c, { comment_id }) => c.request('POST', `/comments/${seg(comment_id)}/delete`),
}
