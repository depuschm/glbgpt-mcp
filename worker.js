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
const WEBSITE_ALIASES = { sonar: "perplexity", "deepresearch": "deep-research" };
// Website workflow agents reached like chat models (through /dify-api); they can run for minutes.
const WEBSITE_AGENTS = { "deep-research": { agentId: "4341", name: "Deep Research", prefix: "/dify-api" } };
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
// opts.prefix: "/ai-api" (chat models) or "/dify-api" (the website's workflow agents: Deep Research, AI Translate, ...).
async function websiteChat(env, agentId, query, opts = {}) {
  if (!env.GLBGPT_TOKEN) throw new ToolError("This chat model is only on GlobalGPT's website, which needs GLBGPT_TOKEN (your login token) on the Worker.");
  let res;
  try {
    res = await fetch(opts.prefix ? `https://api2.glbgpt.com${opts.prefix}/ai/agent/chatStream` : WEB_CHAT, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.GLBGPT_TOKEN}`, "Content-Type": "application/json", Accept: "text/event-stream", "User-Agent": UA },
      body: JSON.stringify({
        device: { deviceType: "pc" },
        productNo: "glbgpt", // some agents refuse the call without it ("invalid product no null")
        inputs: { ...(opts.prefix === "/dify-api" ? {} : { thinking_patch: true }), enableImages: false, deep_research: false, study: false, enableDeepThink: false, ...(opts.inputs || {}) },
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
  let answer = "", usage, buffer = "", raw = "";
  const seen = new Set();
  const decoder = new TextDecoder();
  const handle = (line) => {
    if (raw.length < 1500 && line) raw += line.slice(0, 300) + "\n";
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let ev;
    try { ev = JSON.parse(data); } catch { return; }
    seen.add(String(ev.event ?? ev.type ?? "?"));
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
  answer = answer.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim(); // some models stream their reasoning inline
  return { answer, usage, debug: answer ? undefined : { events: [...seen], start: raw.slice(0, 1200) } };
}

// The website's business errors come as {code, message} (HTTP 200); null when the body is a normal event.
function websiteError(status, body) {
  const code = typeof body?.code === "number" ? body.code : status >= 400 ? status : null;
  if (code === null || code === 1 || code === 200) return null;
  if (code === 401 || code === 403) return "GlobalGPT's website rejected the login token (expired or wrong). Run `npx @glbgpt/cli login` again and update GLBGPT_TOKEN on the Worker.";
  if (code === 402) return PAYMENT_MESSAGES[body?.data?.subCode] ?? (str(body?.message) || "The plan or credits don't cover this model.");
  if (code === 429) return "GlobalGPT's website says too many requests; wait a moment and try again.";
  return `GlobalGPT's website refused the request (code ${code}${str(body?.message) ? `: ${body.message}` : ""}).`;
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
  if (WEBSITE_AGENTS[k]) return { id: k, ...WEBSITE_AGENTS[k] };
  return WEBSITE_CHAT_MODELS[k] ? { id: k, agentId: WEBSITE_CHAT_MODELS[k][0], name: WEBSITE_CHAT_MODELS[k][1] } : null;
};
const isModelMissing = (e) => e instanceof ToolError && e.status === 404;

// ---------------------------------------------------------------------------
// Website-only media models (images, videos, video tools, 3D, speech to text)
// ---------------------------------------------------------------------------
// Request formats read from glbgpt.com's page code on 21 Oct 2026. Each entry builds the body for
// the website's own endpoint; `credits` is the website's listed price (approximate for videos).
// Used only when the API doesn't know the model id.
const WEB = "https://api2.glbgpt.com";
const first = (a) => (Array.isArray(a.images) ? a.images : []);
const meta = (a) => (a.metadata && typeof a.metadata === "object" ? a.metadata : {});
const secs = (a, d) => (Number.isInteger(a.duration) && a.duration > 0 ? a.duration : d);
const perSecond = (rate, d) => (a) => Math.round(rate * secs(a, d));
const resOf = (a, d) => String(a.resolution || d);
// Any metadata key is passed on to the website's request, so every field its own form sends can be set.
// Fields the connector sets itself (routing, billing, the enhance toggle) can't be overridden this way.
const PASS_RESERVED = new Set(["agentId", "productNo", "shareStatus", "enhancePrompt", "enhance_prompt", "action", "task_id"]);
const extras = (a) => Object.fromEntries(Object.entries(meta(a)).filter(([k, v]) => !PASS_RESERVED.has(k) && v !== undefined && v !== null));
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const enhanceOf = (a) => meta(a).enhancePrompt === true || meta(a).enhance_prompt === true;
const oneOf = (name, what, value, allowed) => {
  if (!allowed.map(String).includes(String(value))) throw new ToolError(`${name} takes ${what} ${allowed.join(", ")} (got ${value}).`);
  return value;
};
// AI Poster / Product Images: text blocks are {text, position}; position is top, middle or bottom.
const POSITIONS = ["top", "middle", "bottom"];
function posterTextBlocks(list) {
  const raw = (Array.isArray(list) ? list : list ? [list] : []).filter((b) => b !== "" && b != null);
  if (raw.length > 3) throw new ToolError("AI Poster takes at most 3 text blocks.");
  const defaults = [["top"], ["top", "bottom"], ["top", "middle", "bottom"]][Math.max(0, raw.length - 1)];
  const blocks = raw.map((b, i) => {
    const text = typeof b === "string" ? str(b) : str(b?.text);
    const position = (typeof b === "object" && str(b?.position)) || defaults[i];
    if (!text) throw new ToolError("Each AI Poster text block needs text.");
    oneOf("AI Poster", "text positions", position, POSITIONS);
    return { text, position };
  });
  const per = blocks.reduce((m, b) => ({ ...m, [b.position]: (m[b.position] || 0) + 1 }), {});
  if (Object.values(per).some((n) => n > 2)) throw new ToolError("AI Poster takes at most 2 text blocks per position.");
  if (blocks.length === 3 && Object.keys(per).length < 2) throw new ToolError("With 3 AI Poster text blocks, use at least 2 different positions.");
  return blocks;
}
const LOGO_STYLES = ["auto", "minimalist", "hand-drawn", "geometric", "line-art", "vintage", "abstract"];
const LOGO_INDUSTRIES = ["technology", "ecommerce", "food", "health", "creative", "saas", "hospitality", "education", "nonprofit", "fashion", "realestate", "financial", "media", "manufacturing", "professional"];
// Wan 2.6 takes a pixel size, not a ratio; the website picks it from the ratio and resolution.
const WAN26_SIZES = { "720P": { "16:9": "1280*720", "9:16": "720*1280" }, "1080P": { "16:9": "1920*1080", "9:16": "1080*1920" } };
function wan26Size(a) {
  const ratio = String(a.aspect_ratio || "16:9");
  if (/^\d+\*\d+$/.test(ratio)) return ratio;
  const size = WAN26_SIZES[resOf(a, "720P").toUpperCase()]?.[ratio];
  if (!size) throw new ToolError("Wan 2.6 takes aspect_ratio 16:9 or 9:16 at resolution 720P or 1080P (or a size like 1280*720).");
  return size;
}
// Midjourney: version and aspect go in their own fields; the website strips them from the prompt.
function mjPrompt(a) {
  let prompt = String(a.prompt || "");
  const take = (flag) => {
    const m = prompt.match(new RegExp(`--${flag}\\s+(\\S+)`));
    prompt = prompt.replace(new RegExp(`--${flag}\\s+\\S+`, "g"), "").replace(/\s{2,}/g, " ").trim();
    return m?.[1];
  };
  const version = String(meta(a).version || take("v") || "8.2");
  take("v");
  const aspect = a.aspect_ratio || take("ar") || "1:1";
  take("ar");
  if (["8", "8.2"].includes(version)) prompt = `${prompt.replace(/--hd\b/gi, "").replace(/\s{2,}/g, " ").trim()} --hd`;
  return { prompt, version, aspect };
}
// Video price tables from the website (credits by resolution and seconds), checked against real charges on 21 Oct 2026.
const range = (from, to, f) => Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [from + i, f(from + i)]));
const PRICE_TABLES = {
  "wan3.0-video-prime": {
    "480P": { 2: 300, 3: 500, 4: 600, 5: 800, 6: 1000, 7: 1100, 8: 1300, 9: 1400, 10: 1600, 11: 1700, 12: 1900, 13: 2100, 14: 2200, 15: 2400, 16: 2500, 17: 2700, 18: 2900, 19: 3000, 20: 3200, 21: 3300, 22: 3500, 23: 3600, 24: 3800, 25: 4000, 26: 4100, 27: 4300, 28: 4400, 29: 4600, 30: 4800 },
    "720P": { 2: 700, 3: 1000, 4: 1300, 5: 1600, 6: 2000, 7: 2300, 8: 2600, 9: 2900, 10: 3300, 11: 3600, 12: 3900, 13: 4200, 14: 4600, 15: 4900, 16: 5200, 17: 5500, 18: 5900, 19: 6200, 20: 6500, 21: 6900, 22: 7200, 23: 7500, 24: 7800, 25: 8200, 26: 8500, 27: 8800, 28: 9100, 29: 9500, 30: 9800 },
    "1080P": { 2: 1300, 3: 2000, 4: 2600, 5: 3300, 6: 3900, 7: 4600, 8: 5200, 9: 5900, 10: 6500, 11: 7200, 12: 7800, 13: 8500, 14: 9100, 15: 9800, 16: 10400, 17: 11100, 18: 11700, 19: 12400, 20: 13100, 21: 13700, 22: 14400, 23: 15000, 24: 15700, 25: 16300, 26: 17000, 27: 17600, 28: 18300, 29: 18900, 30: 19600 },
  },
  "wan-2.7": {
    "720P": { 2: 400, 3: 500, 4: 700, 5: 900, 6: 1000, 7: 1200, 8: 1400, 9: 1500, 10: 1700, 11: 1900, 12: 2000, 13: 2200, 14: 2400, 15: 2500 },
    "1080P": { 2: 500, 3: 800, 4: 1000, 5: 1300, 6: 1500, 7: 1800, 8: 2000, 9: 2300, 10: 2500, 11: 2800, 12: 3000, 13: 3300, 14: 3500, 15: 3800 },
  },
  "kling-o1": {
    "720p": { 5: 1000, 10: 2000 }, "1080p": { 5: 1400, 10: 2800 },
    "720p-v2v": range(3, 10, (s) => 300 * s), "1080p-v2v": range(3, 10, (s) => 400 * s),
  },
  "wan-2.6": {
    "720P": { 5: 900, 10: 1700, 15: 2500 }, "1080P": { 5: 1300, 10: 2500, 15: 3800 },
    "720P-r2v": { 5: 1700, 10: 3400 }, "1080P-r2v": { 5: 2500, 10: 5000 },
  },
  "seedance-1.0-pro": { "": { 5: 2000, 10: 4000 } },
};
// Look the price up; between table steps, round up to the next listed length.
function tablePrice(id, tier, seconds) {
  const t = PRICE_TABLES[id]?.[tier];
  if (!t) return 0;
  const key = Object.keys(t).map(Number).sort((x, y) => x - y).find((k) => k >= seconds) ?? Math.max(...Object.keys(t).map(Number));
  return t[key];
}

// 3D prices that depend on the options (the website's own formula, in credits).
function meshyCredits(a) {
  const m = meta(a);
  let c = m.shouldTexture === false ? 1760 : m.ultraMode ? 3080 : 2640;
  if (m.enableRigging) c += 440;
  if (m.enableRigging && m.enableAnimation) c += 270;
  return c;
}
function tripoCredits(a) {
  const m = meta(a);
  const text = first(a).length === 0;
  const tier = m.texture === false ? "none" : m.textureQuality === "detailed" ? "detailed" : "standard";
  const mult = { none: [1, 1], standard: [2, 1.5], detailed: [3, 2] }[tier][text ? 0 : 1];
  let usd = Math.round(100 * (text ? 0.33 : 0.67) * mult) / 100;
  if (m.geometryQuality === "detailed") usd += 0.67;
  if (m.quad) usd += 0.17;
  return Math.round(1000 * Math.round(100 * usd) / 100);
}

const hidream = (agentId, model, name, credits, { edit = false, noImages = false } = {}) => ({
  name, type: "image", agentId, path: "/ai-api/ai/hidream/task/submit", credits: () => credits,
  body: (a) => ({ model, prompt: a.prompt, ...(edit ? {} : { aspectRatio: a.aspect_ratio, resolution: a.resolution }), images: noImages ? [] : first(a).slice(0, edit ? 1 : 3) }),
});
const ideogram3 = (agentId, model, name, credits) => ({
  name, type: "image", agentId, path: "/ai-api/ai/ideogram3/task/submit", credits: () => credits,
  wrap: "image_request",
  // Like the website: a style preset goes with style_type AUTO.
  body: (a) => {
    const m = meta(a);
    return { image_request: { aspect_ratio: a.aspect_ratio || "1:1", prompt: a.prompt, model, style_type: m.style_preset ? "AUTO" : m.style_type || "AUTO", ...(m.style_preset ? { style_preset: m.style_preset } : {}), negative_prompt: a.negative_prompt || "" } };
  },
});
const anywhere = (agentId, model, name, maxImages, credits) => ({
  name, type: "image", agentId, path: "/ai-api/ai/anywhere-image/task/submit", credits,
  body: (a) => {
    const images = first(a).slice(0, maxImages);
    const mai = model.startsWith("mai-");
    return { model, prompt: a.prompt, images, ...(!mai || !images.length ? { aspectRatio: a.aspect_ratio, resolution: a.resolution } : {}), ...(model === "krea-v3" ? { variant: meta(a).variant || "berry" } : {}) };
  },
});
const videoTool = (agentId, model, name, rate, { image = false, maxSeconds } = {}) => ({
  name, type: "video", agentId, path: "/ai-api/ai/video-tools/task/submit", needsDuration: !image,
  credits: (a) => {
    const r = typeof rate === "number" ? rate : rate[String(a.resolution || Object.keys(rate)[0]).toLowerCase()] ?? Object.values(rate)[0];
    const s = image ? Math.ceil(String(a.prompt || "").trim().length / 12) || 1 : secs(a, 0);
    return Math.round(r * 1000 * s);
  },
  body: (a) => {
    const m = meta(a);
    if (!image && !a.video_url) throw new ToolError(`${name} needs video_url (and duration: the input video's length in seconds).`);
    if (!image && !secs(a, 0)) throw new ToolError(`${name} needs duration: the input video's length in seconds (it sets the price).`);
    if (maxSeconds && secs(a, 0) > maxSeconds) throw new ToolError(`${name} takes videos up to ${maxSeconds} seconds.`);
    if (image && !first(a)[0]) throw new ToolError(`${name} needs one portrait in images and the script as prompt.`);
    if (model === "video-sound-fx" && String(a.prompt || "").length > 50) throw new ToolError("Video Sound takes a prompt of up to 50 characters.");
    if (model === "talking-photo" && String(a.prompt || "").length > 1000) throw new ToolError("Talking Photo takes a script of up to 1,000 characters.");
    // As on the website: resolution only where it's chosen, a prompt only for sound, reframe and talking photo.
    const res = typeof rate === "number" ? undefined : String(a.resolution || Object.keys(rate)[0]).toLowerCase();
    return defined({
      model, ...(image ? { image: first(a)[0] } : { video: a.video_url, durationSeconds: Math.ceil(secs(a, 0)) }),
      resolution: res, aspectRatio: model === "video-expand" ? a.aspect_ratio : undefined,
      prompt: model === "video-translate" || model === "video-upscale" ? undefined : str(a.prompt),
      voice: image ? m.voice : undefined, voiceLanguage: image ? m.voiceLanguage : undefined,
      voicePrompt: image ? str(m.voicePrompt) || "Say the following." : undefined,
      outputLanguage: model === "video-translate" ? m.outputLanguage || "English" : undefined,
    });
  },
});
const threeD = (agentId, model, name, credits, { imagesRequired = false, maxImages = 4, noPrompt = false } = {}) => ({
  name, type: "3d", agentId, path: "/ai-api/ai/3d/task/submit", credits: typeof credits === "function" ? credits : () => credits,
  body: (a) => {
    const images = first(a).slice(0, maxImages);
    if (imagesRequired && !images.length) throw new ToolError(`${name} needs at least one image.`);
    if (!images.length && !a.prompt) throw new ToolError(`${name} needs a prompt or an image.`);
    return { model, ...(images.length ? { images } : {}), ...(!noPrompt && a.prompt ? { prompt: a.prompt } : {}), ...(Number.isInteger(a.seed) ? { seed: a.seed } : {}), ...meta(a) };
  },
});

const WEBSITE_MEDIA_MODELS = {
  // images
  "ideogram-4.5": {
    name: "Ideogram 4.5", type: "image", agentId: "6318", path: "/ai-api/ai/ideogram3/task/submit", wrap: "image_request",
    credits: (a) => ({ high: first(a).length ? 730 : 330, medium: 200, low: 100, very_low: 27 })[meta(a).quality || "high"] ?? 330,
    body: (a) => {
      const quality = meta(a).quality || "high";
      const images = first(a).slice(0, 5);
      if (quality === "very_low" && !images.length) throw new ToolError("Ideogram 4.5 quality very_low edits an image: pass one in images.");
      return { image_request: { model: "Ideogram 4.5", prompt: a.prompt, quality, resolution: a.resolution || "", ...(a.aspect_ratio ? { aspect_ratio: a.aspect_ratio } : {}), ...(images.length ? { images } : {}) }, batch: 1, hidePrompt: 0 };
    },
  },
  "ideogram-3.0": ideogram3("6083", "Ideogram 3.0 Default", "Ideogram 3.0", 200),
  "ideogram-3.0-turbo": ideogram3("6082", "Ideogram 3.0 Turbo", "Ideogram 3.0 Turbo", 100),
  "ideogram-3.0-quality": ideogram3("6084", "Ideogram 3.0 Quality", "Ideogram 3.0 Quality", 300),
  "flux-3-klein": {
    name: "FLUX.3 Klein", type: "image", agentId: "6307", path: "/ai-api/ai/flux/task/submit",
    credits: (a) => ({ "768sq": 21, "1k": 24, "1.5k": 29, "2k": 37, "4k": 96 })[resOf(a, "1k").toLowerCase()] ?? 24,
    body: (a) => ({ model: "flux-3-image-klein", prompt: a.prompt, images: first(a), aspect_ratio: String(a.aspect_ratio || "1:1").toLowerCase(), resolution: resOf(a, "1k").toLowerCase(), batch: 1 }),
  },
  "qwen-image-3.0": anywhere("6308", "qwen-image-3.0", "Qwen Image 3.0", 3, (a) => 100 + 10 * first(a).slice(0, 3).length),
  "qwen-image-3.0-pro": anywhere("6309", "qwen-image-3.0-pro", "Qwen Image 3.0 Pro", 3, (a) => (resOf(a, "1K").toUpperCase() === "2K" ? 250 : 133) + 10 * first(a).slice(0, 3).length),
  "krea-3": anywhere("6310", "krea-v3", "Krea 3", 8, (a) => ({ "0.5K": 25, "2K": 400 })[resOf(a, "1K").toUpperCase()] ?? 100),
  "mai-image-2.6": anywhere("6311", "mai-image-2.6", "MAI Image 2.6", 5, (a) => (first(a).length ? 104 + 21 * first(a).slice(0, 5).length : resOf(a, "1K").toUpperCase() === "2K" ? 233 : 104)),
  "mai-image-2.6-flash": anywhere("6312", "mai-image-2.6-flash", "MAI Image 2.6 Flash", 5, (a) => (first(a).length ? 52 + 7 * first(a).slice(0, 5).length : resOf(a, "1K").toUpperCase() === "2K" ? 117 : 52)),
  "hidream-o1": hidream("6249", "hidream-o1-image", "HiDream O1", 133),
  "hidream-o1-dev": hidream("6248", "hidream-o1-image-dev", "HiDream O1 Dev", 67),
  "hidream-e1-full": hidream("6247", "hidream-e1-full", "HiDream E1 Full (edit one image)", 80, { edit: true }),
  "hidream-i1-full": hidream("6246", "hidream-i1-full", "HiDream I1 Full", 80, { noImages: true }),
  "hidream-i1-dev": hidream("6245", "hidream-i1-dev", "HiDream I1 Dev", 40, { noImages: true }),
  "midjourney": {
    name: "Midjourney", type: "image", agentId: 4115, wrap: "image_request",
    path: (a) => (a._mjAction ? "/ai-api/ai/zeakai/mj/submit/action" : "/ai-api/ai/zeakai/mj/submit/imagine"),
    credits: () => 150, // charged 150 in the live test (the website lists 100)
    // metadata.action (a button of a finished Midjourney task: U1-U4, V1-V4, reroll, "Upscale (Subtle)", ...) + metadata.task_id.
    prepare: async (env, a) => {
      const m = meta(a);
      if (!str(m.action)) return a;
      const parentId = String(m.task_id || "").replace(/^web:/, "");
      if (!parentId) throw new ToolError("A Midjourney action needs metadata.task_id: the task_id of the Midjourney result to act on.");
      const t = (await webRequest(env, "POST", `${WEB}/ai-api/ai/task/get`, { taskId: parentId }))?.task;
      if (!t) throw new ToolError(`No Midjourney task found with id ${parentId}.`);
      const buttons = mjButtons(t);
      const want = String(m.action).trim().toLowerCase();
      const btn = buttons.find((b) => b.name.toLowerCase() === want);
      if (!btn) throw new ToolError(`That Midjourney task has no "${m.action}" button. Its buttons: ${buttons.map((b) => b.name).join(", ") || "none"}.`);
      let input = {};
      try { input = typeof t.input === "string" ? JSON.parse(t.input) : t.input || {}; } catch {}
      return { ...a, _mjAction: { customId: btn.customId, label: btn.name, taskId: parentId, conversationId: t.conversationId, taskName: `${t.sourceInput || input.prompt || ""} ${btn.name}`.trim() } };
    },
    body: (a) => {
      const m = meta(a);
      if (a._mjAction) {
        const x = a._mjAction;
        return { image_request: { botType: "", customId: x.customId, enableRemix: true, model: "mj-zeakai-action", taskId: x.taskId }, name: x.label, conversationId: x.conversationId, taskName: x.taskName };
      }
      const { prompt, version, aspect } = mjPrompt(a);
      oneOf("Midjourney", "aspect ratios", aspect, ["1:1", "4:3", "3:4", "16:9", "9:16"]);
      const images = first(a).slice(0, 5);
      const req = { prompt, aspect, base64Array: images, style: m.style, view: m.view, characterShot: m.characterShot, lighting: m.lighting, imageQuality: m.imageQuality, artisticLevel: m.artisticLevel, version, cw: m.cw, sref: m.sref, cref: m.cref, model: "mj-zeakai-imagine" };
      return { image_request: Object.fromEntries(Object.entries(req).filter(([, v]) => v !== undefined && v !== null && v !== "")), fileList: images, conversationId: "" };
    },
  },
  "ai-poster": {
    name: "AI Poster", type: "image", agentId: "6140", path: "/ai-api/ai/tools/poster/generate", credits: () => 400,
    body: (a) => ({ prompt: a.prompt, aspectRatio: a.aspect_ratio || "1:1", textBlocks: posterTextBlocks(meta(a).textBlocks), usageContext: meta(a).usageContext || "" }),
  },
  "ai-translate": { name: "AI Translate", type: "text", agentId: "6174", translate: true, credits: () => 0 },
  "logo-maker": {
    name: "Logo Maker", type: "image", agentId: "6128", path: "/ai-api/ai/logo-maker/generate", credits: () => 100, promptOptional: true,
    body: (a) => {
      const m = meta(a);
      const brandName = str(m.brandName) || "";
      const additionalPrompt = str(a.prompt) || "";
      if (!brandName && !additionalPrompt) throw new ToolError("Logo Maker needs metadata.brandName (the company or brand name) or a prompt.");
      if (m.style) oneOf("Logo Maker", "style", m.style, LOGO_STYLES);
      if (m.industry) oneOf("Logo Maker", "industry", m.industry, LOGO_INDUSTRIES);
      return { brandName, industry: m.industry || "", style: m.style || "", size: a.aspect_ratio || "", additionalPrompt, model: "Logo Maker" };
    },
  },
  "ai-product-images": {
    name: "AI Product Images", type: "image", agentId: "6141", path: "/ai-api/ai/tools/product-images/generate", credits: () => 400,
    body: (a) => {
      if (!first(a)[0]) throw new ToolError("AI Product Images needs the product photo in images.");
      const text = str(meta(a).text) || "";
      const textPosition = text ? oneOf("AI Product Images", "textPosition", meta(a).textPosition || "bottom", POSITIONS) : "";
      return { referenceImageUrl: first(a)[0], aspectRatio: a.aspect_ratio || "1:1", usageContext: meta(a).usageContext || "", prompt: a.prompt, text, textPosition };
    },
  },
  // videos
  "veo3": {
    name: "Veo 3", type: "video", agentId: "6003", path: "/ai-api/ai/openai-next/veo3/task/submit", credits: () => 1500,
    body: (a) => ({ model: "veo3", prompt: a.prompt, seed: 0, image: first(a)[0], aspectRatio: a.aspect_ratio || "16:9", duration: 5, negativePrompt: a.negative_prompt || "", resolution: a.resolution, hidePrompt: 0 }),
  },
  "kling-o1": {
    name: "Kling O1", type: "video", agentId: "6157", path: "/ai-api/ai/klingO1/task/submit",
    credits: (a) => tablePrice("kling-o1", `${String(a.resolution || "720p").toLowerCase()}${a.video_url ? "-v2v" : ""}`, Math.ceil(secs(a, 5))),
    // A new video is 5 or 10 s; editing a video keeps its length (3-10 s).
    body: (a) => ({
      model: "kling-video-o1", prompt: String(a.prompt || "").replace(/@(Video|Audio)\d+\s?/g, "").replace(/@Image(\d+)/g, "<<<image_$1>>>").replace(/\s+/g, " ").trim(), resolution: a.resolution || "720p",
      duration: a.video_url ? Math.min(10, Math.max(3, Math.ceil(secs(a, 5)))) : Number(oneOf("Kling O1", "duration", secs(a, 5), [5, 10])), aspect_ratio: a.aspect_ratio || "16:9",
      ...(first(a).length && !a.video_url ? { imageUrls: JSON.stringify(first(a).slice(0, 2)) } : {}),
      ...(a.video_url ? { videoList: JSON.stringify([{ video_url: a.video_url, refer_type: "base", keep_original_sound: "yes" }]) } : {}), hidePrompt: 0,
    }),
  },
  "wan3.0-video-prime": {
    name: "Wan 3.0 Prime", type: "video", agentId: "6215", path: "/ai-api/ai/wan30/task/submit", credits: (a) => tablePrice("wan3.0-video-prime", resOf(a, "720P").toUpperCase(), secs(a, 5)),
    body: (a) => {
      const d = secs(a, 5);
      if (d < 2 || d > 30) throw new ToolError("Wan 3.0 Prime takes 2 to 30 seconds.");
      return { model: "wan3.0-video-prime", prompt: a.prompt, duration: d, resolution: a.resolution || "720P", ratio: a.aspect_ratio || "adaptive", ...(first(a).length ? { images: first(a).slice(0, 2) } : {}), generateAudio: !!a.audio, hidePrompt: 0 };
    },
  },
  "wan-2.7": {
    name: "Wan 2.7", type: "video", agentId: "6165", path: "/ai-api/ai/ali-wan/27/task/submit", credits: (a) => tablePrice("wan-2.7", resOf(a, "720P").toUpperCase(), secs(a, 5)),
    // images are first/last frame; with video_url (or metadata.references) they become references instead.
    body: (a) => {
      const d = secs(a, 5);
      if (d < 2 || d > 15) throw new ToolError("Wan 2.7 takes 2 to 15 seconds.");
      const refs = Array.isArray(meta(a).references) ? meta(a).references
        : a.video_url ? [...first(a).slice(0, 4).map((url) => ({ type: "reference_image", url })), { type: "reference_video", url: a.video_url }] : null;
      return { model: "wan-2.7", prompt: a.prompt, resolution: a.resolution || "720P", ratio: a.aspect_ratio || "16:9", duration: d, ...(refs ? { references: refs } : first(a).length ? { keyframes: first(a).slice(0, 2) } : {}), hidePrompt: 0 };
    },
  },
  "wan-2.6": {
    name: "Wan 2.6", type: "video", agentId: "6118", credits: (a) => tablePrice("wan-2.6", `${resOf(a, "720P").toUpperCase()}${a.video_url ? "-r2v" : ""}`, secs(a, 5)),
    route: (a) => (a.video_url ? ["6120", "wan2.6-r2v", "r2v"] : first(a).length ? ["6119", "wan2.6-i2v", "i2v"] : ["6118", "wan2.6-t2v", "t2v"]),
    path: (a) => `/ai-api/ai/ali-wan26/${WEBSITE_MEDIA_MODELS["wan-2.6"].route(a)[2]}/task/submit`,
    body: (a) => {
      const [agentId, model] = WEBSITE_MEDIA_MODELS["wan-2.6"].route(a);
      const duration = Number(oneOf("Wan 2.6", "duration", secs(a, 5), a.video_url ? [5, 10] : [5, 10, 15]));
      return { agentId, model, prompt: a.prompt, image: first(a)[0] || "", reference_video_urls: a.video_url ? [a.video_url] : null, duration, size: wan26Size(a), resolution: resOf(a, "720P").toUpperCase(), shot_type: meta(a).shot_type || "single", hidePrompt: 0 };
    },
  },
  "seedance-1.0-pro": {
    name: "Seedance 1.0 Pro", type: "video", agentId: "6022", credits: (a) => tablePrice("seedance-1.0-pro", "", secs(a, 5)),
    path: (a) => `/ai-api/ai/wavespeed/seedance-${first(a).length ? "i2v" : "t2v"}/task/submit`,
    body: (a) => ({ agentId: first(a).length ? "6020" : "6022", model: first(a).length ? "seedance-v1-pro-i2v-1080p" : "seedance-v1-pro-t2v-1080p", prompt: a.prompt, aspectRatio: a.aspect_ratio || "16:9", duration: Number(oneOf("Seedance 1.0 Pro", "duration", secs(a, 5), [5, 10])), image: first(a)[0] }),
  },
  "heygen-video": { name: "HeyGen Video (avatar)", type: "video", agentId: "6241", heygen: true },
  // video tools
  "video-upscale": videoTool("6220", "video-upscale", "Video Upscale", { "720p": 0.0354, "1080p": 0.1247, "4k": 0.498 }, { maxSeconds: 300 }),
  "video-sound": videoTool("6221", "video-sound-fx", "Video Sound", 0.0015, { maxSeconds: 900 }),
  "video-reframe": videoTool("6222", "video-expand", "Video Reframe", 0.2, { maxSeconds: 10 }),
  "talking-photo": videoTool("6223", "talking-photo", "Talking Photo", { "720p": 0.0832, "1080p": 0.15 }, { image: true }),
  "video-translate": videoTool("6224", "video-translate", "Video Translator", 0.222, { maxSeconds: 900 }),
  // 3D
  "hunyuan-3d-3.1": threeD("6231", "hunyuan3d-v3.1", "Hunyuan 3D 3.1", 100, { maxImages: 1 }),
  "tripo-h3.1": threeD("6233", "tripo-h3.1", "Tripo h3.1", tripoCredits),
  "meshy-7": threeD("6232", "meshy-v7", "Meshy 7", meshyCredits),
  "trellis-3d": threeD("6229", "trellis-3d", "TRELLIS 3D", 500, { imagesRequired: true, maxImages: 5, noPrompt: true }),
  "rodin-gen-2": threeD("6230", "rodin-gen2", "Rodin Gen-2", 1400, { maxImages: 5 }),
  // detectors (synchronous: the scores come back in the same call)
  "ai-image-detector": { name: "AI Image Detector", type: "detector", agentId: "6200", detector: "IMAGE", credits: () => 20 },
  "ai-video-detector": { name: "AI Video Detector", type: "detector", agentId: "6201", detector: "VIDEO", credits: () => 20 },
  // speech to text
  "scribe-v2": {
    name: "Scribe v2 (speech to text)", type: "speech-to-text", agentId: "6175", path: "/ai-api/voice/elevenlabs/task/submit",
    credits: (a) => 12 * Math.max(1, Math.ceil(secs(a, 60) / 60)),
    body: (a) => { if (!a.video_url && !first(a)[0]) throw new ToolError("Scribe needs the audio file's URL in video_url."); return { type: 2, inputSourceUrl: a.video_url, model: "scribe_v2" }; },
  },
  "scribe-v1": {
    name: "Scribe v1 (speech to text)", type: "speech-to-text", agentId: "6038", path: "/ai-api/voice/elevenlabs/task/submit",
    credits: (a) => 12 * Math.max(1, Math.ceil(secs(a, 60) / 60)),
    body: (a) => { if (!a.video_url) throw new ToolError("Scribe needs the audio file's URL in video_url."); return { type: 2, inputSourceUrl: a.video_url, model: "scribe_v1" }; },
  },
};
// How to call each website-only media model (shown by glbgpt_list_models).
const WEBSITE_MEDIA_HINTS = {
  "ideogram-4.5": "prompt; aspect_ratio auto|1:1|1:3|3:1|1:2|2:1|9:16|16:9|10:16|16:10|2:3|3:2|3:4|4:3|4:5|5:4; resolution 1K|2K; images (up to 5) to edit; metadata.quality high|medium|low|very_low (very_low edits an image)",
  "ideogram-3.0": "prompt; aspect_ratio 1:1|1:3|3:1|1:2|2:1|9:16|16:9|10:16|16:10|2:3|3:2|3:4|4:3|4:5|5:4; negative_prompt; metadata.style_type AUTO|GENERAL|REALISTIC|DESIGN|RENDER_3D|ANIME or metadata.style_preset (e.g. WATERCOLOR, ART_DECO, POP_ART, OIL_PAINTING, VINTAGE_POSTER, FLAT_VECTOR)",
  "ideogram-3.0-turbo": "same as ideogram-3.0", "ideogram-3.0-quality": "same as ideogram-3.0",
  "flux-3-klein": "prompt; aspect_ratio auto|21:9|2:1|16:9|3:2|7:5|4:3|5:4|1:1|4:5|3:4|5:7|2:3|9:16|1:2|9:21; resolution 768sq|1k|1.5k|2k|4k; images as references",
  "qwen-image-3.0": "prompt (up to 800 characters); aspect_ratio 1:1|16:9|9:16|4:3|3:4|3:2|2:3|4:5|5:4|2:1|1:2|21:9|9:21|3:1|1:3; resolution 1K|2K; up to 3 images", "qwen-image-3.0-pro": "same as qwen-image-3.0 (2K costs more)",
  "krea-3": "prompt; aspect_ratio 1:1|16:9|9:16|4:3|3:4|3:2|2:3|4:5|5:4|2:1|1:2|21:9|9:21; resolution 0.5K|1K|2K; up to 8 images; metadata.variant berry|jam",
  "mai-image-2.6": "prompt; aspect_ratio auto|1:1|16:9|9:16|4:3|3:4|3:2|2:3|4:5|5:4|2:1|1:2|21:9|9:21; resolution 1K|2K (both ignored with images); up to 5 images", "mai-image-2.6-flash": "same as mai-image-2.6",
  "hidream-o1": "prompt; aspect_ratio 1:1|16:9|9:16|4:3|3:4|3:2|2:3|21:9|9:21; resolution 2K|4K; up to 3 images", "hidream-o1-dev": "same as hidream-o1",
  "hidream-e1-full": "prompt = the edit instruction; exactly 1 image", "hidream-i1-full": "prompt; aspect_ratio 1:1|16:9|9:16|4:3|3:4|3:2|2:3|21:9|9:21; resolution 1K|2K (text only)", "hidream-i1-dev": "same as hidream-i1-full",
  "midjourney": "prompt (--v and --ar are moved into their fields, other flags stay); aspect_ratio 1:1|4:3|3:4|16:9|9:16; images (up to 5) as image prompts; metadata.version 8.2 (default)|8|7.0|6.1|6.0|niji6|niji5|niji4, imageQuality 0.25|0.5|1|2, artisticLevel 50|100|250|750, style, view, characterShot, lighting, sref, cref, cw; returns the 2x2 grid and its buttons (actions). To press one (upscale U1-U4, vary V1-V4, reroll, ...): metadata.action = the button, metadata.task_id = the grid's task_id",
  "ai-translate": "prompt = the text (up to 20,000 characters); metadata.target_language = the language name, e.g. Spanish, German, Japanese, Chinese (Simplified); returns the translated text",
  "logo-maker": "metadata.brandName (the company or brand name) and/or prompt (extra wishes); metadata.style auto|minimalist|hand-drawn|geometric|line-art|vintage|abstract; metadata.industry technology|ecommerce|food|health|creative|saas|hospitality|education|nonprofit|fashion|realestate|financial|media|manufacturing|professional; aspect_ratio 1:1|1:3|3:1|1:2|2:1|9:16|16:9|10:16|16:10|2:3|3:2|3:4|4:3|4:5|5:4",
  "ai-poster": "prompt; aspect_ratio 1:1|16:9|9:16; metadata.textBlocks: up to 3 texts, each a string or {text, position top|middle|bottom}; metadata.usageContext social-media|school-campus|club-team|community|party-event|store-business|real-estate|announcement",
  "ai-product-images": "images[0] = the product photo; prompt; aspect_ratio 1:1|3:4|16:9|9:16; metadata.text and textPosition top|middle|bottom; metadata.usageContext main-product|lifestyle|product-detail|feature-highlight|comparison|ad-creative|website-hero|promotional-sale",
  "veo3": "prompt; aspect_ratio 16:9|9:16; resolution 720p|1080p; images[0] as start frame; fixed 5 s",
  "kling-o1": "prompt (refer to images as @Image1); duration 5|10; resolution 720p|1080p; aspect_ratio 16:9|9:16|1:1; up to 2 images (first/last frame); or video_url (3-10 s) to edit a video, duration = its length",
  "wan3.0-video-prime": "prompt; duration 2-30; resolution 480P|720P|1080P; aspect_ratio 16:9|9:16|1:1|4:3|3:4|adaptive; up to 2 images (first/last frame); audio; metadata.referenceImages (up to 10), referenceVideos (up to 5), referenceAudios (up to 5) as URL lists, metadata.fileUrl (a reference document), metadata.promptExtend",
  "wan-2.7": "prompt; duration 2-15; resolution 720P|1080P; aspect_ratio 16:9|9:16|1:1|4:3|3:4; up to 2 images as first/last frame; or video_url (+ images) as references, or metadata.references [{type: reference_image|reference_video, url}]; metadata.audioReference",
  "wan-2.6": "prompt; duration 5|10|15 (5|10 with video_url); resolution 720P|1080P; aspect_ratio 16:9|9:16; images[0] = image to video; video_url = reference video; metadata.shot_type single|multi",
  "seedance-1.0-pro": "prompt; duration 5|10; aspect_ratio 16:9|9:16|1:1|21:9|9:21|4:3|3:4; images[0] = image to video (always 1080p)",
  "heygen-video": "talking avatar: images[0] = portrait (or metadata.avatar_id), prompt = script, metadata.voice_id (see this model's voices), metadata.speed 0.5-1.5; or metadata.audio_url instead of script; aspect_ratio 16:9|9:16|1:1",
  "video-upscale": "video_url (up to 300 s); duration = the input's length in seconds; resolution 720p (default)|1080p|4k",
  "video-sound": "video_url (up to 900 s); duration = the input's length in seconds; prompt = the sounds you want (up to 50 characters)",
  "video-reframe": "video_url (up to 10 s); duration = its length; aspect_ratio 1:1|3:4|4:3|9:16|16:9|21:9|9:21; prompt optional",
  "talking-photo": "images[0] = portrait; prompt = script (up to 1,000 characters); resolution 720p|1080p; metadata.voice (e.g. 'Zephyr (Female)', 'Puck (Male)', 'Kore (Female)'), metadata.voiceLanguage (e.g. 'English (US)', 'German'), metadata.voicePrompt (how to speak)",
  "video-translate": "video_url (mp4, up to 900 s, with speech); duration = its length in seconds; metadata.outputLanguage (e.g. Spanish, German, Japanese)",
  "hunyuan-3d-3.1": "prompt or images[0]; seed; returns a GLB",
  "tripo-h3.1": "prompt or 1-4 images (front, left, back, right); seed; metadata texture (false = none), textureQuality detailed, geometryQuality standard|detailed, quad, autoSize, faceLimit 1000-2000000, textureAlignment original_image|geometry, orientation default|align_image, negativePrompt (text only); price depends on these",
  "meshy-7": "prompt or 1-4 images; seed; metadata shouldTexture (false = preview, cheaper), ultraMode, modelType standard|lowpoly|smart-topology, topology triangle|quad, targetPolycount 100-300000, shouldRemesh, symmetryMode off|auto|on, enablePbr, poseMode a-pose|t-pose, texturePrompt, enableRigging + riggingHeightMeters, enableAnimation + animationActionId 0-696; price depends on these",
  "trellis-3d": "1-5 images of the same object (no prompt); seed; metadata textureSize 512|1024|2048, generateColor, generateNormal, saveGaussianPly, returnNoBackground, ssGuidanceStrength / slatGuidanceStrength 0-10, ssSamplingSteps / slatSamplingSteps 1-50, meshSimplify 0.9-0.98",
  "rodin-gen-2": "prompt and/or up to 5 images; seed; metadata quality high|medium|low|extra-low, qualityOverride (exact polygon count), material PBR|Shaded|All, meshMode Quad|Raw, geometryFileFormat glb|usdz|fbx|obj|stl, tapose, useOriginalAlpha, bboxCondition [w, h, l], addons [HighPack]",
  "ai-image-detector": "images[0] = the image (https URL or data: URI; JPG, PNG or WebP, up to 20 MB, at least 256 px; it's added to the media library if it isn't there yet); returns ai_generated and deepfake scores (0-1) and a summary. Use the result as a risk assessment, not proof",
  "ai-video-detector": "video_url = the video (MP4, WebM or M4V, up to 60 s); duration = its length in seconds; metadata.frame_ms = which moment to check (default 0; the frame is cut automatically for videos on GlobalGPT, otherwise pass it in images[0]); checks that one frame and returns ai_generated and deepfake scores (0-1)",
  "scribe-v2": "video_url = URL of the audio or video file; duration = its length in seconds (for the price); returns a transcript file", "scribe-v1": "same as scribe-v2 (older model)",
};
const websiteMediaEntry = (w) => ({
  id: w.id, type: w.type, source: "website", description: `${w.name} (only on GlobalGPT's website)`, usage: WEBSITE_MEDIA_HINTS[w.id],
  ...(w.heygen ? { price: "quoted per video (about 1,000 credits per minute)" } : w.translate ? { price: "free in the 21 Oct test (0 credits for a short text)" } : w.detector ? { price: "20 credits per run (from the account's credit records; the website doesn't show it)" } : { price_from: Math.round(Number(w.credits({ prompt: "x", duration: 5 })) || 0) }),
});

// Prices the website shows only as a range (or that depend on the input's length).
const APPROX_PRICE = new Set(["midjourney", "talking-photo", "scribe-v2", "scribe-v1"]);
const WEBSITE_MEDIA_ALIASES = { "logo": "logo-maker", "krea-v3": "krea-3", "flux-3-image-klein": "flux-3-klein", "veo-3": "veo3", "kling-video-o1": "kling-o1", "wan-3.0-prime": "wan3.0-video-prime", "wan2.6": "wan-2.6", "seedance-v1-pro": "seedance-1.0-pro", "heygen": "heygen-video", "meshy-v7": "meshy-7", "hunyuan3d-v3.1": "hunyuan-3d-3.1", "rodin-gen2": "rodin-gen-2", "scribe": "scribe-v2", "scribe_v2": "scribe-v2", "scribe_v1": "scribe-v1", "video-sound-fx": "video-sound", "video-expand": "video-reframe" };
const websiteMedia = (id) => {
  const key = String(id || "").trim().toLowerCase();
  const k = WEBSITE_MEDIA_ALIASES[key] ?? key;
  return WEBSITE_MEDIA_MODELS[k] ? { id: k, ...WEBSITE_MEDIA_MODELS[k] } : null;
};

// Calls on the website's internal API, signed with the login token. Business errors come as HTTP 200 + {code}.
async function webRequest(env, method, url, body) {
  if (!env.GLBGPT_TOKEN) throw new ToolError("This model is only on GlobalGPT's website, which needs GLBGPT_TOKEN (your login token) on the Worker.");
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${env.GLBGPT_TOKEN}`, "User-Agent": UA, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ToolError(`Couldn't reach GlobalGPT's website: ${e && e.message}`);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  const err = websiteError(res.status, data) ?? (data?.error?.code ? `GlobalGPT's website refused it: ${data.error.code}` : null);
  if (err) throw new ToolError(err);
  if (data === null) throw new ToolError(`GlobalGPT's website answered HTTP ${res.status} without JSON.`);
  return data;
}

// ---------------------------------------------------------------------------
// AI Image / Video Detector
// ---------------------------------------------------------------------------
// The website analyses a file from the account's library (by id) or one uploaded to its storage
// (by file key); for a video it analyses one still frame, which the browser captures and uploads.
const DETECTOR_MAX_BYTES = { IMAGE: 20 * 1024 * 1024, VIDEO: 90 * 1024 * 1024 }; // video: the Worker's memory, not the site's 200 MB

// Load an https URL or a data: URI into a Blob, refusing anything too big.
async function loadMedia(src, maxBytes, what) {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(src || "");
  if (m) {
    const bytes = m[2] ? Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]));
    if (bytes.length > maxBytes) throw new ToolError(`The ${what} is larger than ${Math.round(maxBytes / 1048576)} MB.`);
    return new Blob([bytes], { type: m[1] || "application/octet-stream" });
  }
  if (!/^https:\/\//i.test(src || "")) throw new ToolError(`The ${what} must be a public https URL or a data: URI.`);
  let res;
  try { res = await fetch(src); } catch (e) { throw new ToolError(`Couldn't download the ${what}: ${e && e.message}`); }
  if (!res.ok) throw new ToolError(`Couldn't download the ${what} (HTTP ${res.status}).`);
  if (Number(res.headers.get("content-length")) > maxBytes) throw new ToolError(`The ${what} is larger than ${Math.round(maxBytes / 1048576)} MB.`);
  const blob = await res.blob();
  if (blob.size > maxBytes) throw new ToolError(`The ${what} is larger than ${Math.round(maxBytes / 1048576)} MB.`);
  return blob;
}

// Upload one file to the website (multipart, field "files"); returns its file key.
async function webUpload(env, path, blob, name) {
  if (!env.GLBGPT_TOKEN) throw new ToolError("This model is only on GlobalGPT's website, which needs GLBGPT_TOKEN (your login token) on the Worker.");
  const form = new FormData();
  form.append("files", new File([blob], name, { type: blob.type || "application/octet-stream" }));
  let res;
  try {
    res = await fetch(`${WEB}${path}`, { method: "POST", headers: { Authorization: `Bearer ${env.GLBGPT_TOKEN}`, "User-Agent": UA }, body: form });
  } catch (e) {
    throw new ToolError(`Couldn't upload to GlobalGPT's website: ${e && e.message}`);
  }
  let data = null;
  try { data = JSON.parse(await res.text()); } catch {}
  const err = websiteError(res.status, data);
  if (err) throw new ToolError(err);
  const key = data?.files?.[0]?.fileKey ?? data?.data?.files?.[0]?.fileKey;
  if (!key) throw new ToolError("GlobalGPT's website didn't return a file key for the upload.");
  return String(key);
}

const fileName = (src, fallback) => (/^https:/i.test(src || "") ? decodeURIComponent(String(src).split("?")[0].split("/").pop() || "") : "") || fallback;

// The account's media library (website "Assets"): ids there are what the detectors take.
async function listAssets(env, mediaType, source, size = 50) {
  const data = await webRequest(env, "POST", `${WEB}/ai-api/ai/assets/list`, defined({ page_size: size, cursor: null, media_type: mediaType, source_type: source, sort: "NEWEST" }));
  return (data?.data?.items ?? data?.items ?? []).map((x) => ({ id: String(x.asset_id ?? ""), url: x.url, source: x.source_type === "UPLOAD_FILE" || source === "UPLOADS" ? "uploaded" : "generated", raw: x }));
}
// A frame of a video on GlobalGPT's CDN, cut by Cloudflare (the website's own preview trick).
const cdnFrameUrl = (videoUrl, ms) => `https://static.futureshareai.com/cdn-cgi/media/mode=frame,time=${Math.max(0, ms) / 1000}s,duration=1s,fit=contain,format=png/${videoUrl}`;

async function runDetector(env, w, a, limit) {
  if (!env.GLBGPT_TOKEN) throw new ToolError(`${w.name} is only on GlobalGPT's website, which needs GLBGPT_TOKEN (your login token) on the Worker.`);
  const video = w.detector === "VIDEO";
  const mediaType = video ? 2 : 1;
  const src = video ? a.video_url : first(a)[0];
  if (!src) throw new ToolError(video ? "AI Video Detector needs video_url (and duration)." : "AI Image Detector needs the image in images[0].");
  const secs0 = video ? secs(a, 0) : 0;
  if (video && !secs0) throw new ToolError("AI Video Detector needs duration: the video's length in seconds.");
  if (video && secs0 > 60) throw new ToolError("AI Video Detector takes videos up to 60 seconds.");

  // 1) Already in the library (made on GlobalGPT, or uploaded before)? 2) Otherwise upload it, which adds it to the library.
  let asset = null;
  if (/^https:/i.test(src)) asset = (await listAssets(env, mediaType)).find((x) => x.url === src) ?? null;
  if (!asset) {
    const blob = await loadMedia(src, DETECTOR_MAX_BYTES[w.detector], video ? "video" : "image");
    const key = await webUpload(env, "/ai-api/ai/storage/upload", blob, fileName(src, video ? "video.mp4" : "image.png"));
    const uploads = await listAssets(env, mediaType, "UPLOADS", 10);
    asset = uploads.find((x) => String(x.url || "").includes(key) || String(x.raw?.file_key ?? "") === key) ?? uploads[0] ?? null;
    if (!asset) throw new ToolError("The upload didn't show up in the GlobalGPT media library, so the detector can't use it.");
    asset.source = "uploaded";
  }
  let frame = {};
  if (video) {
    const frameMs = Math.max(0, Math.round(Number(meta(a).frame_ms) || 0));
    const frameSrc = first(a)[0] || (/^https:\/\/static\.futureshareai\.com\//i.test(asset.url || "") ? cdnFrameUrl(asset.url, frameMs) : null);
    if (!frameSrc) throw new ToolError("Couldn't cut a frame from this video: pass the still frame to check in images[0] (https URL or data: URI).");
    const blob = await loadMedia(frameSrc, 20 * 1024 * 1024, "video frame");
    frame = { frameFileKey: await webUpload(env, "/ai-api/ai/detector/frame/upload", blob, `detector-frame-${frameMs}.png`), frameTimestampMs: frameMs };
  }
  // Counted against the daily limit like any other generation; given back if the analysis fails.
  const price = Number(w.credits(a)) || 0;
  const reserved = limit ? await limit.reserve(price) : 0;
  let r;
  try {
    r = await webRequest(env, "POST", `${WEB}/ai-api/ai/detector/analyze`, defined({
      productNo: "glbgpt", agentId: w.agentId, mediaId: asset.id, mediaSource: asset.source, mediaType: w.detector,
      durationSeconds: video ? Math.ceil(secs0) : undefined, ...frame,
    }));
  } catch (e) {
    if (reserved) await limit.add(-reserved).catch(() => {});
    throw e;
  }
  const d = r?.data && typeof r.data === "object" && !Array.isArray(r.data) ? r.data : r;
  const score = (m) => (m && typeof m === "object" ? (typeof m.score === "number" ? m.score : null) : typeof m === "number" ? m : null);
  const { code, message, ...rest } = d || {};
  return defined({
    status: "succeeded", via: "website", model: w.id, type: "analysis", credits_estimated: price,
    ai_generated: score(d?.aiGenerated), deepfake: score(d?.deepfake), summary: str(d?.summary),
    ...(video ? { frame_ms: frame.frameTimestampMs } : {}),
    media_id: asset.id, details: rest,
    note: "Scores are 0-1 likelihoods. Use them as a risk assessment, not proof.",
  });
}

// AI Translate: the website's translation agent (text in, text out; the answer streams back like a chat).
async function runTranslate(env, w, a) {
  const text = String(a.prompt || "");
  if (!text.trim()) throw new ToolError("AI Translate needs the text to translate as prompt (up to 20,000 characters).");
  if (text.length > 20000) throw new ToolError("AI Translate takes up to 20,000 characters at a time.");
  const lang = String(meta(a).target_language || meta(a).targetLanguage || "English");
  const out = await websiteChat(env, w.agentId, text, { prefix: "/dify-api", inputs: { translate_type: "text", target_language: lang, is_first: true } });
  if (!out.answer) throw new ToolError(`AI Translate returned no text. Events received: ${JSON.stringify(out.debug)}`);
  return defined({ status: "succeeded", via: "website", model: w.id, type: "text", target_language: lang, text: out.answer, usage: out.usage });
}

// The account's recent website generations (website-only models; the API's list doesn't have them).
async function websiteRecent(env, n) {
  const data = await webRequest(env, "POST", `${WEB}/ai-api/ai/media/list/myCreation`, { page: 1, size: n, status: "all", productNo: "glbgpt" });
  const records = data?.records ?? data?.data?.records ?? [];
  const byAgent = Object.fromEntries(Object.entries(WEBSITE_MEDIA_MODELS).map(([id, w]) => [String(w.agentId), id]));
  return records.slice(0, n).map((r) => defined({
    task_id: r.id !== undefined ? `web:${r.id}` : undefined,
    status: r.status === "success" ? "succeeded" : r.status,
    model: byAgent[String(r.agentId)] ?? r.modelName ?? r.agentName ?? r.model,
    type: MEDIA_TYPES[r.mediaType],
    url: str(r.outputFileUrl),
    credits: typeof r.points === "number" ? r.points : typeof r.credits === "number" ? r.credits : undefined,
    created: typeof (r.createAt ?? r.createTime) === "number" ? new Date(r.createAt ?? r.createTime).toISOString() : r.createAt ?? r.createTime,
    reason: r.status === "failed" ? str(r.failedReasonShort) ?? str(r.failedReason) : undefined,
  }));
}

const webTaskId = (data) => data?.taskId ?? data?.data?.taskId ?? data?.data?.id;

// The website's media types (1 image, 2 video, 3 audio and transcripts, 4 3D).
const MEDIA_TYPES = { 1: "image", 2: "video", 3: "audio", 4: "3d" };

// Midjourney result buttons (U1-U4, V1-V4, reroll, Upscale/Vary variants), from the task's output.
function mjButtons(t) {
  let out = t?.output;
  if (typeof out === "string") { try { out = JSON.parse(out); } catch { out = null; } }
  return (Array.isArray(out?.buttons) ? out.buttons : []).filter((b) => b?.customId).map((b) => ({ customId: b.customId, name: str(b.label) || (b.emoji === "🔄" ? "reroll" : str(b.emoji) || "") })).filter((b) => b.name);
}

// One website task's state, in the same shape as the API's task view.
async function webTask(env, id) {
  const data = await webRequest(env, "POST", `${WEB}/ai-api/ai/task/get`, { taskId: id });
  const t = data?.task;
  if (!t) throw new ToolError(`No website task found with id ${id}.`);
  if (t.status === "success") {
    const actions = mjButtons(t).map((b) => b.name);
    return { status: "succeeded", url: t.outputFileUrl, type: MEDIA_TYPES[t.mediaType] ?? "image", ...(actions.length ? { actions } : {}) };
  }
  if (t.status === "failed") return { status: "failed", reason: str(t.failedReasonShort) ?? str(t.failedReason) ?? str(t.errorCode) ?? "The generation failed." };
  return { status: "processing" };
}

async function heygenOperation(env, id) {
  const data = await webRequest(env, "GET", `${WEB}/ai-api/ai/heygen/operations/${encodeURIComponent(id)}`);
  const op = data?.operation ?? data?.data?.operation;
  const d = data?.data ?? {};
  if (op?.status === "succeeded") return { status: "succeeded", url: d.video_url ?? data?.video_url, type: "video" };
  if (op?.status === "failed") return { status: "failed", reason: str(d.failure_message) ?? "The HeyGen video failed." };
  return { status: "processing" };
}

// Submit a website-only model; returns the first task view (with credits counted).
async function websiteGenerate(ctx, w, a, limit) {
  const env = ctx.env;
  if (!env.GLBGPT_TOKEN) throw new ToolError(`${w.name} is only on GlobalGPT's website, which needs GLBGPT_TOKEN (your login token) on the Worker.`);
  if (first(a).some((u) => /^data:/i.test(u))) throw new ToolError(`${w.name} is only on GlobalGPT's website, which takes images as public https URLs, not data: URIs.`);
  const isTool = typeof w.path === "string" && w.path.includes("video-tools");
  if (w.prepare) a = await w.prepare(env, a);
  if ((w.type === "image" || w.type === "video") && !w.heygen && !isTool && !w.promptOptional && !a._mjAction && !str(a.prompt)) throw new ToolError(`${w.name} needs a prompt.`);
  let body, credits, submit;
  if (w.heygen) {
    const m = meta(a);
    const input = {
      ...(m.avatar_id ? { type: "avatar", avatar_id: m.avatar_id, engine: { type: "avatar_iv" } } : first(a)[0] ? { type: "image", image: { type: "url", url: first(a)[0] } } : (() => { throw new ToolError("HeyGen needs a portrait in images, or metadata.avatar_id from its avatar library."); })()),
      ...(m.audio_url ? { audio_url: m.audio_url } : str(a.prompt) && m.voice_id ? { script: a.prompt, voice_id: m.voice_id, voice_settings: { speed: Number(m.speed) || 1 } } : (() => { throw new ToolError("HeyGen needs the script as prompt and metadata.voice_id (glbgpt_list_models with model heygen-video lists the voices), or metadata.audio_url."); })()),
      resolution: "1080p", aspect_ratio: a.aspect_ratio || "16:9", output_format: "mp4", ...(m.motion_prompt ? { motion_prompt: m.motion_prompt } : {}),
    };
    const quote = await webRequest(env, "POST", `${WEB}/ai-api/ai/heygen/quotes/video`, input);
    credits = Math.ceil(1000 * (Number(quote?.data?.estimated_amount) || 0));
    submit = async () => {
      const r = await webRequest(env, "POST", `${WEB}/ai-api/ai/heygen/videos`, { requestId: crypto.randomUUID(), input });
      const id = r?.operation?.id ?? r?.data?.operation?.id;
      if (!id) throw new ToolError("HeyGen didn't return an operation id.");
      return `heygen:${id}`;
    };
  } else {
    const b = defined(w.body(a));
    // metadata extras first, so the fields the connector builds (and checks) win; wrapped requests get them inside the wrapper.
    const merged = w.wrap ? { ...b, [w.wrap]: { ...extras(a), ...b[w.wrap] } } : { ...extras(a), ...b };
    body = { ...merged, productNo: "glbgpt", agentId: b.agentId ?? w.agentId, shareStatus: 0, enhancePrompt: enhanceOf(a) };
    credits = Math.max(0, Math.round(Number(w.credits(a)) || 0));
    const url = WEB + (typeof w.path === "function" ? w.path(a) : w.path);
    submit = async () => {
      const r = await webRequest(env, "POST", url, body);
      const id = webTaskId(r);
      if (!id) throw new ToolError(`GlobalGPT's website didn't return a task id${str(r?.message) ? `: ${r.message}` : ""}.`);
      return `web:${id}`;
    };
  }
  const reserved = await limit.reserve(credits);
  let taskId;
  try {
    taskId = await submit();
  } catch (e) {
    if (reserved) await limit.add(-reserved).catch(() => {});
    throw e;
  }
  if (reserved) await limit.remember(taskId, reserved).catch(() => {});
  return { taskId, credits };
}

// Poll a website task (web:<id> or heygen:<id>) until it finishes or the deadline passes.
async function waitForWebTask(env, limit, taskId, deadline) {
  const [kind, id] = [taskId.slice(0, taskId.indexOf(":")), taskId.slice(taskId.indexOf(":") + 1)];
  for (;;) {
    let t;
    try {
      t = kind === "heygen" ? await heygenOperation(env, id) : await webTask(env, id);
    } catch (e) {
      if (/No website task|login token|GLBGPT_TOKEN/.test(e.message)) throw e;
      return { task_id: taskId, status: "processing", via: "website", note: "Couldn't reach GlobalGPT just now. Call glbgpt_check_task again." };
    }
    if (t.status === "succeeded") {
      if (!t.url) throw new ToolError("The task succeeded but returned no URL.");
      await limit.kv?.delete(`task:${taskId}`).catch(() => {});
      return { task_id: taskId, status: "succeeded", url: t.url, type: t.type, via: "website", ...(t.actions ? { actions: t.actions, actions_note: "Midjourney buttons: call glbgpt_generate with model midjourney, metadata.action (one of these) and metadata.task_id (this task_id)." } : {}) };
    }
    if (t.status === "failed") {
      await limit.release(taskId).catch(() => {});
      throw new ToolError(`${t.reason} (website task)`);
    }
    if (Date.now() + POLL_MS > deadline) {
      return { task_id: taskId, status: "processing", via: "website", note: "Still running. Call glbgpt_check_task with this task_id again right away (the server waits inside each call). Don't tell the user it's done yet." };
    }
    await sleep(POLL_MS);
  }
}

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
    description: "Generate an image, video, audio clip (speech, music) or 3D model, transcribe audio, run an image or video tool (remove-bg, hd-upscale, face-swap, video-upscale, talking-photo, ...), or check an image or video for AI generation (ai-image-detector, ai-video-detector: the scores come back directly). Spends credits from the owner's GlobalGPT account; the price is checked first, and the owner may have set a daily credit limit. Parameters depend on the model: see glbgpt_list_models. Fields a model doesn't take are dropped and listed in ignored_parameters. Returns the finished url, or a task_id for glbgpt_check_task.",
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
        metadata: { type: "object", description: "Model-specific extras listed for the model (e.g. metadata.output_format). For website-only models every key is passed on to the website's request, so any option its own form has can be set; metadata.enhancePrompt true turns on the website's prompt enhancer." },
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
        type: { type: "string", enum: ["chat", "image", "video", "audio", "3d", "speech-to-text", "detector", "text"], description: "Only list this kind of model." },
        model: { type: "string", description: "Show one model's details instead of a list." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "glbgpt_usage",
    title: "GlobalGPT usage",
    description: "This connector's daily credit limit and today's spend, plus the most recent generations on the GlobalGPT account with their status and credits (recent: API generations; recent_website: website-only models; credit_records: what the account was actually charged, website and API, newest first; the last two need GLBGPT_TOKEN). A failed task shows credits 0: its reservation is given back.",
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
  // A failed task's reservation is given back (GlobalGPT's usage page shows no charge), so don't show it as spent.
  if (t.credits_reserved !== undefined) {
    if (t.status === "failed") Object.assign(out, { credits: 0, credits_released: t.credits_reserved });
    else out.credits = t.credits_reserved;
  }
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

  let est;
  try {
    est = await g.estimate(body);
  } catch (e) {
    // Not in the API, but on the website: submit it there instead.
    const w = isModelMissing(e) ? websiteMedia(body.model) : null;
    if (!w) throw e;
    if (w.detector) return await runDetector(ctx.env, w, body, limit);
    if (w.translate) return await runTranslate(ctx.env, w, body);
    const { taskId, credits } = await websiteGenerate(ctx, w, body, limit);
    const result = await waitForWebTask(ctx.env, limit, taskId, Date.now() + WAIT_MS);
    return { ...result, model: w.id, credits_estimated: credits, ...(APPROX_PRICE.has(w.id) ? { price_note: "estimated from the website's list price; GlobalGPT bills the exact amount" } : {}) };
  }
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
      const out = await websiteChat(ctx.env, web.agentId, query, web.prefix ? { prefix: web.prefix } : {});
      if (schema) return parseJsonAnswer(out.answer);
      if (!out.answer) {
        const reason = out.debug?.start?.match(/"reason":"([^"]+)"/)?.[1];
        throw new ToolError(reason === "upstream_transport_failed"
          ? `${web.name} is currently not answering on GlobalGPT's website (their backend couldn't reach the provider). Try again later or pick another model.`
          : `${web.name} returned an empty answer. Events received: ${JSON.stringify(out.debug)}`);
      }
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
    if (/^(web|heygen):/.test(taskId)) return waitForWebTask(ctx.env, new CreditLimit(ctx.env), taskId, Date.now() + WAIT_MS);
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
        if (!isModelMissing(e)) throw e;
        const w = websiteModel(a.model);
        if (w) return { ...websiteEntry(w), available: !!ctx.env.GLBGPT_TOKEN };
        const wm = websiteMedia(a.model);
        if (!wm) throw e;
        const out = { ...websiteMediaEntry(wm), available: !!ctx.env.GLBGPT_TOKEN };
        if (wm.heygen && ctx.env.GLBGPT_TOKEN) {
          try {
            const v = await webRequest(ctx.env, "GET", `${WEB}/ai-api/ai/heygen/voices?type=public&limit=100`);
            out.voices = (Array.isArray(v?.data) ? v.data : []).filter((x) => x?.voice_id && x.type !== "private").map((x) => ({ voice_id: x.voice_id, name: x.name, language: x.language, gender: x.gender }));
          } catch (err) { out.voices = `Couldn't load voices: ${err.message}`; }
        }
        return out;
      }
    }
    const apiTypes = ["chat", "image", "video", "audio"];
    const models = !a.type || apiTypes.includes(a.type) ? list(await g.models(a.type)) : [];
    // Media models only on the website, when the login token is set.
    if (ctx.env.GLBGPT_TOKEN) {
      const have = new Set(models.map((m) => String(m.id).toLowerCase()));
      for (const id of Object.keys(WEBSITE_MEDIA_MODELS)) {
        const w = websiteMedia(id);
        if (!have.has(id) && (!a.type || a.type === w.type)) models.push(websiteMediaEntry(w));
      }
    }
    // Chat models the API doesn't list but the website has, when the login token is set.
    if (ctx.env.GLBGPT_TOKEN && (!a.type || a.type === "chat")) {
      const have = new Set(models.map((m) => String(m.id).toLowerCase()));
      for (const id of [...Object.keys(WEBSITE_CHAT_MODELS), ...Object.keys(WEBSITE_AGENTS)]) if (!have.has(id)) models.push(websiteEntry(websiteModel(id)));
    }
    return { count: models.length, models };
  },
  async glbgpt_usage(ctx, a) {
    const limit = new CreditLimit(ctx.env);
    const n = Number.isInteger(a.recent) ? a.recent : 10;
    let recent, recentWebsite, charges;
    if (n > 0) {
      try {
        recent = list(await new GlobalGPT(ctx.env).tasks(n)).map(taskView);
      } catch (e) {
        recent = `Couldn't load recent generations: ${e.message}`;
      }
      if (ctx.env.GLBGPT_TOKEN) {
        try {
          const b = await webRequest(ctx.env, "GET", `${WEB}/user-api/api/user/bill/list?page=1&pagesize=${Math.min(50, n)}&direction=all`);
          charges = (Array.isArray(b?.data?.list) ? b.data.list : []).slice(0, n).map((x) => defined({
            what: x.display_name ?? x.model ?? x.category_name, credits: x.direction === "increase" ? Number(x.cost) : -Number(x.cost),
            list_price: x.original_cost !== undefined && Number(x.original_cost) !== Number(x.cost) ? Number(x.original_cost) : undefined,
            kind: x.source_type, date: x.created_at,
          }));
        } catch (e) {
          charges = `Couldn't load the credit records: ${e.message}`;
        }
        try {
          recentWebsite = await websiteRecent(ctx.env, n);
        } catch (e) {
          recentWebsite = `Couldn't load recent website generations: ${e.message}`;
        }
      }
    }
    return {
      daily_limit: limit.invalid !== undefined ? `invalid value "${limit.invalid}"` : limit.limit === null ? "none" : limit.limit,
      spent_today_via_connector: await limit.spent(),
      limit_resets: `midnight ${LIMIT_TIMEZONE}`,
      ...(recent !== undefined ? { recent } : {}),
      ...(recentWebsite !== undefined ? { recent_website: recentWebsite } : {}),
      ...(charges !== undefined ? { credit_records: charges } : {}),
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
