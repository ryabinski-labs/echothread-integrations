import type { IDataObject, INodeExecutionData, INodeType, INodeTypeDescription, IPollFunctions } from 'n8n-workflow'
import { NodeOperationError } from 'n8n-workflow'
import { echoThreadRequest, toNodeError } from './api'

/** Re-read this much before the newest comment seen, in case the API's
 * index lagged a write; comments already emitted are skipped by id. */
export const OVERLAP_MS = 2 * 60 * 1000
// A runaway guard, not a page budget: 1000 pages at 50 comments is far more
// than a poll interval can produce. If it is ever hit we fail loudly instead
// of advancing `since` past comments that were never read.
export const MAX_PAGES = 1000

interface PollState {
  since?: string
  seen?: Record<string, string>
}

export class EchoThreadTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'EchoThread Trigger',
    name: 'echoThreadTrigger',
    icon: 'file:echothread.svg',
    group: ['trigger'],
    version: 1,
    description: 'Starts the workflow when a new comment is posted on any of your EchoThread sites (Starter plan)',
    defaults: { name: 'EchoThread Trigger' },
    polling: true,
    inputs: [],
    outputs: ['main'],
    credentials: [{ name: 'echoThreadApi', required: true }],
    properties: [
      {
        displayName: 'Event',
        name: 'event',
        type: 'options',
        default: 'newComment',
        options: [{ name: 'New Comment', value: 'newComment' }],
      },
      {
        displayName: 'Status',
        name: 'statuses',
        type: 'multiOptions',
        default: [],
        description: 'Only emit comments in these statuses. Empty means every status.',
        options: [
          { name: 'Pending', value: 'pending' },
          { name: 'Approved', value: 'approved' },
          { name: 'Spam', value: 'spam' },
          { name: 'Rejected', value: 'rejected' },
        ],
      },
    ],
  }

  async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
    const state = this.getWorkflowStaticData('node') as PollState
    const manual = this.getMode() === 'manual'
    const now = Date.now()
    if (!state.since && !manual) {
      // First activation: start from now rather than replaying history.
      state.since = new Date(now).toISOString()
      state.seen = {}
    }
    const since = manual && !state.since ? new Date(now - 7 * 24 * 3600 * 1000).toISOString() : (state.since as string)
    const seen = state.seen ?? {}
    const statuses = this.getNodeParameter('statuses', []) as string[]

    const fresh: IDataObject[] = []
    let cursor: string | undefined
    let complete = false
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await echoThreadRequest(this, 'GET', '/comments', cursor ? { since, cursor } : { since })
        for (const c of (res.items as IDataObject[]) ?? []) {
          const id = String(c.id)
          if (seen[id]) continue
          fresh.push(c)
        }
        cursor = (res.next_cursor as string) || undefined
        if (!cursor) {
          complete = true
          break
        }
      }
    } catch (err) {
      throw toNodeError(this, err)
    }
    if (!complete) {
      throw new NodeOperationError(this.getNode(), `EchoThread returned more than ${MAX_PAGES} pages of comments`, {
        description: 'The backlog is too large to read in one poll. No cursor was advanced, so the next poll retries from the same point.',
      })
    }
    if (manual) return fresh.length ? [this.helpers.returnJsonArray(fresh.slice(-10))] : null

    // Advance: remember every emitted id, and move `since` to the newest
    // comment minus the overlap window, dropping ids older than it. A comment
    // the API gave an unparseable created_at must not freeze the cursor; it
    // stays in `seen` so it is still emitted only once.
    let newest = Date.parse(since) + OVERLAP_MS
    for (const c of fresh) {
      seen[String(c.id)] = String(c.created_at)
      const at = Date.parse(String(c.created_at))
      if (Number.isFinite(at)) newest = Math.max(newest, at)
    }
    const next = new Date(Math.min(newest, now) - OVERLAP_MS)
    if (next.getTime() > Date.parse(since)) state.since = next.toISOString()
    for (const [id, at] of Object.entries(seen)) if (Date.parse(at) <= Date.parse(state.since as string)) delete seen[id]
    state.seen = seen

    const emit = statuses.length ? fresh.filter((c) => statuses.includes(String(c.status))) : fresh
    return emit.length ? [this.helpers.returnJsonArray(emit)] : null
  }
}
