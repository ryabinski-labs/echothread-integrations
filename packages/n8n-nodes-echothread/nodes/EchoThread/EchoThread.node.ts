import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow'
import { echoThreadRequest, toNodeError } from './api'

const idPath = (id: string) => encodeURIComponent(id)

export class EchoThread implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'EchoThread',
    name: 'echoThread',
    icon: 'file:echothread.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Moderate and reply to EchoThread comments',
    defaults: { name: 'EchoThread' },
    inputs: ['main'],
    outputs: ['main'],
    usableAsTool: true,
    credentials: [{ name: 'echoThreadApi', required: true }],
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        default: 'approve',
        options: [
          { name: 'Approve', value: 'approve', action: 'Approve a comment', description: 'Publish a held comment (moderate scope)' },
          { name: 'Get', value: 'get', action: 'Get a comment', description: 'Read one comment (read scope)' },
          { name: 'Mark Spam', value: 'spam', action: 'Mark a comment as spam', description: 'Hide it and train the spam filter (moderate scope)' },
          { name: 'Reject', value: 'reject', action: 'Reject a comment', description: 'Keep a comment hidden (moderate scope)' },
          { name: 'Reply', value: 'reply', action: 'Reply to a comment', description: 'Reply as the site owner (reply scope)' },
        ],
      },
      {
        displayName: 'Comment ID',
        name: 'commentId',
        type: 'string',
        default: '={{ $json.id }}',
        required: true,
      },
      {
        displayName: 'Reply Text',
        name: 'body',
        type: 'string',
        typeOptions: { rows: 4 },
        default: '',
        required: true,
        displayOptions: { show: { operation: ['reply'] } },
      },
    ],
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData()
    const out: INodeExecutionData[] = []
    for (let i = 0; i < items.length; i++) {
      try {
        const op = this.getNodeParameter('operation', i) as string
        const id = idPath(this.getNodeParameter('commentId', i) as string)
        let res: IDataObject
        if (op === 'get') res = await echoThreadRequest(this, 'GET', `/comments/${id}`)
        else if (op === 'reply') {
          res = await echoThreadRequest(this, 'POST', `/comments/${id}/reply`, undefined, { body: this.getNodeParameter('body', i) as string })
        } else res = await echoThreadRequest(this, 'POST', `/comments/${id}/${op}`)
        out.push({ json: res, pairedItem: { item: i } })
      } catch (err) {
        const e = toNodeError(this, err, i)
        if (this.continueOnFail()) {
          out.push({ json: { error: e.message }, pairedItem: { item: i } })
          continue
        }
        throw e
      }
    }
    return [out]
  }
}
