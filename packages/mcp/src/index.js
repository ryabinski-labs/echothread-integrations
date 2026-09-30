#!/usr/bin/env node
// stdio entry point: `npx -y @echothread/mcp` with ECHOTHREAD_API_TOKEN set.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { EchoThreadClient, DEFAULT_BASE_URL } from './client.js'
import { createServer, VERSION } from './server.js'

let client
try {
  client = new EchoThreadClient({
    token: process.env.ECHOTHREAD_API_TOKEN,
    baseUrl: process.env.ECHOTHREAD_API_URL || DEFAULT_BASE_URL,
    userAgent: `echothread-mcp/${VERSION}`,
  })
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
await createServer(client).connect(new StdioServerTransport())
