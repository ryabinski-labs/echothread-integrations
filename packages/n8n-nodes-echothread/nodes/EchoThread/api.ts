import type { IDataObject, IExecuteFunctions, IHttpRequestMethods, IPollFunctions } from 'n8n-workflow'
import { NodeApiError, NodeOperationError } from 'n8n-workflow'

type Ctx = IExecuteFunctions | IPollFunctions

export const PRICING_URL = 'https://echothread.io/pricing'

/** An EchoThread API refusal, carrying the API's own code and message. */
export class EchoThreadError extends Error {
  constructor(public status: number, public body: IDataObject) {
    super(String(body?.detail ?? `EchoThread API returned HTTP ${status}`))
  }
  get code(): string | undefined {
    return body(this).code as string | undefined
  }
}
const body = (e: EchoThreadError) => e.body ?? {}

/** Calls the public API with the node's EchoThread credential. */
export async function echoThreadRequest(ctx: Ctx, method: IHttpRequestMethods, path: string, qs?: IDataObject, payload?: IDataObject) {
  const creds = await ctx.getCredentials('echoThreadApi')
  const base = String(creds.baseUrl || 'https://api.echothread.io/api/public/v1').replace(/\/+$/, '')
  const res = (await ctx.helpers.httpRequestWithAuthentication.call(ctx, 'echoThreadApi', {
    method,
    url: base + path,
    qs,
    body: payload,
    json: true,
    headers: { 'User-Agent': 'n8n-nodes-echothread' },
    returnFullResponse: true,
    ignoreHttpStatusErrors: true,
  })) as { statusCode: number; body: IDataObject }
  if (res.statusCode < 200 || res.statusCode >= 300) throw new EchoThreadError(res.statusCode, res.body ?? {})
  return res.body
}

/** Turns an API refusal into the n8n error the user sees. */
export function toNodeError(ctx: Ctx, err: unknown, itemIndex?: number) {
  if (err instanceof EchoThreadError) {
    if (err.code === 'feature_required') {
      return new NodeOperationError(ctx.getNode(), 'The n8n node needs Starter', {
        description: `${err.message} See ${PRICING_URL}`,
        itemIndex,
      })
    }
    return new NodeApiError(ctx.getNode(), err.body as never, {
      message: err.message,
      httpCode: String(err.status),
      itemIndex,
    })
  }
  return err as Error
}
