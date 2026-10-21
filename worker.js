// glbgpt-mcp: a remote MCP server on Cloudflare Workers for your GlobalGPT account.
// Same shape as discord-mcp: JSON-RPC over HTTP, secret in a header or the URL, /health.
// The GlobalGPT calls mirror @glbgpt/cli 0.2.4 (the official stdio MCP server).

const API = "https://api2.glbgpt.com";
const UA = "glbgpt-mcp-worker/1.0 (cloudflare-workers)";
const SERVER_INFO = { name: "glbgpt-mcp", version: "1.0.0" };
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const LIMIT_TIMEZONE = "Europe/Berlin"; // the daily credit counter resets at midnight here
const WAIT_MS = 40000; // how long one generate/check call waits for a result before returning
const POLL_MS = 3000;
const DEFAULT_CHAT_MODEL = "gpt-5.6-sol";

const INSTRUCTIONS = [
  "Chat with GlobalGPT's models and generate images and videos with the owner's GlobalGPT account.",
  "Image and video generation spends the owner's credits: generate only what the user asked for, and never retry a failed video on your own (interrupted renders may still be charged).",
  "Results are returned as URLs. If a generate call returns status 'generating', call glbgpt_check_task with the task_id right away and keep calling it until it succeeds or fails; the server waits inside each call.",
  "Reference images must be http(s) or data: URLs.",
].join(" ");

// ---------------------------------------------------------------------------
// Media models (from @glbgpt/cli src/media/manifest.ts; the CLI bakes these in too)
// ---------------------------------------------------------------------------
const NANO_RATIOS = ["Auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "16:9", "9:16", "21:9"];
const GPT_IMAGE_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "2:1", "1:2", "21:9", "9:21"];
const SEEDREAM_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2", "21:9"];
const IDEOGRAM_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "16:10", "10:16", "2:1", "1:2", "3:1", "1:3"];
const GROK_RATIOS = ["Auto", "16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"];
const seconds = (min, max) => Array.from({ length: max - min + 1 }, (_, i) => String(min + i));
const firstFrame = (p) => p.startImage ?? p.images?.[0];
const auto = (r) => (r === "Auto" ? "auto" : r);

const nanoBanana = (id, displayName, agentId, model, maxImages, estimate) => ({
  id, displayName, type: "image", agentId,
  submitPath: "/ai-api/ai/nano_banana_vertexai/task/submit",
  estimateModel: id,
  support: { aspectRatios: NANO_RATIOS, resolutions: ["1K", "2K", "4K"], defaultResolution: "2K", maxImages },
  buildBody(p) {
    return {
      agentId, hidePrompt: 0, batch: 1, productNo: "glbgpt", enhancePrompt: false, shareStatus: 0,
      image_request: {
        text: p.prompt, imageUrls: p.images ?? [], aspectRatio: auto(p.aspectRatio), imageSize: p.resolution,
        model, generationConfig: { responseModalities: ["IMAGE"] },
      },
    };
  },
  buildEstimateParams: estimate,
});

const seedream = (id, displayName, agentId, model, resolutions, estimate) => ({
  id, displayName, type: "image", agentId,
  submitPath: "/ai-api/ai/seedream45/task/submit",
  estimateModel: id,
  support: { aspectRatios: SEEDREAM_RATIOS, resolutions, maxImages: 8 },
  buildBody(p) {
    return {
      agentId, productNo: "glbgpt", enhancePrompt: false, shareStatus: 0, model,
      prompt: p.prompt, aspectRatio: p.aspectRatio, size: p.resolution, image: p.images ?? [],
    };
  },
  buildEstimateParams: estimate,
});

const ideogram3 = (id, displayName, agentId, model) => ({
  id, displayName, type: "image", agentId,
  submitPath: "/ai-api/ai/ideogram3/task/submit",
  estimateModel: id,
  support: { aspectRatios: IDEOGRAM_RATIOS, supportsSeed: true, supportsNegativePrompt: true, maxImages: 3 },
  buildBody(p) {
    return {
      agentId, productNo: "glbgpt", batch: 1, hidePrompt: 0, shareStatus: 0, enhancePrompt: false,
      image_request: {
        prompt: p.prompt, model, aspect_ratio: p.aspectRatio,
        ...(p.seed !== undefined ? { seed: p.seed } : {}),
        ...(p.negativePrompt ? { negative_prompt: p.negativePrompt } : {}),
        ...(p.images?.length ? { style_reference_images: p.images } : {}),
      },
    };
  },
  buildEstimateParams: () => ({}),
});

const seedance2 = (id, displayName, agentId) => ({
  id, displayName, type: "video", agentId,
  submitPath: "/ai-api/ai/seedance2/task/submit",
  estimateModel: id,
  support: {
    aspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"], resolutions: ["480p", "720p"], defaultResolution: "480p",
    durations: seconds(4, 15), defaultDuration: 5, supportsAudio: true, supportsSeed: true, supportsStartEndFrame: true,
  },
  buildBody(p) {
    const image = firstFrame(p);
    return {
      agentId, model: id, productNo: "glbgpt", prompt: p.prompt, duration: p.duration,
      ratio: p.aspectRatio ?? "16:9", resolution: p.resolution, generateAudio: p.generateAudio ?? false,
      ...(image ? { image } : {}),
      ...(p.endImage ? { lastFrameImage: p.endImage } : {}),
      ...(p.seed !== undefined ? { seed: p.seed } : {}),
      shareStatus: 0, hidePrompt: 0,
    };
  },
  buildEstimateParams: (p) => ({ resolution: p.resolution, duration_seconds: p.duration }),
});

const MODELS = [
  nanoBanana("nano-banana-2", "Nano Banana 2", "6136", "nano_banana_2", 8,
    (p) => ({ aspect_ratio: p.aspectRatio, resolution: p.resolution, n: 1 })),
  seedream("seedream-5.0-lite", "Seedream 5.0 Lite", "6135", "Seedream 5.0 Lite", ["2K", "3K"],
    (p) => ({ aspect_ratio: p.aspectRatio, resolution: p.resolution })),
  {
    id: "gpt-image-2", displayName: "GPT Image 2", type: "image", agentId: "6160",
    submitPath: "/ai-api/ai/apimart/image/generate",
    estimateModel: "gpt-image-2",
    support: { aspectRatios: GPT_IMAGE_RATIOS, maxImages: 4 },
    buildBody(p) {
      return {
        agentId: "6160", hidePrompt: 0, model: "gpt-image-2", productNo: "glbgpt", prompt: p.prompt, shareStatus: 0,
        size: p.aspectRatio, imageUrls: (p.images ?? []).slice(0, 4), n: 1, enhancePrompt: false,
      };
    },
    buildEstimateParams: (p) => ({ aspect_ratio: p.aspectRatio }),
  },
  seedream("seedream-4.5", "Seedream 4.5", "6117", "seedream-4.5", ["2K", "4K"], () => ({})),
  nanoBanana("nano-banana-pro", "Nano Banana Pro", "6106", "nano_banana_pro", 14, (p) => ({ resolution: p.resolution })),
  ideogram3("ideogram-3.0-turbo", "Ideogram 3.0 Turbo", "6082", "Ideogram 3.0 turbo"),
  ideogram3("ideogram-3.0", "Ideogram 3.0", "6083", "Ideogram 3.0 Default"),
  ideogram3("ideogram-3.0-quality", "Ideogram 3.0 Quality", "6084", "Ideogram 3.0 quality"),
  {
    id: "grok-imagine-video", displayName: "Grok Imagine (video)", type: "video", agentId: "6153",
    submitPath: "/ai-api/ai/grok-imagine/task/submit",
    estimateModel: "grok-imagine-video",
    support: { aspectRatios: GROK_RATIOS, resolutions: ["720p", "480p"], durations: seconds(1, 15), defaultDuration: 5, maxImages: 1 },
    buildBody(p) {
      const image = firstFrame(p);
      return {
        agentId: "6153", model: "grok-imagine-video", productNo: "glbgpt", prompt: p.prompt, duration: p.duration,
        aspectRatio: auto(p.aspectRatio), resolution: p.resolution, imageUrls: image ? [image] : [],
        enhancePrompt: false, shareStatus: 0, hidePrompt: 0,
      };
    },
    buildEstimateParams: (p) => ({ duration_seconds: p.duration }),
  },
  {
    id: "grok-imagine-video-1.5", displayName: "Grok Imagine 1.5", type: "video", agentId: "6173",
    submitPath: "/ai-api/ai/grok-imagine15/task/submit",
    estimateModel: "grok-imagine-video-1.5",
    support: {
      aspectRatios: GROK_RATIOS, resolutions: ["720p", "480p"], defaultResolution: "720p",
      durations: seconds(1, 15), defaultDuration: 5, maxImages: 1, requiresImage: true,
    },
    buildBody(p) {
      return {
        agentId: "6173", model: "grok-imagine-video-1.5", productNo: "glbgpt", prompt: p.prompt, duration: p.duration,
        aspectRatio: auto(p.aspectRatio ?? "Auto"), resolution: p.resolution, imageUrls: [firstFrame(p)],
        enhancePrompt: false, shareStatus: 0, hidePrompt: 0,
      };
    },
    buildEstimateParams: (p) => ({ duration_seconds: p.duration }),
  },
  {
    id: "veo-3.1", displayName: "Veo 3.1", type: "video", agentId: "6090",
    submitPath: "/ai-api/ai/openai-next/veo3.1/task/submit",
    estimateModel: "veo3.1",
    estimateModelFor: (p) => (firstFrame(p) ? "veo3.1-i2v" : "veo3.1"),
    support: {
      aspectRatios: ["16:9", "9:16"], resolutions: ["720p", "1080p"], defaultResolution: "1080p",
      durations: ["8"], defaultDuration: 8, maxImages: 1, supportsSeed: true,
    },
    buildBody(p) {
      const image = firstFrame(p);
      return {
        agentId: "6090", model: image ? "veo3.1-i2v" : "veo3.1", productNo: "glbgpt", prompt: p.prompt,
        ...(image ? { image } : {}),
        duration: p.duration, seed: p.seed ?? -1, aspectRatio: p.aspectRatio ?? "16:9", resolution: p.resolution,
        enhancePrompt: false, shareStatus: 0, hidePrompt: 0,
      };
    },
    buildEstimateParams: () => ({}),
  },
  seedance2("seedance-2.0", "Seedance 2.0", "6154"),
  seedance2("seedance-2.0-fast", "Seedance 2.0 Fast", "6155"),
  {
    id: "happyhorse-1.0", displayName: "Happy Horse 1.0", type: "video", agentId: "6164",
    submitPath: "/ai-api/ai/happyhorse/task/submit",
    estimateModel: "happyhorse-1.0-t2v",
    estimateModelFor: (p) => (firstFrame(p) ? "happyhorse-1.0-i2v" : "happyhorse-1.0-t2v"),
    support: {
      aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"], resolutions: ["720p", "1080p"], defaultResolution: "720p",
      durations: seconds(3, 15), defaultDuration: 5, maxImages: 1, supportsSeed: true,
    },
    buildBody(p) {
      const image = firstFrame(p);
      return {
        agentId: "6164", model: image ? "happyhorse-1.0-i2v" : "happyhorse-1.0-t2v", productNo: "glbgpt", prompt: p.prompt,
        resolution: p.resolution?.replace("p", "P"), ratio: p.aspectRatio ?? "16:9", duration: p.duration,
        ...(image ? { img_url: image } : {}),
        ...(p.seed !== undefined ? { seed: p.seed } : {}),
        shareStatus: 0, hidePrompt: 0,
      };
    },
    buildEstimateParams: (p) => ({ resolution: p.resolution, duration_seconds: p.duration }),
  },
];
const DEFAULT_MODEL = { image: "nano-banana-2", video: "grok-imagine-video" };

// Resolution vocabulary: image tiers 0.5K/1K/2K/3K/4K, video 480p/720p/1080p, converted across classes.
const VIDEO_TO_IMAGE = { "480p": "0.5K", "720p": "1K", "1080p": "2K", "2160p": "4K", "4k": "4K" };
const IMAGE_TO_VIDEO = { "0.5K": "480p", "1K": "720p", "2K": "1080p", "4K": "1080p" };
function normalizeResolution(type, value) {
  const v = value.trim();
  if (type === "image") return VIDEO_TO_IMAGE[v.toLowerCase()] ?? v.toUpperCase();
  return IMAGE_TO_VIDEO[v.toUpperCase()] ?? v.toLowerCase();
}

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
const isRef = (v) => /^(https?:|data:)/i.test(v);

const PAYMENT_MESSAGES = {
  4002: "Insufficient credit balance. Top up at glbgpt.com to continue.",
  4003: "Your plan's credits for the current period are used up; they come back when the next period starts.",
  4004: "Your plan isn't active for this period yet.",
  4009: "This model requires a PRO plan.",
  4010: "This model requires an Unlimited plan.",
};
const paymentMessage = (body) =>
  PAYMENT_MESSAGES[body?.data?.subCode] ?? (str(body?.message) || "Payment or plan requirement not met.");

const TOKEN_ERROR = "GlobalGPT rejected the token (expired or wrong). Run `glbgpt login` on your computer and paste the new token into GLBGPT_TOKEN on the Worker.";

function describeTaskFailure(errorCode, reason) {
  const code = String(errorCode ?? "").toUpperCase();
  const raw = str(reason) ?? "";
  const detail = raw ? ` (${raw.slice(0, 160)})` : "";
  if (/CONTENT|REJECT|MODERAT|SAFETY|POLICY|NSFW/.test(code)) return `Rejected by content safety. Try rephrasing the prompt or a different reference image.${detail}`;
  if (/INSUFFICIENT|CREDIT|BALANCE|FUNDS/.test(code)) return "Insufficient credit balance.";
  if (/DOWNLOAD|INPUT/.test(code)) return `A reference image couldn't be downloaded; make sure its URL is public.${detail}`;
  if (/PROVIDER|UPSTREAM/.test(code)) return `The model provider returned an error.${detail}`;
  if (/NETWORK|TIMEOUT/.test(code)) return `The generation timed out or hit a network error.${detail}`;
  return raw || "Generation failed.";
}

// ---------------------------------------------------------------------------
// GlobalGPT API client
// ---------------------------------------------------------------------------
class GlobalGPT {
  constructor(env) {
    if (!env.GLBGPT_TOKEN) throw new ToolError("GLBGPT_TOKEN is not set on the Worker.");
    this.token = env.GLBGPT_TOKEN;
  }
  headers(extra = {}) {
    return { Authorization: `Bearer ${this.token}`, "User-Agent": UA, "X-GLB-Surface": "mcp", ...extra };
  }
  async request(method, path, body) {
    let res;
    try {
      res = await fetch(API + path, {
        method,
        headers: this.headers(body !== undefined ? { "Content-Type": "application/json" } : {}),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new ToolError(`Couldn't reach GlobalGPT: ${e && e.message}`);
    }
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ToolError(`GlobalGPT answered HTTP ${res.status} without JSON. Try again in a moment.`);
    }
    // The gateway uses HTTP 200 with a business code in the body.
    if (res.status === 401 || data?.code === 401) throw new ToolError(TOKEN_ERROR);
    if (data?.code === 429) throw new ToolError("GlobalGPT says too many requests; wait a moment and try again.");
    return data;
  }
  userInfo() {
    return this.request("GET", "/user-api/api/user/info");
  }
  models() {
    return this.request("GET", "/ai-api/cli/v1/models");
  }
  estimate(model, params) {
    return this.request("POST", "/ai-api/ai/bill/estimatePrice", { productNo: "glbgpt", model, params });
  }
  async submit(path, body) {
    const data = await this.request("POST", path, { ...body, device: { deviceType: "pc", osplatform: "cli" } });
    if (data?.code === 402) throw new ToolError(paymentMessage(data));
    if (typeof data?.taskId !== "string" || !data.taskId) throw new ToolError(str(data?.message) ?? "Submit failed: no task id returned.");
    return data.taskId;
  }
  async task(taskId) {
    const data = await this.request("POST", "/ai-api/ai/task/get", { taskId });
    if (!data?.task) throw new ToolError(`No task found with id ${taskId}. Use a task_id returned by glbgpt_generate_image or glbgpt_generate_video.`);
    return data.task;
  }
  // Upload a data: URL as a file and return its hosted URL (the generation endpoints want URLs).
  async uploadDataUrl(agentId, dataUrl) {
    const m = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
    if (!m) throw new ToolError("A data: URL reference image is malformed.");
    const type = m[1] || "application/octet-stream";
    const bytes = m[2] ? Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]));
    const ext = (type.split("/")[1] || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "bin";
    const form = new FormData();
    form.append("agentId", agentId);
    form.append("files", new Blob([bytes], { type }), `reference.${ext}`);
    let res;
    try {
      res = await fetch(`${API}/ai-api/ai/storage/upload`, { method: "POST", headers: this.headers(), body: form });
    } catch (e) {
      throw new ToolError(`Couldn't upload the reference image: ${e && e.message}`);
    }
    const data = await res.json().catch(() => null);
    if (data?.code === 401) throw new ToolError(TOKEN_ERROR);
    const url = data?.files?.[0]?.url;
    if (typeof url !== "string" || !url) throw new ToolError(str(data?.message) ?? "Uploading the reference image failed.");
    return url;
  }
  // One chat turn on the OpenAI-compatible streaming endpoint; returns the full answer text.
  async chat(req) {
    let res;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await fetch(`${API}/ai-api/cli/v1/chat/completions`, {
          method: "POST",
          headers: this.headers({ "Content-Type": "application/json", Accept: "text/event-stream", "X-GLB-Conversation-Id": crypto.randomUUID() }),
          body: JSON.stringify({ ...req, stream: true }),
        });
      } catch (e) {
        if (attempt < 2) { await sleep(1000 * (attempt + 1)); continue; }
        throw new ToolError(`Couldn't reach GlobalGPT: ${e && e.message}`);
      }
      // Gateway hiccups happen before anything is billed, so they are safe to retry.
      if ([502, 503, 504].includes(res.status) && attempt < 2) { await sleep(1000 * (attempt + 1)); continue; }
      break;
    }
    if (!(res.headers.get("content-type") || "").includes("text/event-stream")) {
      const text = await res.text();
      let body = null;
      try { body = JSON.parse(text); } catch {}
      throw new ToolError(chatError(body) ?? `Chat request failed: ${str(body?.message) ?? (text.slice(0, 200) || `HTTP ${res.status}`)}`);
    }
    let answer = "", buffer = "";
    const decoder = new TextDecoder();
    const handle = (line) => {
      if (!line.startsWith("data:")) return;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") return;
      let chunk;
      try { chunk = JSON.parse(data); } catch { return; }
      const err = chatError(chunk);
      if (err) throw new ToolError(err);
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (typeof delta === "string") answer += delta;
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
    return answer;
  }
}

// A business or provider error inside a chat response; null when the body is a normal chunk.
function chatError(body) {
  if (!body || typeof body !== "object") return null;
  if (typeof body.code === "number" && (body.code >= 400 || (body.choices === undefined && body.usage === undefined))) {
    if (body.code === 401) return TOKEN_ERROR;
    if (body.code === 402) return paymentMessage(body);
    if (body.code === 429) return "GlobalGPT says too many requests; wait a moment and try again.";
    return `Chat request failed: ${str(body.message) ?? `code ${body.code}`}`;
  }
  const e = body.error ?? (body.type === "response.failed" ? body.response?.error : undefined);
  if (e || body.type === "error" || body.type === "response.failed") {
    const msg = typeof e === "string" ? e : str(e?.message) ?? str(e?.type) ?? str(body.message);
    return `The model provider reported an error${msg ? `: ${msg}` : "."}`;
  }
  return null;
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
    if (this.limit === 0) throw new ToolError("Image and video generation is blocked: DAILY_CREDIT_LIMIT on the Worker is 0.");
    if (this.limit !== null && !this.kv) throw new ToolError("DAILY_CREDIT_LIMIT is set, but the CREDITS KV namespace isn't bound to the Worker, so today's spend can't be counted. Bind it, or delete DAILY_CREDIT_LIMIT.");
  }
  async spent() {
    if (!this.kv) return null;
    return Number((await this.kv.get(this.key)) || 0);
  }
  // Check the estimate against today's total and record it. Returns the amount to roll back on failure.
  async reserve(credits) {
    this.check();
    if (!this.kv) return 0; // no limit and no counter
    if (this.limit !== null) {
      const spent = await this.spent();
      if (spent + credits > this.limit) {
        throw new ToolError(
          `Daily limit reached: this generation costs ~${credits} credits and ${spent} of today's ${this.limit} are used. ` +
          `It resets at midnight (${LIMIT_TIMEZONE}). The owner can raise DAILY_CREDIT_LIMIT on the Worker, or delete it for no limit.`
        );
      }
    }
    await this.add(credits); // counted even without a limit, so glbgpt_account can show today's spend
    return credits;
  }
  async add(credits) {
    const next = Math.max(0, ((await this.spent()) || 0) + credits);
    await this.kv.put(this.key, String(next), { expirationTtl: 3 * 86400 });
    return next;
  }
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
const mediaCommon = {
  prompt: { type: "string", minLength: 1, description: "What to generate." },
  model: { type: "string", description: "Model id; omit unless the user asked for a specific model. See glbgpt_list_models." },
  aspect_ratio: { type: "string", description: "e.g. 1:1, 16:9, 9:16. Set only if the user asks." },
  resolution: { type: "string", description: "Images: e.g. 1K, 2K, 4K; videos: e.g. 480p, 720p, 1080p. Set only if the user asks." },
  seed: { type: "integer", description: "Set only if the user gives a seed." },
  negative_prompt: { type: "string", description: "Set only if the user says what to avoid." },
};
const refHint = "An http(s) URL or a data: URL.";
const spendNote = "Spends credits from the owner's GlobalGPT account (the owner may have set a daily credit limit). Returns the finished result (url) or a task_id for glbgpt_check_task.";

const TOOLS = [
  {
    name: "glbgpt_chat",
    title: "GlobalGPT chat",
    description: "Ask one of GlobalGPT's chat models a single question and get the answer. Optionally set a system prompt, choose a model, attach images for the model to see, or pass a JSON Schema (response_schema) to get JSON back. See glbgpt_list_models for the chat models.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", minLength: 1, description: "The question or instruction for the model." },
        system: { type: "string", description: "Optional system prompt." },
        model: { type: "string", description: `Chat model id (default ${DEFAULT_CHAT_MODEL}).` },
        images: { type: "array", items: { type: "string" }, maxItems: 10, description: `Images for the model to see. Each: ${refHint}` },
        response_schema: { type: "object", description: "Optional JSON Schema; the answer is then JSON matching it." },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "glbgpt_generate_image",
    title: "GlobalGPT image generation",
    description: `Generate an image from a text prompt, optionally building on reference images. ${spendNote}`,
    inputSchema: {
      type: "object",
      properties: { ...mediaCommon, reference_images: { type: "array", items: { type: "string" }, maxItems: 14, description: `Images to build on. Each: ${refHint}` } },
      required: ["prompt"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "glbgpt_generate_video",
    title: "GlobalGPT video generation",
    description: `Generate a video from a text prompt, optionally from a start (and end) frame. Videos usually take minutes. ${spendNote}`,
    inputSchema: {
      type: "object",
      properties: {
        ...mediaCommon,
        duration: { type: "integer", description: "Length in seconds. Set only if the user asks." },
        generate_audio: { type: "boolean", description: "Sound on/off. Set only if the user explicitly asks." },
        start_image: { type: "string", description: `First frame for image-to-video. ${refHint}` },
        end_image: { type: "string", description: `Last frame (with start_image). ${refHint}` },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "glbgpt_check_task",
    title: "Check a GlobalGPT generation",
    description: "Check an image or video generation by task_id. Each call waits up to 40 seconds for the result; if it still says generating, call it again right away until you get the url or a failure reason.",
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string", minLength: 1, description: "The task_id from glbgpt_generate_image or glbgpt_generate_video." } },
      required: ["task_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "glbgpt_list_models",
    title: "List GlobalGPT models",
    description: "List the available chat, image and video models and what each supports. Capability keys match the generate tools' parameters: aspect_ratios, resolutions, durations_seconds, audio (generate_audio), start_image/end_image, reference_images; requires_image means the video model can't run from text alone. Prices aren't listed; each generation is priced when it runs.",
    inputSchema: {
      type: "object",
      properties: { type: { type: "string", enum: ["chat", "image", "video"], description: "Only list this kind of model." } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "glbgpt_account",
    title: "GlobalGPT account",
    description: "The owner's GlobalGPT account: email, plan, remaining credits, and this connector's daily credit limit with today's spend. Useful before large generations or after a payment or limit error.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
];

function findModel(id, type) {
  const spec = MODELS.find((m) => m.id === id);
  if (spec && spec.type === type) return spec;
  const ids = MODELS.filter((m) => m.type === type).map((m) => m.id);
  if (spec) throw new ToolError(`${id} is a ${spec.type} model. ${type} models: ${ids.join(", ")}.`);
  const close = ids.filter((m) => m.includes(id) || id.includes(m));
  throw new ToolError(`Unknown ${type} model "${id}". ${close.length ? `Did you mean: ${close.join(", ")}?` : `Available: ${ids.join(", ")}.`}`);
}

// Validate the tool arguments against the model's declared support (no silent clamping).
function buildParams(spec, a) {
  const s = spec.support;
  const prompt = str(a.prompt);
  if (!prompt) throw new ToolError("prompt is required.");
  const p = { prompt };
  const refs = [a.start_image, a.end_image, ...(Array.isArray(a.reference_images) ? a.reference_images : [])].filter((r) => r !== undefined);
  const bad = refs.find((r) => typeof r !== "string" || !isRef(r));
  if (bad !== undefined) throw new ToolError(`Reference images must be http(s) or data: URLs (got ${String(bad).slice(0, 80)}).`);
  if (spec.type === "image" && a.reference_images?.length) {
    if (a.reference_images.length > (s.maxImages ?? 0)) throw new ToolError(`${spec.id} accepts at most ${s.maxImages ?? 0} reference image(s).`);
    p.images = a.reference_images;
  }
  if (spec.type === "video") {
    if (a.start_image) p.startImage = a.start_image;
    if (a.end_image) {
      if (!s.supportsStartEndFrame) throw new ToolError(`${spec.id} does not support end_image.`);
      if (!a.start_image) throw new ToolError("end_image needs a start_image.");
      p.endImage = a.end_image;
    }
    if (s.requiresImage && !p.startImage) throw new ToolError(`${spec.id} needs a start_image.`);
  }
  if (str(a.aspect_ratio)) {
    const r = str(a.aspect_ratio);
    const allowed = s.aspectRatios ?? [];
    const match = allowed.find((x) => x.toLowerCase() === r.toLowerCase());
    if (!match) throw new ToolError(`${spec.id} does not support aspect ratio "${r}". Allowed: ${allowed.join(", ")}.`);
    p.aspectRatio = match;
  }
  if (str(a.resolution)) {
    if (!s.resolutions) throw new ToolError(`${spec.id} does not take a resolution.`);
    const r = normalizeResolution(spec.type, a.resolution);
    if (!s.resolutions.includes(r)) throw new ToolError(`${spec.id} does not support resolution "${a.resolution}". Allowed: ${s.resolutions.join(", ")}.`);
    p.resolution = r;
  } else if (s.defaultResolution) p.resolution = s.defaultResolution;
  if (spec.type === "video") {
    if (a.duration !== undefined) {
      if (!s.durations?.includes(String(a.duration))) throw new ToolError(`${spec.id} does not support ${a.duration}s. Allowed: ${(s.durations ?? []).join(", ")}.`);
      p.duration = a.duration;
    } else if (s.defaultDuration !== undefined) p.duration = s.defaultDuration;
    if (a.generate_audio === true && !s.supportsAudio) throw new ToolError(`${spec.id} does not generate audio.`);
    if (typeof a.generate_audio === "boolean" && s.supportsAudio) p.generateAudio = a.generate_audio;
  }
  if (a.seed !== undefined) {
    if (!Number.isSafeInteger(a.seed)) throw new ToolError("seed must be an integer.");
    if (!s.supportsSeed) throw new ToolError(`${spec.id} does not take a seed.`);
    p.seed = a.seed;
  }
  if (str(a.negative_prompt)) {
    if (!s.supportsNegativePrompt) throw new ToolError(`${spec.id} does not take a negative_prompt.`);
    p.negativePrompt = str(a.negative_prompt);
  }
  return p;
}

// Poll a task until it finishes or WAIT_MS passes.
async function waitForTask(g, taskId, deadline) {
  for (;;) {
    let t;
    try {
      t = await g.task(taskId);
    } catch (e) {
      // A task id the backend doesn't know, or a bad token, is final; anything else may be a blip.
      if (e instanceof ToolError && /No task found|rejected the token/.test(e.message)) throw e;
      return { status: "generating", task_id: taskId, note: "Couldn't reach GlobalGPT just now. Call glbgpt_check_task again." };
    }
    if (t.status === "success") {
      if (!t.outputFileUrl) throw new ToolError("The task succeeded but returned no URL.");
      return { status: "succeeded", task_id: taskId, url: t.outputFileUrl, media: t.mediaType === 2 ? "video" : "image", width: t.mediaW, height: t.mediaH };
    }
    if (t.status === "failed") throw new ToolError(describeTaskFailure(t.errorCode, t.failedReasonShort ?? t.failedReasonRaw ?? t.failedReason));
    if (Date.now() + POLL_MS > deadline) {
      return {
        status: "generating", task_id: taskId,
        note: "Still generating. Call glbgpt_check_task with this task_id again right away (the server waits inside each call). Don't tell the user it's done yet.",
      };
    }
    await sleep(POLL_MS);
  }
}

async function generate(type, ctx, a) {
  const g = new GlobalGPT(ctx.env);
  const spec = findModel(str(a.model) ?? DEFAULT_MODEL[type], type);
  const p = buildParams(spec, a);
  const limit = new CreditLimit(ctx.env);
  limit.check();

  const est = await g.estimate(spec.estimateModelFor?.(p) ?? spec.estimateModel, spec.buildEstimateParams(p));
  if (!est?.sellable) {
    const reason = est?.reasonCode;
    throw new ToolError(
      reason === "insufficient_funds" ? "Insufficient credit balance." :
      reason === "invalid_user_or_model" ? `${spec.id} isn't available for this account.` :
      `${spec.id} isn't available with these settings${reason ? ` (${reason})` : ""}.`
    );
  }
  const credits = Math.max(0, Number(est.credits) || 0);
  const reserved = await limit.reserve(credits);

  let taskId;
  try {
    // Generation endpoints want URLs: data: URL references are uploaded first.
    const up = (v) => (v && /^data:/i.test(v) ? g.uploadDataUrl(spec.agentId, v) : v);
    if (p.images) p.images = await Promise.all(p.images.map(up));
    p.startImage = await up(p.startImage);
    p.endImage = await up(p.endImage);
    taskId = await g.submit(spec.submitPath, spec.buildBody(p));
  } catch (e) {
    if (reserved) await limit.add(-reserved).catch(() => {}); // nothing was charged
    throw e;
  }
  const result = await waitForTask(g, taskId, Date.now() + WAIT_MS);
  return { ...result, model: spec.id, credits_estimated: credits, ...(limit.limit ? { daily_limit: limit.limit } : {}) };
}

function mediaEntry(m) {
  const s = m.support;
  const e = { id: m.id, name: m.displayName };
  if (m.id === DEFAULT_MODEL[m.type]) e.default = true;
  if (s.aspectRatios?.length) e.aspect_ratios = s.aspectRatios;
  if (s.resolutions?.length) e.resolutions = s.resolutions;
  if (m.type === "image" && (s.maxImages ?? 0) > 0) e.reference_images = s.maxImages;
  if (m.type === "video") {
    if (s.durations?.length) e.durations_seconds = s.durations.map(Number);
    if (s.supportsAudio) e.audio = true;
    if ((s.maxImages ?? 0) > 0) e.start_image = true;
    if (s.supportsStartEndFrame) e.end_image = true;
    if (s.requiresImage) e.requires_image = true;
  }
  if (s.supportsSeed) e.seed = true;
  if (s.supportsNegativePrompt) e.negative_prompt = true;
  return e;
}

// Strip ```json fences or prose around a JSON answer.
function parseJsonAnswer(text) {
  const t = text.trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [t, fenced?.[1], t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)];
  for (const c of candidates) {
    if (!c) continue;
    try { return JSON.parse(c); } catch {}
  }
  throw new ToolError(`The model didn't return valid JSON. Its answer began: ${t.slice(0, 200)}`);
}

const handlers = {
  async glbgpt_chat(ctx, a) {
    const g = new GlobalGPT(ctx.env);
    const prompt = str(a.prompt);
    if (!prompt) throw new ToolError("prompt is required.");
    const images = Array.isArray(a.images) ? a.images : [];
    const bad = images.find((r) => typeof r !== "string" || !isRef(r));
    if (bad !== undefined) throw new ToolError("images must be http(s) or data: URLs.");
    const schema = a.response_schema && typeof a.response_schema === "object" ? a.response_schema : null;
    // JSON mode with the schema in the system prompt works on every model family (DeepSeek has no json_schema).
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
    const answer = await g.chat({ model, messages, ...(schema ? { response_format: { type: "json_object" } } : {}) });
    return schema ? parseJsonAnswer(answer) : { model, answer };
  },
  glbgpt_generate_image: (ctx, a) => generate("image", ctx, a),
  glbgpt_generate_video: (ctx, a) => generate("video", ctx, a),
  async glbgpt_check_task(ctx, a) {
    const taskId = str(a.task_id);
    if (!taskId) throw new ToolError("task_id is required.");
    return waitForTask(new GlobalGPT(ctx.env), taskId, Date.now() + WAIT_MS);
  },
  async glbgpt_list_models(ctx, a) {
    const type = a.type;
    const out = {};
    // Live catalog: chat models plus media models GlobalGPT has switched off. Media specs are built in.
    let catalog = null;
    try { catalog = await new GlobalGPT(ctx.env).models(); } catch (e) { if (type === "chat") throw e; }
    const disabled = new Set(Array.isArray(catalog?.media?.disabled) ? catalog.media.disabled : []);
    for (const m of MODELS) {
      if ((type && m.type !== type) || disabled.has(m.id)) continue;
      (out[m.type] ??= []).push(mediaEntry(m));
    }
    if (!type || type === "chat") {
      const def = str(catalog?.chat?.default) ?? DEFAULT_CHAT_MODEL;
      const models = Array.isArray(catalog?.chat?.models) ? catalog.chat.models.filter((m) => str(m?.id)) : [];
      out.chat = models.length
        ? models.map((m) => ({ id: m.id, ...(str(m.label) && m.label !== m.id ? { description: m.label } : {}), ...(m.id === def ? { default: true } : {}) }))
        : [{ id: DEFAULT_CHAT_MODEL, default: true }, { id: "gpt-5.6-luna" }, { id: "gpt-5.6-terra" }];
    }
    return out;
  },
  async glbgpt_account(ctx) {
    const info = await new GlobalGPT(ctx.env).userInfo();
    const d = info?.data;
    if (!d || typeof d !== "object") throw new ToolError(str(info?.message) ?? "Couldn't read the account.");
    const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
    const pkg = d.currentSubscription?.plan_package;
    const plan = typeof pkg === "string" && pkg
      ? (pkg.startsWith("lifetime_") ? `${pkg.slice(9).replace(/^./, (c) => c.toUpperCase())} (lifetime)` : pkg.replace(/^./, (c) => c.toUpperCase()))
      : null;
    const total = num(d.amount) ?? num(d.balance);
    const limit = new CreditLimit(ctx.env);
    return {
      email: d.email ?? null,
      plan,
      credits_total: total,
      credits_top_up: num(d.balance),
      credits_reset: typeof d.currentSubscription?.end_date === "string" ? d.currentSubscription.end_date.slice(0, 10) : null,
      plan_through: typeof d.subscription?.end_date === "string" ? d.subscription.end_date.slice(0, 10) : null,
      daily_limit: limit.invalid !== undefined ? `invalid value "${limit.invalid}"` : limit.limit === null ? "none" : limit.limit,
      spent_today_via_connector: await limit.spent(),
      limit_resets: `midnight ${LIMIT_TIMEZONE}`,
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
        const args = (msg.params && msg.params.arguments) || {};
        const result = await handler(ctx, args);
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
    GLBGPT_TOKEN: { ...info(env.GLBGPT_TOKEN), looks_like_jwt: !!env.GLBGPT_TOKEN && env.GLBGPT_TOKEN.split(".").length === 3 },
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
