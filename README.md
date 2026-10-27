# EchoThread integrations

Open-source connectors for [EchoThread](https://echothread.io), the comment system for blogs and docs.

| Package | What it is |
|---|---|
| [`@echothread/mcp`](packages/mcp) | An MCP server: read and moderate your comments from Claude, ChatGPT or any MCP client. |
| [`@echothread/n8n-nodes-echothread`](packages/n8n-nodes-echothread) | n8n nodes: a New Comment trigger and Approve, Reject, Mark Spam and Reply actions. |

Both talk to the [EchoThread public API](https://echothread.io/docs/api) with an API token you create at
[echothread.io/api-tokens](https://echothread.io/api-tokens). A token only ever does what its scopes allow.

## Releasing

- `mcp-vX.Y.Z` (matching `packages/mcp/package.json`): CI tests, publishes to npm with provenance, and publishes to
  the [MCP Registry](https://registry.modelcontextprotocol.io) as `io.echothread/mcp`.
- `n8n-vX.Y.Z` (matching `packages/n8n-nodes-echothread/package.json`): CI tests and publishes to npm with provenance.

MIT licensed.

## Dependency security

CI runs `npm audit --audit-level=high` and Dependabot watches npm and GitHub Actions. The root
`overrides` in `package.json` keep `form-data`, `lodash` and `zod` on patched releases because
`n8n-workflow` 1.x still resolves vulnerable transitive versions (`npm ls` marks those overrides
"invalid" for the same reason). Drop an override once the upstream package depends on a fixed version
by itself.
