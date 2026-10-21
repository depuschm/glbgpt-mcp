# glbgpt-mcp

A small, self-hosted [MCP](https://modelcontextprotocol.io) server on Cloudflare Workers that lets an AI assistant (for example a custom connector in Claude) chat with and generate images and videos through **your own GlobalGPT account**.

GlobalGPT's official MCP server (`glbgpt mcp` from [`@glbgpt/cli`](https://www.npmjs.com/package/@glbgpt/cli)) runs locally over stdio, so web clients like claude.ai can't use it. This Worker makes the same calls to GlobalGPT's API over HTTPS, so it works as a remote connector. The login token stays in Cloudflare's secret storage and never appears in a chat.

> GlobalGPT doesn't document this API; the calls mirror `@glbgpt/cli` 0.2.4. If GlobalGPT changes them, the Worker needs an update.

## Tools

| Tool | What it does |
|---|---|
| `glbgpt_chat` | One question to a chat model, optionally with a system prompt, images, or a JSON Schema for JSON answers |
| `glbgpt_generate_image` | Image from a prompt, optionally from reference images |
| `glbgpt_generate_video` | Video from a prompt, optionally from a start (and end) frame |
| `glbgpt_check_task` | Waits for a running generation and returns its URL |
| `glbgpt_list_models` | Chat, image and video models and what each supports |
| `glbgpt_account` | Plan, credits left, and the connector's daily limit with today's spend |

Results are returned as URLs (the CLI saves files to disk; a Worker has no disk). Every image and video is priced with GlobalGPT's estimate first; a generate call waits up to 40 seconds for the result and otherwise returns a `task_id` for `glbgpt_check_task`. Reference images must be `http(s)` or `data:` URLs; `data:` URLs are uploaded to GlobalGPT first.

Differences from the CLI's MCP server: no local file paths, and chat has no built-in web search (your assistant has its own).

## Setup

### 1. Get your GlobalGPT token
On your computer (Node.js 18+), sign in once:

```sh
npx @glbgpt/cli login
```

This saves a long-lived token in `~/.config/glbgpt/credentials.json` (on Windows `C:\Users\<you>\.config\glbgpt\credentials.json`). Copy it to the clipboard without showing it:

```powershell
(Get-Content "$HOME\.config\glbgpt\credentials.json" | ConvertFrom-Json).token | Set-Clipboard
```
```sh
# macOS (use xclip/wl-copy instead of pbcopy on Linux)
node -p "require(require('os').homedir()+'/.config/glbgpt/credentials.json').token" | pbcopy
```

`glbgpt logout` doesn't revoke the token on GlobalGPT's side. Treat it like a password.

### 2. Deploy the Worker
Either fork this repository and connect it in the Cloudflare dashboard (**Workers & Pages → Create → Continue with GitHub**, deploy command `npx wrangler deploy`), or create a "Hello World" Worker and paste `worker.js` into the editor. The Worker name must match `name` in `wrangler.toml` when deploying from Git.

The daily counter needs a KV namespace (`wrangler.toml` already points at one named `glbgpt-mcp-credits`; in a fork, create your own under **Storage & Databases → KV → Create** and put its ID into `wrangler.toml`). When pasting into the editor instead, bind it under **Settings → Bindings → KV namespace** with the name `CREDITS`.

### 3. Settings
Worker → **Settings → Variables and Secrets** (the runtime section, *not* **Settings → Build → Variables and secrets**, which the running Worker never sees). Add them for **Production**, then **Deploy**:

| Name | Type | Value |
|---|---|---|
| `GLBGPT_TOKEN` | Secret | the token from step 1 |
| `CONNECTOR_SECRET` | Secret | a random string of at least 32 letters/digits only (if you put it in the URL, symbols like `/ # ? % +` break it) |
| `DAILY_CREDIT_LIMIT` | Text | optional: most credits images and videos may spend per day, e.g. `20000`. Not set = no limit |
| `DISABLE_URL_SECRET` | Text | optional: `true` = accept the secret only as a header, not in the URL (see step 4) |

Changing `DAILY_CREDIT_LIMIT` in the dashboard applies as soon as you save and deploy it there; no Git push needed. The day resets at midnight Berlin time (`LIMIT_TIMEZONE` in `worker.js`). `0` blocks images and videos; a value that isn't a number also blocks them, so a typo never removes the limit by accident. Chat isn't counted. A generation that GlobalGPT refuses is taken off the count again; one that fails while rendering stays counted. `wrangler.toml` sets `keep_vars = true`, so Git deploys don't overwrite it.

Generating a secret (64 hex characters), with any of:

```sh
openssl rand -hex 32
```
```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | % { $_.ToString('x2') })
```
```js
// browser console
[...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('')
```

### 4. Connect your assistant
The MCP endpoint (streamable HTTP) needs `CONNECTOR_SECRET`, in one of two ways:

**A. In a header (preferred).** Endpoint `https://<worker-name>.<your-subdomain>.workers.dev/mcp` with the header
`Authorization: Bearer <CONNECTOR_SECRET>` (or `X-API-Key: <CONNECTOR_SECRET>`). In Claude, this is the **Request headers** section of **Settings → Connectors → Add custom connector** (currently a beta that not every account has).

**B. In the URL (fallback).** For clients that only take a URL:

```
https://<worker-name>.<your-subdomain>.workers.dev/mcp/<CONNECTOR_SECRET>
```

Treat this address like a password: whoever has it can spend your credits. Once all your clients use the header, set `DISABLE_URL_SECRET` to `true`.

Quick test before connecting (should list 6 tools):

```sh
curl -s -X POST "https://<worker-name>.<your-subdomain>.workers.dev/mcp" \
  -H "Authorization: Bearer <CONNECTOR_SECRET>" \
  -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

In Claude: **Settings → Connectors → Add custom connector**, enter the address (and the header, for A). If Claude reports that it couldn't determine how the server signs in, that's expected, because there is no OAuth sign-in: choose **Continue anyway**, leave the OAuth fields empty, then **Connect**. Then ask for `glbgpt_account` to check that the token works.

## Troubleshooting
- **`Not found` at the right address or with the right header:** open `https://<worker-name>.<your-subdomain>.workers.dev/health`. It shows which settings exist and their lengths (never values), the daily limit in effect, whether the KV namespace is bound, and the first 8 hex characters of the SHA-256 of `CONNECTOR_SECRET` to compare with your copy (PowerShell: `$h=[Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($secret)); -join ($h[0..3] | % { $_.ToString('x2') })`, or `printf %s "$SECRET" | sha256sum | cut -c1-8`). Everything `"set": false` means the variables were added under **Build**, or not deployed.
- **"GlobalGPT rejected the token":** run `npx @glbgpt/cli login` again and update `GLBGPT_TOKEN`.
- **"Daily limit reached":** raise `DAILY_CREDIT_LIMIT`, delete it for no limit, or wait until midnight.
- **"the CREDITS KV namespace isn't bound":** see step 2, or delete `DAILY_CREDIT_LIMIT`.
- **A model stops working:** GlobalGPT may have changed or retired it; `glbgpt_list_models` hides models GlobalGPT has switched off.

## Security notes
- Without the secret (wrong or missing header, wrong path), every request answers `404`, except `/health`. `GET`/`DELETE` on the endpoint → `405`.
- The Worker logs nothing and never returns secret values; `/health` only reveals lengths and a short fingerprint.
- If the connector secret leaks, change `CONNECTOR_SECRET` and update the connector. If the GlobalGPT token leaks, it can't be revoked from your side; contact GlobalGPT support.
- `DAILY_CREDIT_LIMIT` caps what a leaked secret or a looping agent can spend per day. The counter lives in KV, which isn't strictly atomic, so two generations started at the same moment can overshoot the limit by one.

## Tests
`node test.mjs` runs the Worker against a mocked GlobalGPT API (Node 18+). Nothing is charged.
