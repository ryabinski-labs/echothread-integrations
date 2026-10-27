# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:
<https://github.com/ryabinski-labs/echothread-integrations/security/advisories/new>

Do not open a public issue. Include the affected package and version, the impact, and the smallest
reproduction you can. We aim to acknowledge a report within three business days.

## Supported versions

The latest published version of each package receives fixes:

- `@echothread/mcp`
- `@echothread/n8n-nodes-echothread`

## Scope

API tokens are issued and scoped by [EchoThread](https://echothread.io/api-tokens); a token can only
do what its scopes allow. Vulnerabilities in the EchoThread service itself should go through the same
private channel.
