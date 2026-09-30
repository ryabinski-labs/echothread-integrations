// The EchoThread MCP server: eleven tools over the public API. Reads need a
// token with the read scope; approve/reject/mark_spam need moderate, reply
// needs reply, and delete needs delete. The API is the only judge of what a
// token may do — this server never guesses, it passes the API's answer on.

import { readFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { ApiError, routes } from './client.js'

export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

const commentId = { comment_id: z.string().min(1).describe('The comment id') }
const siteId = { site_id: z.string().min(1).describe('The site id, from list_sites') }
const cursor = { cursor: z.string().optional().describe('The next_cursor from a previous page') }

const READ = { readOnlyHint: true, openWorldHint: true }
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }

export const TOOLS = [
  {
    name: 'list_sites',
    description: 'List the sites this token can see, with their ids.',
    input: {},
    annotations: READ,
    run: (c) => routes.listSites(c),
  },
  {
    name: 'list_pending',
    description: 'List the comments on one site that are waiting for review, oldest first, 50 per page.',
    input: { ...siteId, ...cursor },
    annotations: READ,
    run: (c, a) => routes.listPending(c, a),
  },
  {
    name: 'list_recent_comments',
    description: 'List comments created since a time across every site this token can see. Needs the Starter plan.',
    input: {
      since: z.string().min(1).describe('ISO 8601 time, e.g. 2026-10-01T00:00:00Z'),
      ...cursor,
    },
    annotations: READ,
    run: (c, a) => routes.listRecent(c, a),
  },
  {
    name: 'get_thread',
    description: 'Get one thread (a page with comments) and its first page of comments.',
    input: { thread_id: z.string().min(1).describe('The thread id'), ...cursor },
    annotations: READ,
    run: async (c, a) => ({ thread: await routes.getThread(c, a), comments: await routes.getThreadComments(c, a) }),
  },
  {
    name: 'get_comment',
    description: 'Get one comment by id.',
    input: commentId,
    annotations: READ,
    run: (c, a) => routes.getComment(c, a),
  },
  {
    name: 'site_stats',
    description: 'Count a site\'s comments by status over the last 7 and 30 days.',
    input: siteId,
    annotations: READ,
    run: (c, a) => routes.siteStats(c, a),
  },
  {
    name: 'approve_comment',
    description: 'Approve a comment so it shows on the site. Needs the moderate scope.',
    input: commentId,
    annotations: WRITE,
    run: (c, a) => routes.approve(c, a),
  },
  {
    name: 'reject_comment',
    description: 'Reject a comment so it stays hidden. Needs the moderate scope.',
    input: commentId,
    annotations: WRITE,
    run: (c, a) => routes.reject(c, a),
  },
  {
    name: 'mark_spam',
    description: 'Mark a comment as spam, which hides it and trains the spam filter. Needs the moderate scope.',
    input: commentId,
    annotations: WRITE,
    run: (c, a) => routes.spam(c, a),
  },
  {
    name: 'reply_to_comment',
    description: 'Post a reply to a comment as the site owner. The reply is published straight away. Needs the reply scope.',
    input: { ...commentId, body: z.string().min(1).max(10000).describe('The reply text') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    run: (c, a) => routes.reply(c, a),
  },
  {
    name: 'delete_comment',
    description: 'Permanently delete a comment and its replies. This cannot be undone. Needs the delete scope.',
    input: commentId,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    run: (c, a) => routes.remove(c, a),
  },
]

// errorText turns an API refusal into the message the assistant shows.
export function errorText(err) {
  if (err instanceof ApiError) {
    if (err.code === 'scope_required' && err.scope) {
      return `This token lacks the ${err.scope} scope. Create a token with it at https://echothread.io/api-tokens.`
    }
    if (err.status === 401) return 'EchoThread rejected the API token. It may be revoked or mistyped; check ECHOTHREAD_API_TOKEN.'
    return err.message
  }
  return `Could not reach EchoThread: ${err?.message || err}`
}

export function createServer(client) {
  const server = new McpServer({ name: 'echothread', version: VERSION })
  for (const t of TOOLS) {
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: t.input, annotations: t.annotations },
      async (args) => {
        try {
          const out = await t.run(client, args || {})
          return { content: [{ type: 'text', text: JSON.stringify(out ?? { ok: true }, null, 2) }] }
        } catch (err) {
          return { isError: true, content: [{ type: 'text', text: errorText(err) }] }
        }
      },
    )
  }
  return server
}
