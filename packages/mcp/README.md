# @echothread/mcp

An [MCP](https://modelcontextprotocol.io) server for [EchoThread](https://echothread.io). Ask your assistant
"what's waiting for review on my blog?", approve or reply, without opening the dashboard.

## Set up

1. Create an API token at [echothread.io/api-tokens](https://echothread.io/api-tokens).
   Pick only the scopes you want the assistant to have:
   `read` (free plan included), and on Starter `moderate`, `reply` and `delete`.
2. Add the server to your client. For Claude Desktop, in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "echothread": {
      "command": "npx",
      "args": ["-y", "@echothread/mcp"],
      "env": { "ECHOTHREAD_API_TOKEN": "et_..." }
    }
  }
}
```

For Claude Code: `claude mcp add echothread -e ECHOTHREAD_API_TOKEN=et_... -- npx -y @echothread/mcp`

## Tools

| Tool | Scope | What it does |
|---|---|---|
| `list_sites` | read | Your sites and their ids |
| `list_pending` | read | Comments waiting for review on one site |
| `list_recent_comments` | read (Starter) | Comments created since a time, across your sites |
| `get_thread` | read | A page's thread and its comments |
| `get_comment` | read | One comment |
| `site_stats` | read | Comment counts by status, last 7 and 30 days |
| `approve_comment` | moderate | Publish a held comment |
| `reject_comment` | moderate | Keep a comment hidden |
| `mark_spam` | moderate | Hide a comment and train the spam filter |
| `reply_to_comment` | reply | Reply as the site owner (published straight away) |
| `delete_comment` | delete | Permanently delete a comment and its replies |

A tool the token's scopes don't allow answers "This token lacks the moderate scope" (or reply, or delete)
and changes nothing. Commenter email addresses and IPs are never returned.

`ECHOTHREAD_API_URL` overrides the API base (default `https://api.echothread.io/api/public/v1`).

MIT licensed.
