import type { IAuthenticateGeneric, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow'

export class EchoThreadApi implements ICredentialType {
  name = 'echoThreadApi'
  displayName = 'EchoThread API'
  documentationUrl = 'https://echothread.io/docs/n8n'
  icon = 'file:../nodes/EchoThread/echothread.svg' as const
  properties: INodeProperties[] = [
    {
      displayName: 'API Token',
      name: 'apiToken',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description: 'Create one at https://echothread.io/api-tokens. The trigger needs the read scope; actions need moderate or reply.',
    },
    {
      displayName: 'API Base URL',
      name: 'baseUrl',
      type: 'string',
      default: 'https://api.echothread.io/api/public/v1',
    },
  ]
  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: { headers: { Authorization: '=Bearer {{$credentials.apiToken}}' } },
  }
  test: ICredentialTestRequest = {
    request: { baseURL: '={{$credentials.baseUrl}}', url: '/sites/' },
  }
}
