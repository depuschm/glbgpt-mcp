# glbgpt-mcp

A small, self-hosted [MCP](https://modelcontextprotocol.io) server on Cloudflare Workers that lets an AI assistant (for example a custom connector in Claude) chat with and generate images, videos and audio through **your own GlobalGPT account**.

It uses GlobalGPT's official [API](https://www.glbgpt.com/home/api/docs) with your API key, so every model the API offers works, including new ones, without changes here. The key stays in Cloudflare's secret storage and never appears in a chat.

**[MODELS.md](MODELS.md)** lists every supported model with its ID and price, which website-only chat models work, and what isn't supported.

## Tools

| Tool | What it does |
|---|---|
| `glbgpt_chat` | One question to a chat model, optionally with a system prompt, images, or a JSON Schema for JSON answers |
| `glbgpt_generate` | Image, video, audio, 3D or a transcript, an image or video tool, a logo, or an AI-image/video check, with any model the API lists or the website-only ones |
| `glbgpt_check_task` | Waits for a running generation and returns its URL |
| `glbgpt_list_models` | GlobalGPT's live model list with prices and parameters, or one model's details |
| `glbgpt_usage` | The connector's daily limit and today's spend, your recent generations (API and website), and what the account was actually charged |

Every generation is priced with GlobalGPT's estimate first, then submitted with an idempotency key, so a retried submit can never create or charge a second task. A generate call waits up to 40 seconds for the result and otherwise returns a `task_id` for `glbgpt_check_task`. Results are URLs, valid for 30 days. Images go in as public `https` URLs or `data:` URIs. Fields a model doesn't take are dropped by GlobalGPT and listed in `ignored_parameters`.

GlobalGPT's API limits: 60 requests per minute, 5 chat streams and 10 media tasks at once, per account. It only spends paid credits.

**Website-only chat models.** glbgpt.com has chat models the API doesn't offer (e.g. Claude Opus 5.5, GPT-6.1 Sol, Gemini 4 Argon). With the optional `GLBGPT_TOKEN` set, `glbgpt_chat` sends a model the API refuses through the website's own chat instead, and `glbgpt_list_models` lists those models with `source: "website"`. They take text only (no images), each message becomes a conversation in your glbgpt.com history, and the website adds its own system prompt, so a message costs more than through the API. A model GlobalGPT later adds to the API automatically goes through the API again.

**Website-only media.** The same token also unlocks the website's images, videos, video tools, 3D models and speech to text that the API lacks (Midjourney, Kling O1, Veo 3, HeyGen avatar videos, Tripo/Meshy 3D, Scribe, …, see [MODELS.md](MODELS.md)). `glbgpt_generate` sends them through the website's own endpoints; task ids start with `web:` or `heygen:`. Their prices come from the website's lists and price tables (checked against real charges), so the daily credit counter is a close estimate for them; `glbgpt_usage` shows the real charges under `credit_records`.

- **Every website option:** the connector sends the same fields as the website's own form, and any `metadata` key is passed on as is, so whatever the website offers can be set. `glbgpt_list_models` with `model` set lists a model's options and allowed values. `metadata.enhancePrompt: true` turns on the website's prompt enhancer.
- **Midjourney buttons:** a finished grid lists its buttons (`actions`: U1–U4, V1–V4, reroll). Press one with `metadata.action` and `metadata.task_id` (the grid's task id).
- **AI Image / Video Detector:** `ai-image-detector` (an image URL or `data:` URI) and `ai-video-detector` (`video_url`, `duration`, `metadata.frame_ms`) return AI-generated and deepfake scores right away. A file that isn't in your GlobalGPT media library yet is uploaded there first.
- **Logo Maker:** `logo-maker` with `metadata.brandName`, `style`, `industry` and an aspect ratio.
- **Website agents and documents:** `deep-research` works with `glbgpt_chat`; `chatpdf` answers questions about a PDF passed in `files` (website-only chat models take documents in `files` too); `ai-translate` translates text with `glbgpt_generate` (`prompt` + `metadata.target_language`).

## Setup

### 1. Create a GlobalGPT API key
On glbgpt.com, open **API → API Keys** and create a key. It starts with `sk-glb-` and is shown only once, so copy it straight into step 3. You can revoke it there anytime.

### 2. Deploy the Worker
Either fork this repository and connect it in the Cloudflare dashboard (**Workers & Pages → Create → Continue with GitHub**, deploy command `npx wrangler deploy`), or create a "Hello World" Worker and paste `worker.js` into the editor. The Worker name must match `name` in `wrangler.toml` when deploying from Git.

The daily counter needs a KV namespace (`wrangler.toml` already points at one named `glbgpt-mcp-credits`; in a fork, create your own under **Storage & Databases → KV → Create** and put its ID into `wrangler.toml`). When pasting into the editor instead, bind it under **Settings → Bindings → KV namespace** with the name `CREDITS`.

### 3. Settings
Worker → **Settings → Variables and Secrets** (the runtime section, *not* **Settings → Build → Variables and secrets**, which the running Worker never sees). Add them for **Production**, then **Deploy**:

| Name | Type | Value |
|---|---|---|
| `GLBGPT_API_KEY` | Secret | the API key from step 1 |
| `CONNECTOR_SECRET` | Secret | a random string of at least 32 letters/digits only (if you put it in the URL, symbols like `/ # ? % +` break it) |
| `GLBGPT_TOKEN` | Secret | optional: your GlobalGPT login token, for website-only chat and media models (see below) |
| `DAILY_CREDIT_LIMIT` | Text | optional: most credits generations may spend per day, e.g. `20000`. Not set = no limit |
| `DISABLE_URL_SECRET` | Text | optional: `true` = accept the secret only as a header, not in the URL (see step 4) |

Changing `DAILY_CREDIT_LIMIT` in the dashboard applies as soon as you save and deploy it there; no Git push needed. The day resets at midnight Berlin time (`LIMIT_TIMEZONE` in `worker.js`). `0` blocks generation; a value that isn't a number also blocks it, so a typo never removes the limit by accident. Chat isn't counted. The counter uses what GlobalGPT actually reserves for each task, and a task that fails is taken off again (GlobalGPT releases its credits). `wrangler.toml` sets `keep_vars = true`, so Git deploys don't overwrite it.

Getting `GLBGPT_TOKEN` (only for website-only models): on your computer (Node.js 18+) run `npx @glbgpt/cli login`, then copy the token from `~/.config/glbgpt/credentials.json` without showing it:

```powershell
(Get-Content "$HOME\.config\glbgpt\credentials.json" | ConvertFrom-Json).token | Set-Clipboard
```
```sh
# macOS (use xclip/wl-copy instead of pbcopy on Linux)
node -p "require(require('os').homedir()+'/.config/glbgpt/credentials.json').token" | pbcopy
```

Unlike the API key, this token can't be revoked from your side (logging out doesn't invalidate it) and can do whatever your login can, so leave it out if you don't need those models.

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

Quick test before connecting (should list 5 tools):

```sh
curl -s -X POST "https://<worker-name>.<your-subdomain>.workers.dev/mcp" \
  -H "Authorization: Bearer <CONNECTOR_SECRET>" \
  -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

In Claude: **Settings → Connectors → Add custom connector**, enter the address (and the header, for A). If Claude reports that it couldn't determine how the server signs in, that's expected, because there is no OAuth sign-in: choose **Continue anyway**, leave the OAuth fields empty, then **Connect**. Then ask it to list GlobalGPT's models to check that the key works.

## Troubleshooting
- **`Not found` at the right address or with the right header:** open `https://<worker-name>.<your-subdomain>.workers.dev/health`. It shows which settings exist and their lengths (never values), whether the API key looks like one (`sk-glb-…`), the daily limit in effect, whether the KV namespace is bound, and the first 8 hex characters of the SHA-256 of `CONNECTOR_SECRET` to compare with your copy (PowerShell: `$h=[Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($secret)); -join ($h[0..3] | % { $_.ToString('x2') })`, or `printf %s "$SECRET" | sha256sum | cut -c1-8`). Everything `"set": false` means the variables were added under **Build**, or not deployed.
- **"GlobalGPT rejected the API key":** the key was revoked or mistyped; create a new one and update `GLBGPT_API_KEY`.
- **"GlobalGPT's website rejected the login token":** run `npx @glbgpt/cli login` again and update `GLBGPT_TOKEN`.
- **"Daily limit reached":** raise `DAILY_CREDIT_LIMIT`, delete it for no limit, or wait until midnight.
- **"the CREDITS KV namespace isn't bound":** see step 2, or delete `DAILY_CREDIT_LIMIT`.
- **A model returns "not found":** GlobalGPT retired or renamed it; the message usually names the successor, and `glbgpt_list_models` shows the current list.

## Security notes
- Without the secret (wrong or missing header, wrong path), every request answers `404`, except `/health`. `GET`/`DELETE` on the endpoint → `405`.
- The Worker logs nothing and never returns secret values; `/health` only reveals lengths and a short fingerprint.
- If the connector secret leaks, change `CONNECTOR_SECRET` and update the connector. If the API key leaks, revoke it under **API → API Keys** on glbgpt.com and set a new one.
- `DAILY_CREDIT_LIMIT` caps what a leaked secret or a looping agent can spend per day. The counter lives in KV, which isn't strictly atomic, so two generations started at the same moment can overshoot the limit by one.

## Tests
`node test.mjs` runs the Worker against a mocked GlobalGPT API (Node 18+). Nothing is charged.
