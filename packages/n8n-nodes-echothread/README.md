# n8n-nodes-echothread

[n8n](https://n8n.io) community nodes for [EchoThread](https://echothread.io), the comment system for blogs and docs.

- **EchoThread Trigger — New Comment:** starts your workflow once for every new comment on any of your sites
  (optionally only pending, approved, spam or rejected ones). Needs the Starter plan.
- **EchoThread:** Approve, Reject, Mark Spam, Reply or Get a comment.

## Install

In n8n: **Settings → Community Nodes → Install**, enter `n8n-nodes-echothread`.

## Credentials

Create an API token at [echothread.io/api-tokens](https://echothread.io/api-tokens) and add it as an
**EchoThread API** credential. Give it only the scopes the workflow needs: `read` for the trigger and Get,
`moderate` for Approve/Reject/Mark Spam, `reply` for Reply.

A step whose token lacks a scope fails with the API's message, for example
"This API token does not have the moderate scope". On the free plan the trigger stops with
"The n8n node needs Starter" and a link to [pricing](https://echothread.io/pricing).

## Example

EchoThread Trigger (status: pending) → an AI classifier → EchoThread (Approve) or (Mark Spam).
Commenter email addresses and IPs are never returned by the API.

MIT licensed.
