// glbgpt-mcp: a remote MCP server on Cloudflare Workers for your GlobalGPT account.
// Same shape as discord-mcp: JSON-RPC over HTTP, secret in a header or the URL, /health.
// Talks to GlobalGPT's official API (https://www.glbgpt.com/home/api/docs) with your API key.
// Chat models the API doesn't offer fall back to the website's chat endpoint with your login token.

const API = "https://api2.glbgpt.com/ai-api/open/v1";
const WEB_CHAT = "https://api2.glbgpt.com/ai-api/ai/agent/chatStream";

// The website's chat catalogue (model id -> agent id), read from glbgpt.com on 21 Oct 2026.
// Only used when the API refuses a model, so a model GlobalGPT later adds to the API goes there again.
const WEBSITE_CHAT_MODELS = {
  "claude-opus-5.5": ["6242", "Claude Opus 5.5"], "claude-sonnet-5.5": ["6250", "Claude Sonnet 5.5"],
  "claude-haiku-5.5": ["6253", "Claude Haiku 5.5"], "claude-fable-5.1": ["6225", "Claude Fable 5.1"],
  "claude-fable-5": ["6171", "Claude Fable 5"], "claude-opus-5": ["6190", "Claude Opus 5"],
  "claude-sonnet-5": ["6177", "Claude Sonnet 5"], "claude-opus-4.8": ["6170", "Claude Opus 4.8"],
  "claude-opus-4.7": ["6158", "Claude Opus 4.7"], "claude-opus-4.6": ["6130", "Claude Opus 4.6"],
  "claude-sonnet-4.6": ["6133", "Claude Sonnet 4.6"], "claude-opus-4.5": ["6108", "Claude Opus 4.5"],
  "claude-sonnet-4.5": ["6086", "Claude Sonnet 4.5"], "claude-haiku-4.5": ["6089", "Claude Haiku 4.5"],
  "gpt-6.1-sol": ["6251", "GPT-6.1 Sol"], "gpt-6-sol": ["6243", "GPT-6 Sol"], "gpt-6-luna": ["6244", "GPT-6 Luna"],
  "gpt-6-astra": ["6228", "GPT-6 Astra"], "gpt-5.6-sol": ["6179", "GPT-5.6 Sol"], "gpt-5.6-terra": ["6180", "GPT-5.6 Terra"],
  "gpt-5.6-luna": ["6181", "GPT-5.6 Luna"], "gpt-5.5": ["6161", "GPT-5.5"], "gpt-5.4": ["6139", "GPT-5.4"],
  "gpt-5.4-mini": ["6150", "GPT-5.4 mini"], "gpt-5.4-nano": ["6151", "GPT-5.4 nano"], "gpt-5.3": ["6138", "GPT-5.3"],
  "gpt-5.2": ["6112", "GPT-5.2"], "gpt-5.1": ["6103", "GPT-5.1"], "gpt-5": ["6068", "GPT-5"],
  "gpt-5-mini": ["6069", "GPT-5 mini"], "gpt-5-nano": ["6070", "GPT-5 nano"], "gpt-4o": ["4108", "GPT-4o"],
  "o1": ["4337", "o1"], "o3": ["6050", "o3"], "o3-mini": ["4339", "o3-mini"], "o3-mini-high": ["4356", "o3 Mini High"],
  "o4-mini": ["4358", "o4 Mini"],
  "gemini-4-argon": ["6259", "Gemini 4 Argon"], "gemini-3.8-flash": ["6227", "Gemini 3.8 Flash"],
  "gemini-3.7-flash": ["6211", "Gemini 3.7 Flash"], "gemini-3.6-flash": ["6187", "Gemini 3.6 Flash"],
  "gemini-3.5-flash": ["6169", "Gemini 3.5 Flash"], "gemini-3.5-flash-lite": ["6188", "Gemini 3.5 Flash Lite"],
  "gemini-3.1-pro": ["6134", "Gemini 3.1 Pro"], "gemini-3.1-flash-lite": ["6137", "Gemini 3.1 Flash Lite"],
  "gemini-3-pro": ["6104", "Gemini 3 Pro"], "gemini-3-flash": ["6113", "Gemini 3 Flash"],
  "grok-4.7": ["6240", "Grok 4.7"], "grok-4.6": ["6209", "Grok 4.6"], "grok-4.3": ["6167", "Grok 4.3"],
  "muse-wonder": ["6256", "Muse Wonder"], "muse-spark-1.3": ["6226", "Muse Spark 1.3"], "muse-spark-1.2": ["6203", "Muse Spark 1.2"],
  "glm-5.3": ["6212", "GLM-5.3"], "glm-5.3-flash": ["6216", "GLM-5.3 Flash"], "glm-5.2": ["6186", "GLM-5.2"], "glm-5.1": ["6168", "GLM-5.1"],
  "kimi-k3": ["6185", "Kimi K3"], "kimi-k2.6": ["6159", "Kimi K2.6"], "kimi-k2.5": ["6129", "Kimi K2.5"],
  "deepseek-v4.1-flash": ["6235", "DeepSeek V4.1 Flash"], "deepseek-v4-pro": ["6163", "DeepSeek V4 Pro"],
  "deepseek-v4-flash": ["6162", "DeepSeek V4 Flash"], "qwen3.8-max": ["6191", "Qwen3.8 Max"],
  "qwen3.8-flash": ["6217", "Qwen3.8 Flash"], "agnes-2.5-flash": ["6237", "Agnes 2.5 Flash"],
  "perplexity": ["4372", "Perplexity (search)"],
};
const WEBSITE_ALIASES = { sonar: "perplexity" };
const UA = "glbgpt-mcp-worker/2.0 (cloudflare-workers)";
const SERVER_INFO = { name: "glbgpt-mcp", version: "2.0.0" };
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const LIMIT_TIMEZONE = "Europe/Berlin"; // the daily credit counter resets at midnight here
const WAIT_MS = 40000; // how long one generate/check call waits for a result before returning
const POLL_MS = 5000; // the API asks for 5-10 s between polls
const DEFAULT_CHAT_MODEL = "gpt-5.6-sol";

const INSTRUCTIONS = [
  "Chat with GlobalGPT's models and generate images, videos and audio with the owner's GlobalGPT account.",
  "Generation spends the owner's credits: generate only what the user asked for, and never retry a failed video on your own.",
  "Pick a model with glbgpt_list_models (it lists every model with its price and parameters); glbgpt_list_models with model set shows one model's parameters.",
  "Results are returned as URLs, valid for 30 days. If a generate call returns status 'queued' or 'processing', call glbgpt_check_task with the task_id right away and keep calling it until it succeeds or fails; the server waits inside each call.",
  "Images go in as public https URLs or data: URIs.",
].join(" ");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
class ToolError extends Error {}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...extra } });
}

function timingSafeEqual(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const isRef = (v) => typeof v === "string" && /^(https?:|data:)/i.test(v);

// The API's error envelope: {"error": {"message", "type", "code"}} with a real HTTP status.
const ERROR_MESSAGES = {
  missing_api_key: "GlobalGPT rejected the API key. Check GLBGPT_API_KEY on the Worker (create a new key under API Keys on glbgpt.com).",
  invalid_api_key: "GlobalGPT rejected the API key. Check GLBGPT_API_KEY on the Worker (create a new key under API Keys on glbgpt.com).",
  insufficient_credit: "Not enough paid credits on the GlobalGPT account.",
  paid_only_channel: "The GlobalGPT API only spends paid credits, and the account has none available.",
  plan_required: "This model isn't included in the GlobalGPT plan.",
  idempotency_in_progress: "The same request is still being processed; check again in a moment.",
};
function apiError(status, body, retryAfter) {
  const e = body?.error ?? {};
  const code = str(e.code) ?? str(e.type) ?? "";
  const msg = str(e.message) ?? (typeof body?.message === "string" ? body.message : "");
  if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code] + (msg && !/key/i.test(code) ? ` (${msg})` : "");
  if (status === 401) return ERROR_MESSAGES.invalid_api_key;
  if (status === 429) return `GlobalGPT's rate limit was hit (60 requests/min, 10 media tasks at once)${retryAfter ? `; retry in ${retryAfter} s` : ""}.`;
  if (status === 404) return msg || "Not found: unknown or retired model, or a task id that isn't yours. glbgpt_list_models shows the current models.";
  if (status === 502) return `The model provider failed or has no capacity right now; try again or pick another model.${msg ? ` (${msg})` : ""}`;
  return `GlobalGPT error ${status}${code ? ` ${code}` : ""}${msg ? `: ${msg}` : ""}`;
}

const TASK_ERRORS = {
  invalid_input: "The provider rejected the input (an unreachable image URL, an unsupported combination, or e.g. no face found).",
  content_policy_violation: "Blocked by the provider's safety policy or real-person likeness rule.",
  rate_limited: "The provider is busy; it's safe to submit again in a moment.",
  provider_unavailable: "The provider had an outage; submit again later.",
  generation_failed: "The generation failed.",
};

// ---------------------------------------------------------------------------
// GlobalGPT API client
// ---------------------------------------------------------------------------
class GlobalGPT {
  constructor(env) {
    if (!env.GLBGPT_API_KEY) throw new ToolError("GLBGPT_API_KEY is not set on the Worker.");
    this.key = env.GLBGPT_API_KEY;
  }
  async request(method, path, body, headers = {}) {
    let res;
    try {
      res = await fetch(API + path, {
        method,
        headers: {
          Authorization: `Bearer ${this.key}`, "User-Agent": UA,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new ToolError(`Couldn't reach GlobalGPT: ${e && e.message}`);
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) {
      const err = new ToolError(apiError(res.status, data, res.headers.get("Retry-After")));
      err.status = res.status;
      err.code = data?.error?.code ?? data?.error?.type;
      throw err;
    }
    if (data === null) throw new ToolError(`GlobalGPT answered HTTP ${res.status} without JSON. Try again in a moment.`);
    return data;
  }
  models(type) { return this.request("GET", `/models${type ? `?type=${encodeURIComponent(type)}` : ""}`); }
  model(id) { return this.request("GET", `/models/${encodeURIComponent(id)}`); }
  estimate(body) { return this.request("POST", "/tasks/estimate", body); }
  task(id) { return this.request("GET", `/tasks/${encodeURIComponent(id)}`); }
  tasks(limit) { return this.request("GET", `/tasks?limit=${limit}`); }
  // The Idempotency-Key makes a retry after a network error safe: it can't create (or charge) a second task.
  async submit(body) {
    const headers = { "Idempotency-Key": crypto.randomUUID() };
    try {
      return await this.request("POST", "/tasks", body, headers);
    } catch (e) {
      if (!/Couldn't reach/.test(e.message)) throw e;
      await sleep(1000);
      return this.request("POST", "/tasks", body, headers);
    }
  }
  chat(body) { return this.request("POST", "/chat/completions", { ...body, stream: false }); }
}

// The website's own chat endpoint, signed with the GlobalGPT login token. It takes one query (no
// system role or images) and streams the answer as SSE "message" events. Each call becomes a
// conversation in the owner's chat history on glbgpt.com.
async function websiteChat(env, agentId, query) {
  if (!env.GLBGPT_TOKEN) throw new ToolError("This chat model is only on GlobalGPT's website, which needs GLBGPT_TOKEN (your login token) on the Worker.");
  let res;
  try {
    res = await fetch(WEB_CHAT, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.GLBGPT_TOKEN}`, "Content-Type": "application/json", Accept: "text/event-stream", "User-Agent": UA },
      body: JSON.stringify({
        device: { deviceType: "pc" },
        inputs: { thinking_patch: true, enableImages: false, deep_research: false, study: false, enableDeepThink: false },
        enableSearch: false, agentId, query, conversationId: "", parentMessageId: "", files: [], chatTaskId: crypto.randomUUID(),
      }),
    });
  } catch (e) {
    throw new ToolError(`Couldn't reach GlobalGPT's website: ${e && e.message}`);
  }
  const ctype = res.headers.get("content-type") || "";
  if (!ctype.includes("text/event-stream")) {
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch {}
    throw new ToolError(websiteError(res.status, body) ?? `GlobalGPT's website answered HTTP ${res.status}: ${(str(body?.message) ?? text).slice(0, 200)}`);
  }
  let answer = "", usage, buffer = "";
  const decoder = new TextDecoder();
  const handle = (line) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let ev;
    try { ev = JSON.parse(data); } catch { return; }
    const err = websiteError(200, ev);
    if (err) throw new ToolError(err);
    if (ev.event === "message" || ev.event === "agent_message") answer += typeof ev.answer === "string" ? ev.answer : "";
    if (ev.event === "message_end" && ev.metadata?.usage) usage = { prompt_tokens: ev.metadata.usage.prompt_tokens, completion_tokens: ev.metadata.usage.completion_tokens };
    if (ev.event === "error") throw new ToolError(`The model reported an error: ${str(ev.message) ?? "unknown"}`);
  };
  for await (const bytes of res.body) {
    buffer += decoder.decode(bytes, { stream: true });
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      handle(buffer.slice(0, i).trim());
      buffer = buffer.slice(i + 1);
    }
  }
  handle(buffer.trim());
  return { answer, usage };
}

// The website's business errors come as {code, message} (HTTP 200); null when the body is a normal event.
function websiteError(status, body) {
  const code = typeof body?.code === "number" ? body.code : status >= 400 ? status : null;
  if (code === null || code === 1 || code === 200) return null;
  if (code === 401 || code === 403) return "GlobalGPT's website rejected the login token (expired or wrong). Run `npx @glbgpt/cli login` again and update GLBGPT_TOKEN on the Worker.";
  if (code === 402) return PAYMENT_MESSAGES[body?.data?.subCode] ?? (str(body?.message) || "The plan or credits don't cover this model.");
  if (code === 429) return "GlobalGPT's website says too many requests; wait a moment and try again.";
  return `GlobalGPT's website refused the chat (code ${code}${str(body?.message) ? `: ${body.message}` : ""}).`;
}
const PAYMENT_MESSAGES = {
  4002: "Insufficient credit balance.",
  4003: "The plan's credits for the current period are used up.",
  4004: "The plan isn't active for this period yet.",
  4009: "This model requires a PRO plan.",
  4010: "This model requires an Unlimited plan.",
};

const websiteModel = (id) => {
  const key = String(id || "").trim().toLowerCase();
  const k = WEBSITE_ALIASES[key] ?? key;
  return WEBSITE_CHAT_MODELS[k] ? { id: k, agentId: WEBSITE_CHAT_MODELS[k][0], name: WEBSITE_CHAT_MODELS[k][1] } : null;
};
const isModelMissing = (e) => e instanceof ToolError && e.status === 404;

// ---------------------------------------------------------------------------
// Daily credit limit (KV counter per day in LIMIT_TIMEZONE)
// ---------------------------------------------------------------------------
// DAILY_CREDIT_LIMIT: not set -> no limit; a number -> at most that many credits per day.
// Anything else is refused rather than guessed, so a typo never silently removes the limit.
function dailyLimit(env) {
  const raw = String(env.DAILY_CREDIT_LIMIT ?? "").trim();
  if (!raw) return { limit: null };
  const n = Number(raw.replace(/[_,.'\s]/g, ""));
  if (Number.isSafeInteger(n) && n >= 0) return { limit: n };
  return { limit: 0, invalid: raw };
}

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: LIMIT_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

class CreditLimit {
  constructor(env) {
    const { limit, invalid } = dailyLimit(env);
    this.limit = limit;
    this.invalid = invalid;
    this.kv = env.CREDITS;
    this.key = `spent:${today()}`;
  }
  // Fail before pricing anything when generation can't run at all.
  check() {
    if (this.invalid !== undefined) throw new ToolError(`DAILY_CREDIT_LIMIT on the Worker is "${this.invalid}", which isn't a number. Set a number of credits, or delete the variable for no limit.`);
    if (this.limit === 0) throw new ToolError("Generation is blocked: DAILY_CREDIT_LIMIT on the Worker is 0.");
    if (this.limit !== null && !this.kv) throw new ToolError("DAILY_CREDIT_LIMIT is set, but the CREDITS KV namespace isn't bound to the Worker, so today's spend can't be counted. Bind it, or delete DAILY_CREDIT_LIMIT.");
  }
  async spent() {
    if (!this.kv) return null;
    return Number((await this.kv.get(this.key)) || 0);
  }
  async reserve(credits) {
    this.check();
    if (!this.kv) return 0; // no limit and no counter
    if (this.limit !== null) {
      const spent = await this.spent();
      if (spent + credits > this.limit) {
        throw new ToolError(
          `Daily limit reached: this costs ~${credits} credits and ${spent} of today's ${this.limit} are used. ` +
          `It resets at midnight (${LIMIT_TIMEZONE}). The owner can raise DAILY_CREDIT_LIMIT on the Worker, or delete it for no limit.`
        );
      }
    }
    await this.add(credits); // counted even without a limit, so glbgpt_usage can show today's spend
    return credits;
  }
  async add(credits) {
    const next = Math.max(0, ((await this.spent()) || 0) + credits);
    await this.kv.put(this.key, String(next), { expirationTtl: 3 * 86400 });
    return next;
  }
  // Remember what a task was counted at, so a failed task (whose credits GlobalGPT releases) is taken off again.
  async remember(taskId, credits) {
    if (this.kv && credits) await this.kv.put(`task:${taskId}`, JSON.stringify({ c: credits, d: this.key }), { expirationTtl: 3 * 86400 });
  }
  async release(taskId) {
    if (!this.kv) return;
    const rec = await this.kv.get(`task:${taskId}`);
    if (!rec) return;
    await this.kv.delete(`task:${taskId}`);
    const { c, d } = JSON.parse(rec);
    if (d === this.key) await this.add(-c); // only today's counter; yesterday's is history
  }
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    name: "glbgpt_chat",
    title: "GlobalGPT chat",
    description: "Ask one of GlobalGPT's chat models a single question and get the answer. Optionally set a system prompt, choose a model, attach images for the model to see, or pass a JSON Schema (response_schema) to get JSON back. glbgpt_list_models with type chat lists the models and their prices; models marked source 'website' work too, but without images.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", minLength: 1, description: "The question or instruction for the model." },
        system: { type: "string", description: "Optional system prompt." },
        model: { type: "string", description: `Chat model id (default ${DEFAULT_CHAT_MODEL}).` },
        images: { type: "array", items: { type: "string" }, maxItems: 10, description: "Images for the model to see: public https URLs or data: URIs." },
        response_schema: { type: "object", description: "Optional JSON Schema; the answer is then JSON matching it." },
        reasoning_effort: { type: "string", enum: ["none", "low", "medium", "high"], description: "For reasoning models. Omit for the model's default." },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "glbgpt_generate",
    title: "GlobalGPT generation (image, video, audio)",
    description: "Generate an image, video or audio clip (speech, music), or run an image tool (remove-bg, hd-upscale, face-swap, ...). Spends credits from the owner's GlobalGPT account; the price is checked first, and the owner may have set a daily credit limit. Parameters depend on the model: see glbgpt_list_models. Fields a model doesn't take are dropped and listed in ignored_parameters. Returns the finished url, or a task_id for glbgpt_check_task.",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string", minLength: 1, description: "Model id from glbgpt_list_models, e.g. nano-banana-2.1 (image), kling-v3 (video), eleven_v4 (speech)." },
        prompt: { type: "string", description: "Text prompt. Required for most models; optional for image tools." },
        images: { type: "array", items: { type: "string" }, maxItems: 14, description: "Input or reference images: public https URLs or data: URIs. Order matters for two-image tools (face-swap: face, target; virtual-tryon: person, garment)." },
        video_url: { type: "string", description: "Source or reference video URL, for models that take one." },
        aspect_ratio: { type: "string", description: "e.g. 1:1, 16:9, 9:16. Set only if the user asks." },
        resolution: { type: "string", description: "One of the model's values, e.g. 1K, 2K, 720p. Changes the price." },
        duration: { type: "integer", description: "Video or audio length in seconds. Changes the price." },
        seed: { type: "integer", description: "Set only if the user gives a seed." },
        negative_prompt: { type: "string", description: "What to avoid, for models that take it." },
        watermark: { type: "boolean", description: "Provider watermark on/off where offered." },
        audio: { type: "boolean", description: "Generate sound with the video (some video models). Changes the price." },
        draft: { type: "boolean", description: "flux-3-video only: cheaper draft render." },
        metadata: { type: "object", description: "Model-specific extras listed for the model (e.g. metadata.output_format)." },
      },
      required: ["model"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "glbgpt_check_task",
    title: "Check a GlobalGPT generation",
    description: "Check a generation by task_id. Each call waits up to 40 seconds for the result; if it is still queued or processing, call it again right away until you get the url or a failure reason.",
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string", minLength: 1, description: "The task_id from glbgpt_generate." } },
      required: ["task_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "glbgpt_list_models",
    title: "List GlobalGPT models",
    description: "List GlobalGPT's models with prices and accepted parameters, filtered by type (chat, image, video, audio). With model set, returns that one model's full details and parameters.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["chat", "image", "video", "audio"], description: "Only list this kind of model." },
        model: { type: "string", description: "Show one model's details instead of a list." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "glbgpt_usage",
    title: "GlobalGPT usage",
    description: "This connector's daily credit limit and today's spend, plus the most recent generations on the GlobalGPT account with their status and credits.",
    inputSchema: {
      type: "object",
      properties: { recent: { type: "integer", minimum: 0, maximum: 50, description: "How many recent generations to show (default 10)." } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
];

const MEDIA_FIELDS = ["prompt", "images", "video_url", "aspect_ratio", "resolution", "duration", "seed", "negative_prompt", "watermark", "audio", "draft", "metadata"];

function buildTaskBody(a) {
  const model = str(a.model);
  if (!model) throw new ToolError("model is required; see glbgpt_list_models.");
  const body = { model };
  for (const f of MEDIA_FIELDS) if (a[f] !== undefined && a[f] !== null && a[f] !== "") body[f] = a[f];
  if (typeof body.prompt === "string") body.prompt = body.prompt.trim();
  if (body.images !== undefined) {
    if (!Array.isArray(body.images)) throw new ToolError("images must be a list of URLs.");
    const bad = body.images.find((r) => !isRef(r));
    if (bad !== undefined) throw new ToolError(`images must be public https URLs or data: URIs (got ${String(bad).slice(0, 80)}).`);
  }
  if (body.video_url !== undefined && !/^https?:/i.test(body.video_url)) throw new ToolError("video_url must be a public https URL.");
  if (body.metadata !== undefined && (typeof body.metadata !== "object" || Array.isArray(body.metadata))) throw new ToolError("metadata must be an object.");
  return body;
}

// The task object as the assistant needs it.
function taskView(t) {
  const out = { task_id: String(t.id ?? ""), status: t.status, model: t.model, type: t.type };
  if (t.output?.url) out.url = t.output.url;
  if (t.credits_reserved !== undefined) out.credits = t.credits_reserved;
  if (t.ignored_parameters && Object.keys(t.ignored_parameters).length) out.ignored_parameters = t.ignored_parameters;
  return out;
}

// Poll a task until it finishes or the deadline passes.
async function waitForTask(g, limit, taskId, deadline, first) {
  let t = first;
  for (;;) {
    if (!t) {
      try {
        t = await g.task(taskId);
      } catch (e) {
        if (/rate limit|Not found|API key/i.test(e.message)) throw e;
        return { task_id: taskId, status: "processing", note: "Couldn't reach GlobalGPT just now. Call glbgpt_check_task again." };
      }
    }
    if (t.status === "succeeded") {
      if (!t.output?.url) throw new ToolError("The task succeeded but returned no URL.");
      await limit.kv?.delete(`task:${taskId}`).catch(() => {});
      return taskView(t);
    }
    if (t.status === "failed") {
      await limit.release(taskId).catch(() => {}); // GlobalGPT released the credits, so do we
      const code = t.error?.code;
      const why = TASK_ERRORS[code] ?? "The generation failed.";
      throw new ToolError(`${why}${str(t.error?.message) ? ` (${t.error.message.slice(0, 200)})` : ""} No credits were charged.`);
    }
    if (Date.now() + POLL_MS > deadline) {
      return {
        ...taskView(t),
        note: "Still running. Call glbgpt_check_task with this task_id again right away (the server waits inside each call). Don't tell the user it's done yet.",
      };
    }
    await sleep(POLL_MS);
    t = null;
  }
}

async function generate(ctx, a) {
  const g = new GlobalGPT(ctx.env);
  const body = buildTaskBody(a);
  const limit = new CreditLimit(ctx.env);
  limit.check();

  const est = await g.estimate(body);
  const estimate = Math.max(0, Number(est?.credits) || 0);
  const reserved = await limit.reserve(estimate);

  let task;
  try {
    task = await g.submit(body);
  } catch (e) {
    if (reserved) await limit.add(-reserved).catch(() => {}); // nothing was created, nothing charged
    throw e;
  }
  // Count what GlobalGPT actually reserved, if it differs from the estimate.
  const actual = Number(task.credits_reserved);
  if (reserved && Number.isFinite(actual) && actual !== estimate) await limit.add(actual - estimate).catch(() => {});
  const counted = reserved ? (Number.isFinite(actual) ? actual : estimate) : 0;
  if (task.id !== undefined) await limit.remember(String(task.id), counted).catch(() => {});

  const result = await waitForTask(g, limit, String(task.id), Date.now() + WAIT_MS, task);
  return { ...result, credits_estimated: estimate, ...(est?.billing_model ? { billing_tier: est.billing_model } : {}) };
}

// Strip ```json fences or prose around a JSON answer.
function parseJsonAnswer(text) {
  const t = String(text ?? "").trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  for (const c of [t, fenced?.[1], t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)]) {
    if (!c) continue;
    try { return JSON.parse(c); } catch {}
  }
  throw new ToolError(`The model didn't return valid JSON. Its answer began: ${t.slice(0, 200)}`);
}

const list = (data) => (Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : []);

const handlers = {
  async glbgpt_chat(ctx, a) {
    const g = new GlobalGPT(ctx.env);
    const prompt = str(a.prompt);
    if (!prompt) throw new ToolError("prompt is required.");
    const images = Array.isArray(a.images) ? a.images : [];
    if (images.some((r) => !isRef(r))) throw new ToolError("images must be public https URLs or data: URIs.");
    const schema = a.response_schema && typeof a.response_schema === "object" ? a.response_schema : null;
    const system = [
      str(a.system),
      schema && "Respond ONLY with a single JSON object that conforms to the following JSON Schema. No prose, no markdown code fences, nothing before or after the JSON.\n" + JSON.stringify(schema),
    ].filter(Boolean).join("\n\n");
    const messages = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({
      role: "user",
      content: images.length ? [{ type: "text", text: prompt }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))] : prompt,
    });
    const model = str(a.model) ?? DEFAULT_CHAT_MODEL;
    const req = { model, messages, ...(a.reasoning_effort ? { reasoning_effort: a.reasoning_effort } : {}) };
    let res;
    try {
      if (schema) {
        // JSON mode where the model supports it; otherwise the instruction in the system prompt carries it.
        try {
          res = await g.chat({ ...req, response_format: { type: "json_object" } });
        } catch (e) {
          if (isModelMissing(e) || !/error 400|provider/i.test(e.message)) throw e;
          res = await g.chat(req);
        }
      } else res = await g.chat(req);
    } catch (e) {
      const web = isModelMissing(e) ? websiteModel(model) : null;
      if (!web) throw e;
      // Not in the API, but on the website: same question through the website's chat.
      if (images.length) throw new ToolError(`${web.name} is only on GlobalGPT's website, where this connector can't attach images. Ask without images, or pick an API model (glbgpt_list_models).`);
      const query = [system, prompt].filter(Boolean).join("\n\n");
      const out = await websiteChat(ctx.env, web.agentId, query);
      if (schema) return parseJsonAnswer(out.answer);
      if (!out.answer) throw new ToolError(`${web.name} returned an empty answer. Try again.`);
      return { model: web.id, answer: out.answer, via: "website", ...(out.usage ? { usage: out.usage } : {}) };
    }
    const answer = res?.choices?.[0]?.message?.content ?? "";
    const usage = res?.usage ? { prompt_tokens: res.usage.prompt_tokens, completion_tokens: res.usage.completion_tokens } : undefined;
    if (schema) return parseJsonAnswer(answer);
    if (!answer && res?.choices?.[0]?.finish_reason === "length") throw new ToolError("The model used up its output budget before answering (reasoning models think first). Try again, or a lower reasoning_effort.");
    return { model: res?.model ?? model, answer, ...(usage ? { usage } : {}) };
  },
  glbgpt_generate: (ctx, a) => generate(ctx, a),
  async glbgpt_check_task(ctx, a) {
    const taskId = str(a.task_id);
    if (!taskId) throw new ToolError("task_id is required.");
    return waitForTask(new GlobalGPT(ctx.env), new CreditLimit(ctx.env), taskId, Date.now() + WAIT_MS);
  },
  async glbgpt_list_models(ctx, a) {
    const g = new GlobalGPT(ctx.env);
    const websiteEntry = (w) => ({
      id: w.id, type: "chat", source: "website", description: `${w.name} (only on GlobalGPT's website: text in, text out, no images; each chat shows up in the owner's glbgpt.com history)`,
    });
    if (str(a.model)) {
      try {
        return await g.model(str(a.model));
      } catch (e) {
        const w = isModelMissing(e) ? websiteModel(a.model) : null;
        if (!w) throw e;
        return { ...websiteEntry(w), available: !!ctx.env.GLBGPT_TOKEN };
      }
    }
    const models = list(await g.models(a.type));
    // Chat models the API doesn't list but the website has, when the login token is set.
    if (ctx.env.GLBGPT_TOKEN && (!a.type || a.type === "chat")) {
      const have = new Set(models.map((m) => String(m.id).toLowerCase()));
      for (const id of Object.keys(WEBSITE_CHAT_MODELS)) if (!have.has(id)) models.push(websiteEntry(websiteModel(id)));
    }
    return { count: models.length, models };
  },
  async glbgpt_usage(ctx, a) {
    const limit = new CreditLimit(ctx.env);
    const n = Number.isInteger(a.recent) ? a.recent : 10;
    let recent;
    if (n > 0) {
      try {
        recent = list(await new GlobalGPT(ctx.env).tasks(n)).map(taskView);
      } catch (e) {
        recent = `Couldn't load recent generations: ${e.message}`;
      }
    }
    return {
      daily_limit: limit.invalid !== undefined ? `invalid value "${limit.invalid}"` : limit.limit === null ? "none" : limit.limit,
      spent_today_via_connector: await limit.spent(),
      limit_resets: `midnight ${LIMIT_TIMEZONE}`,
      ...(recent !== undefined ? { recent } : {}),
      balance: "GlobalGPT's API doesn't report the credit balance; see the Usage page on glbgpt.com.",
    };
  },
};

// ---------------------------------------------------------------------------
// MCP plumbing (same as discord-mcp)
// ---------------------------------------------------------------------------
async function handleRpc(msg, ctx) {
  const isNotification = msg.id === undefined || msg.id === null;
  const reply = (result) => (isNotification ? null : { jsonrpc: "2.0", id: msg.id, result });
  const fail = (code, message) => (isNotification ? null : { jsonrpc: "2.0", id: msg.id, error: { code, message } });
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(-32600, "Invalid request");
  switch (msg.method) {
    case "initialize": {
      const asked = msg.params && msg.params.protocolVersion;
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call": {
      const name = msg.params && msg.params.name;
      const handler = Object.hasOwn(handlers, name) ? handlers[name] : null;
      if (!handler) return fail(-32602, `Unknown tool: ${name}`);
      try {
        const result = await handler(ctx, (msg.params && msg.params.arguments) || {});
        return reply({
          content: [{ type: "text", text: JSON.stringify(result, null, 1) }],
          structuredContent: Array.isArray(result) ? { items: result } : result,
          isError: false,
        });
      } catch (e) {
        const text = e instanceof ToolError ? e.message : `Unexpected error: ${e && e.message}`;
        return reply({ content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      if (msg.method.startsWith("notifications/")) return null;
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

async function handleMcp(request, env) {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }
  const ctx = { env, request };
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleRpc(m, ctx)))).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202 });
  }
  const out = await handleRpc(body, ctx);
  return out ? json(out) : new Response(null, { status: 202 });
}

function headerSecret(request) {
  const auth = request.headers.get("Authorization");
  const bearer = auth && auth.match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();
  const key = request.headers.get("X-API-Key");
  return key ? key.trim() : null;
}

const urlSecretDisabled = (env) => /^(1|true|yes|on)$/i.test(String(env.DISABLE_URL_SECRET || "").trim());

async function handleHealth(env) {
  const fp = async (v) => {
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
    return [...h.slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  const info = (v) => ({ set: !!v, length: v ? v.length : 0 });
  const secret = env.CONNECTOR_SECRET;
  const { limit, invalid } = dailyLimit(env);
  return json({
    CONNECTOR_SECRET: {
      ...info(secret),
      url_safe: !!secret && /^[A-Za-z0-9_-]+$/.test(secret),
      long_enough: !!secret && secret.length >= 32,
      sha256_first8: secret ? await fp(secret) : null,
    },
    GLBGPT_API_KEY: { ...info(env.GLBGPT_API_KEY), looks_right: !!env.GLBGPT_API_KEY && env.GLBGPT_API_KEY.startsWith("sk-glb-") },
    GLBGPT_TOKEN: { ...info(env.GLBGPT_TOKEN), used_for: "website-only chat models", looks_like_jwt: !!env.GLBGPT_TOKEN && env.GLBGPT_TOKEN.split(".").length === 3 },
    DAILY_CREDIT_LIMIT: invalid !== undefined ? "invalid (not a number): generation blocked" : limit === null ? "not set: no limit" : limit,
    CREDITS_kv_bound: !!env.CREDITS,
    secret_in_url: urlSecretDisabled(env) ? "disabled" : "enabled",
  });
}

export default {
  async fetch(request, rawEnv) {
    const clean = (v) => (typeof v === "string" ? v.trim() : v);
    const env = {
      ...rawEnv,
      CONNECTOR_SECRET: clean(rawEnv.CONNECTOR_SECRET),
      GLBGPT_API_KEY: clean(rawEnv.GLBGPT_API_KEY)?.replace(/^Bearer\s+/i, "").replace(/^"|"$/g, ""),
      GLBGPT_TOKEN: clean(rawEnv.GLBGPT_TOKEN)?.replace(/^Bearer\s+/i, "").replace(/^"|"$/g, ""),
    };
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") return handleHealth(env);
    const secretOk = (given) => !!given && !!env.CONNECTOR_SECRET && env.CONNECTOR_SECRET.length >= 32 && timingSafeEqual(given, env.CONNECTOR_SECRET);
    if (/^\/mcp\/?$/.test(url.pathname) && secretOk(headerSecret(request))) return handleMcp(request, env);
    const m = url.pathname.match(/^\/mcp\/([^/]+)\/?$/);
    if (m && !urlSecretDisabled(env) && secretOk(m[1])) return handleMcp(request, env);
    return new Response("Not found", { status: 404 });
  },
};
