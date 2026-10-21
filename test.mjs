// Local test: runs the Worker in Node against a fake GlobalGPT API. No real calls, no credits spent.
import worker from './worker.js';
const SECRET = 'x'.repeat(40);
const KEY = 'sk-glb-testkey';
const TOKEN = 'aaa.bbb.ccc';
const base = 'https://glb.example.workers.dev';
const API = 'https://api2.glbgpt.com/ai-api/open/v1';

// Fake clock: sleeps return at once and move time forward, so the 40 s waits take no real time.
let now = Date.UTC(2026, 9, 21, 10, 0, 0);
Date.now = () => now;
globalThis.setTimeout = (fn, ms) => { now += ms || 0; Promise.resolve().then(fn); return 0; };

// Fake KV
const kvStore = new Map();
const KV = { get: async (k) => kvStore.get(k) ?? null, put: async (k, v) => { kvStore.set(k, v); }, delete: async (k) => { kvStore.delete(k); } };

// Fake GlobalGPT API
const calls = [];
const state = {};
const defaults = { price: 200, reserved: undefined, polls: 0, pollsUntilDone: 0, fail: null, submitStatus: 200, submitNetErrors: 0, keyBad: false, chatJsonReject: false, estimateStatus: 200, webPay: false, webFail: false, webPolls: 0, webPollsUntilDone: 0 };
const res = (status, d, headers = {}) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const err = (status, code, message = code) => res(status, { error: { message, type: code, code } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
  calls.push({ method: init.method, path: u.pathname.replace('/ai-api/open/v1', ''), search: u.search, headers: init.headers, body });
  if (url === 'https://api2.glbgpt.com/ai-api/ai/agent/chatStream') {
    if (init.headers?.Authorization !== `Bearer ${TOKEN}`) return res(200, { code: 401, message: 'token invalid' });
    if (state.webPay) return res(200, { code: 402, message: 'pay', data: { subCode: 4010 } });
    const sse = ['data:{"event":"message","answer":"O"}\n\n', 'data:{"event":"message","answer":body.json ? "{\\"a\\":" : "K"}\n\n'.replace('body.json ? "{\\"a\\":" : "K"', body.query.includes('JSON Schema') ? '"{\\"a\\":1}"' : '"K"'), 'data:{"event":"message_end","metadata":{"usage":{"prompt_tokens":7000,"completion_tokens":2}}}\n\n'];
    if (body.query.includes('JSON Schema')) sse[0] = 'data:{"event":"message","answer":""}\n\n';
    return new Response(new ReadableStream({ start(c) { for (const l of sse) c.enqueue(new TextEncoder().encode(l)); c.close(); } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }
  if (url.startsWith('https://api2.glbgpt.com/ai-api/') && !url.startsWith(API) && !url.endsWith('/agent/chatStream')) {
    if (init.headers?.Authorization !== `Bearer ${TOKEN}`) return res(200, { code: 401, message: 'token invalid' });
    const wp = u.pathname;
    if (wp === '/ai-api/ai/task/get') { state.webPolls = (state.webPolls || 0) + 1; return res(200, state.webFail ? { code: 1, task: { status: 'failed', failedReason: 'nsfw', errorCode: 'X' } } : state.webPolls > (state.webPollsUntilDone || 0) ? { code: 1, task: { status: 'success', outputFileUrl: 'https://cdn.example/web.png', mediaType: 1 } } : { code: 1, task: { status: 'processing' } }); }
    if (wp === '/ai-api/ai/heygen/quotes/video') return res(200, { data: { currency: 'usd', estimated_amount: 0.25 } });
    if (wp === '/ai-api/ai/heygen/videos') return res(200, { operation: { id: 'op1', status: 'pending', kind: 'create_video', billing_status: 'reserved' } });
    if (wp.startsWith('/ai-api/ai/heygen/operations/')) return res(200, { operation: { id: 'op1', status: 'succeeded' }, data: { video_url: 'https://cdn.example/heygen.mp4' } });
    if (wp === '/ai-api/ai/heygen/voices') return res(200, { data: [{ voice_id: 'v1', name: 'Anna', language: 'de', type: 'public' }, { voice_id: 'v2', type: 'private' }] });
    if (state.webPay) return res(200, { code: 402, message: 'pay', data: { subCode: 4002 } });
    return res(200, { code: 1, taskId: 'w1' });
  }
  if (!url.startsWith(API)) return err(404, 'wrong_host');
  if (state.keyBad || init.headers?.Authorization !== `Bearer ${KEY}`) return err(401, 'invalid_api_key');
  const p = u.pathname.replace('/ai-api/open/v1', '');
  if (p === '/models' && init.method === 'GET') return res(200, { object: 'list', data: [{ id: 'nano-banana-2.1', type: u.searchParams.get('type') || 'image', price: { '1K': 200 } }, { id: 'kling-v3', type: 'video' }] });
  if (p.startsWith('/models/')) return /\/(nope|claude-opus-5\.5|heygen-video)$/.test(p) ? err(404, 'model_not_found', 'Unknown model') : res(200, { id: decodeURIComponent(p.slice(8)), parameters: { resolution: ['1K', '2K'] } });
  if (p === '/tasks/estimate' && ['hidream-o1', 'kling-o1', 'heygen-video', 'video-upscale', 'tripo-h3.1', 'wan-2.6', 'ideogram-4.5', 'scribe-v2', 'made-up-media'].includes(body.model)) return err(404, 'model_not_found', `Unknown model ${body.model}`);
  if (p === '/tasks/estimate') {
    if (state.estimateStatus !== 200) return err(state.estimateStatus, state.estimateStatus === 402 ? 'insufficient_credit' : 'invalid_request', 'nope');
    return res(200, { credits: state.price, billing_model: `${body.model}-tier` });
  }
  if (p === '/tasks' && init.method === 'POST') {
    if (state.submitNetErrors > 0) { state.submitNetErrors--; throw new TypeError('network down'); }
    if (state.submitStatus === 402) return err(402, 'plan_required', 'not in plan');
    if (state.submitStatus === 429) return err(429, 'rate_limit_exceeded', 'slow down');
    return res(200, { id: 't-1', object: 'task', model: body.model, type: 'image', status: 'queued', credits_reserved: state.reserved ?? state.price, ...(body.bogus ? { ignored_parameters: { bogus: 1 } } : {}) });
  }
  if (p === '/tasks' && init.method === 'GET') return res(200, { object: 'list', data: [{ id: 't-0', model: 'kling-v3', type: 'video', status: 'succeeded', credits_reserved: 500, output: { url: 'https://cdn.example/v.mp4' } }] });
  if (p.startsWith('/tasks/')) {
    state.polls++;
    if (p === '/tasks/unknown') return err(404, 'not_found', 'task not found');
    if (state.fail) return res(200, { id: p.slice(7), status: 'failed', error: { code: state.fail, message: 'provider said no', retryable: false } });
    if (state.polls > state.pollsUntilDone) return res(200, { id: p.slice(7), model: 'nano-banana-2.1', type: 'image', status: 'succeeded', credits_reserved: state.reserved ?? state.price, output: { url: 'https://cdn.example/out.png', type: 'image' } });
    return res(200, { id: p.slice(7), status: 'processing' });
  }
  if (p === '/chat/completions') {
    if (['claude-opus-5.5', 'perplexity', 'sonar', 'made-up-model'].includes(body.model)) return err(404, 'model_not_found', `The model '${body.model}' does not exist or you do not have access to it.`);
    if (body.response_format && state.chatJsonReject) return err(400, 'upstream_rejected', 'json mode not supported');
    const content = body.response_format || /JSON Schema/.test(body.messages[0]?.content ?? '') ? '```json\n{"a":1}\n```' : 'Hello';
    return res(200, { id: 'c1', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } });
  }
  return err(404, 'unmocked');
};

const env = (extra = {}) => ({ GLBGPT_API_KEY: KEY, CONNECTOR_SECRET: SECRET, CREDITS: KV, ...extra });
async function rpc(e, method, params, path = `/mcp/${SECRET}`) {
  const r = await worker.fetch(new Request(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }), e);
  const t = await r.text(); let b = null; try { b = t ? JSON.parse(t) : null; } catch { b = t; } return { status: r.status, body: b };
}
const tool = async (e, name, args = {}) => { const r = await rpc(e, 'tools/call', { name, arguments: args }); const out = r.body.result; return { err: out.isError, text: out.content[0].text, json: (() => { try { return JSON.parse(out.content[0].text); } catch { return null; } })() }; };
const reset = (o = {}) => { Object.assign(state, defaults, o); calls.length = 0; kvStore.clear(); };
let failures = 0;
const check = (label, cond) => { if (!cond) failures++; console.log((cond ? 'PASS ' : 'FAIL ') + label); };
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
const spentKey = `spent:${day}`;
const submits = () => calls.filter((c) => c.path === '/tasks' && c.method === 'POST');

// auth / routing (same rules as discord-mcp)
reset();
check('wrong secret -> 404', (await rpc(env(), 'initialize', {}, '/mcp/wrong')).status === 404);
check('root -> 404', (await worker.fetch(new Request(base + '/'), env())).status === 404);
check('GET on mcp -> 405', (await worker.fetch(new Request(base + `/mcp/${SECRET}`), env())).status === 405);
const init = await rpc(env(), 'initialize', { protocolVersion: '2025-06-18' });
check('initialize echoes version + instructions', init.body.result.protocolVersion === '2025-06-18' && init.body.result.instructions.includes('credits'));
const note = await worker.fetch(new Request(base + `/mcp/${SECRET}`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }), env());
check('notification -> 202', note.status === 202);
const names = (await rpc(env(), 'tools/list')).body.result.tools.map((t) => t.name);
check('tools/list has the 5 tools', names.join() === 'glbgpt_chat,glbgpt_generate,glbgpt_check_task,glbgpt_list_models,glbgpt_usage');
const hdr = (h, e = env(), path = '/mcp') => worker.fetch(new Request(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }), e);
check('Bearer header works', (await hdr({ Authorization: 'Bearer ' + SECRET })).status === 200);
check('X-API-Key header works', (await hdr({ 'X-API-Key': SECRET })).status === 200);
check('wrong header -> 404', (await hdr({ Authorization: 'Bearer wrong' })).status === 404);
check('DISABLE_URL_SECRET blocks secret in path', (await rpc(env({ DISABLE_URL_SECRET: 'true' }), 'tools/list')).status === 404);
check('short secret refused', (await rpc(env({ CONNECTOR_SECRET: 'short' }), 'ping', {}, '/mcp/short')).status === 404);
check('unknown tool -> error', (await rpc(env(), 'tools/call', { name: 'toString' })).body.error?.code === -32602);

// chat
reset();
let r = await tool(env(), 'glbgpt_chat', { prompt: 'hi', model: 'gpt-5.6-luna' });
const chatCall = calls.find((c) => c.path === '/chat/completions');
check('chat returns the answer + usage', !r.err && r.json.answer === 'Hello' && r.json.model === 'gpt-5.6-luna' && r.json.usage.completion_tokens === 2);
check('chat sends API key, no stream, messages', chatCall.headers.Authorization === `Bearer ${KEY}` && chatCall.body.stream === false && chatCall.body.messages.at(-1).content === 'hi');
reset();
r = await tool(env(), 'glbgpt_chat', { prompt: 'json please', system: 'be brief', response_schema: { type: 'object', properties: { a: { type: 'number' } } } });
const jc = calls.find((c) => c.path === '/chat/completions').body;
check('chat with schema -> parsed JSON via json_object', !r.err && r.json.a === 1 && jc.response_format.type === 'json_object' && jc.messages[0].content.includes('be brief'));
reset({ chatJsonReject: true });
r = await tool(env(), 'glbgpt_chat', { prompt: 'json please', response_schema: { type: 'object' } });
check('model without JSON mode -> retried without it, still JSON', !r.err && r.json.a === 1 && calls.filter((c) => c.path === '/chat/completions').length === 2);
reset();
r = await tool(env(), 'glbgpt_chat', { prompt: 'look', images: ['data:image/png;base64,AAAA'] });
check('chat with data: image sends image_url part', !r.err && calls[0].body.messages[0].content[1].image_url.url.startsWith('data:'));
r = await tool(env(), 'glbgpt_chat', { prompt: 'look', images: ['/Users/me/a.png'] });
check('chat refuses local paths', r.err);
reset({ keyBad: true });
r = await tool(env(), 'glbgpt_chat', { prompt: 'hi' });
check('bad API key -> clear message', r.err && r.text.includes('GLBGPT_API_KEY'));
r = await tool(env({ GLBGPT_API_KEY: '' }), 'glbgpt_chat', { prompt: 'hi' });
check('missing API key -> clear message', r.err && r.text.includes('is not set'));

// website fallback for chat models the API doesn't have
reset();
const envT = (x = {}) => env({ GLBGPT_TOKEN: TOKEN, ...x });
r = await tool(envT(), 'glbgpt_chat', { prompt: 'hi', system: 'be brief', model: 'claude-opus-5.5' });
const web = calls.find((c) => c.path === '/ai-api/ai/agent/chatStream');
check('API refuses -> website chat answers', !r.err && r.json.answer === 'OK' && r.json.via === 'website' && r.json.model === 'claude-opus-5.5');
check('website call: agent 6242, token, system folded into the query', web.body.agentId === '6242' && web.headers.Authorization === `Bearer ${TOKEN}` && web.body.query === 'be brief\n\nhi' && web.body.enableSearch === false);
check('website usage reported', r.json.usage.prompt_tokens === 7000);
reset();
r = await tool(envT(), 'glbgpt_chat', { prompt: 'search', model: 'sonar' });
check('alias sonar -> perplexity (agent 4372)', !r.err && calls.find((c) => c.path === '/ai-api/ai/agent/chatStream').body.agentId === '4372');
reset();
r = await tool(envT(), 'glbgpt_chat', { prompt: 'json', model: 'claude-opus-5.5', response_schema: { type: 'object' } });
check('website chat with schema -> parsed JSON', !r.err && r.json.a === 1);
reset();
r = await tool(envT(), 'glbgpt_chat', { prompt: 'hi', model: 'gpt-5.6-luna' });
check('API models never go to the website', !r.err && !calls.some((c) => c.path === '/ai-api/ai/agent/chatStream'));
reset();
r = await tool(env(), 'glbgpt_chat', { prompt: 'hi', model: 'claude-opus-5.5' });
check('website model without token -> asks for GLBGPT_TOKEN', r.err && r.text.includes('GLBGPT_TOKEN'));
r = await tool(envT(), 'glbgpt_chat', { prompt: 'hi', model: 'made-up-model' });
check('unknown everywhere -> the API error, no website call', r.err && r.text.includes('does not exist') && !calls.some((c) => c.path === '/ai-api/ai/agent/chatStream'));
r = await tool(envT(), 'glbgpt_chat', { prompt: 'look', model: 'claude-opus-5.5', images: ['https://x.example/a.png'] });
check('website model with images -> clear refusal', r.err && r.text.includes("can't attach images"));
r = await tool(envT({ GLBGPT_TOKEN: 'wrong.wrong.wrong' }), 'glbgpt_chat', { prompt: 'hi', model: 'claude-opus-5.5' });
check('bad token -> login hint', r.err && r.text.includes('glbgpt/cli login'));
reset({ webPay: true });
r = await tool(envT(), 'glbgpt_chat', { prompt: 'hi', model: 'claude-opus-5.5' });
check('website plan refusal -> plan message', r.err && r.text.includes('Unlimited plan'));
reset();
r = await tool(envT(), 'glbgpt_list_models', { type: 'chat' });
check('list models adds website-only chat models (with token)', !r.err && r.json.models.some((m) => m.id === 'claude-opus-5.5' && m.source === 'website') && r.json.models.filter((m) => m.id === 'nano-banana-2.1').length === 1);
r = await tool(env(), 'glbgpt_list_models', { type: 'chat' });
check('without token, no website models listed', !r.json.models.some((m) => m.source === 'website'));
r = await tool(envT(), 'glbgpt_list_models', { type: 'video' });
check('website chat models only in chat lists', !r.json.models.some((m) => m.source === 'website' && m.type === 'chat') && r.json.models.some((m) => m.id === 'kling-o1' && m.source === 'website'));
r = await tool(envT(), 'glbgpt_list_models', { model: 'claude-opus-5.5' });
check('details for a website-only model', !r.err && r.json.source === 'website' && r.json.available === true);

// website-only media
reset();
r = await tool(envT({ DAILY_CREDIT_LIMIT: '5000' }), 'glbgpt_generate', { model: 'hidream-o1', prompt: 'a fox', aspect_ratio: '1:1', images: ['https://x.example/a.png'] });
const hd = calls.find((c) => c.path === '/ai-api/ai/hidream/task/submit');
check('website image: API refuses -> website endpoint, done with url', !r.err && r.json.status === 'succeeded' && r.json.url === 'https://cdn.example/web.png' && r.json.via === 'website' && r.json.task_id === 'web:w1');
check('website image body: model, agent, product no, images', hd.body.model === 'hidream-o1-image' && hd.body.agentId === '6249' && hd.body.productNo === 'glbgpt' && hd.body.images[0] === 'https://x.example/a.png' && hd.headers.Authorization === `Bearer ${TOKEN}`);
check('website image: list price counted (133)', r.json.credits_estimated === 133 && kvStore.get(spentKey) === '133');
reset({ webPollsUntilDone: 99 });
r = await tool(envT({ DAILY_CREDIT_LIMIT: '5000' }), 'glbgpt_generate', { model: 'kling-o1', prompt: 'orbit @Image1', duration: 10, images: ['https://x.example/a.png'] });
const ko = calls.find((c) => c.path === '/ai-api/ai/klingO1/task/submit').body;
check('website video: still running -> web task id + approximate price note', !r.err && r.json.status === 'processing' && r.json.task_id === 'web:w1' && r.json.price_note && r.json.credits_estimated === 2000);
check('kling o1 body: @Image1 rewritten, images as JSON string, duration', ko.prompt === 'orbit <<<image_1>>>' && ko.imageUrls === '["https://x.example/a.png"]' && ko.duration === 10);
state.webPollsUntilDone = 0;
r = await tool(envT(), 'glbgpt_check_task', { task_id: 'web:w1' });
check('check_task on a website task -> url', !r.err && r.json.status === 'succeeded' && r.json.via === 'website');
reset({ webFail: true });
r = await tool(envT({ DAILY_CREDIT_LIMIT: '5000' }), 'glbgpt_generate', { model: 'hidream-o1', prompt: 'x' });
check('failed website task -> reason, taken off the counter', r.err && r.text.includes('nsfw') && kvStore.get(spentKey) === '0');
reset({ webPay: true });
r = await tool(envT({ DAILY_CREDIT_LIMIT: '5000' }), 'glbgpt_generate', { model: 'hidream-o1', prompt: 'x' });
check('website refuses (no credit) -> message, rolled back', r.err && r.text.includes('Insufficient') && kvStore.get(spentKey) === '0');
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'wan-2.6', prompt: 'x', images: ['https://x.example/a.png'] });
const w26 = calls.find((c) => c.path.startsWith('/ai-api/ai/ali-wan26/'));
check('wan 2.6 picks image-to-video endpoint and agent', !r.err && w26.path === '/ai-api/ai/ali-wan26/i2v/task/submit' && w26.body.agentId === '6119' && w26.body.model === 'wan2.6-i2v');
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'video-upscale', video_url: 'https://x.example/v.mp4', duration: 10, resolution: '1080p' });
const vu = calls.find((c) => c.path === '/ai-api/ai/video-tools/task/submit').body;
check('video tool: video + duration, price per second (1247)', !r.err && vu.video === 'https://x.example/v.mp4' && vu.durationSeconds === 10 && r.json.credits_estimated === 1247);
r = await tool(envT(), 'glbgpt_generate', { model: 'video-upscale', video_url: 'https://x.example/v.mp4' });
check('video tool without duration -> asks for it', r.err && r.text.includes('duration'));
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'tripo-h3.1', prompt: 'a chair', metadata: { quad: true } });
const td = calls.find((c) => c.path === '/ai-api/ai/3d/task/submit').body;
check('3D: prompt + options, price 330', !r.err && td.model === 'tripo-h3.1' && td.prompt === 'a chair' && td.quad === true && r.json.credits_estimated === 330);
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'ideogram-4.5', prompt: 'logo', metadata: { quality: 'low' } });
const i45 = calls.find((c) => c.path === '/ai-api/ai/ideogram3/task/submit').body;
check('ideogram 4.5: quality low -> 100, model name in image_request', !r.err && i45.image_request.model === 'Ideogram 4.5' && i45.image_request.quality === 'low' && r.json.credits_estimated === 100);
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'scribe-v2', video_url: 'https://x.example/a.mp3', duration: 125 });
const sc = calls.find((c) => c.path === '/ai-api/voice/elevenlabs/task/submit').body;
check('scribe: audio url, type 2, 12 credits per started minute (36)', !r.err && sc.inputSourceUrl === 'https://x.example/a.mp3' && sc.type === 2 && r.json.credits_estimated === 36);
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'heygen-video', prompt: 'Hallo!', images: ['https://x.example/face.png'], metadata: { voice_id: 'v1' } });
const hq = calls.find((c) => c.path === '/ai-api/ai/heygen/quotes/video').body;
check('heygen: quote first (0.25 USD -> 250), then video, then url', !r.err && r.json.url === 'https://cdn.example/heygen.mp4' && r.json.task_id === 'heygen:op1' && r.json.credits_estimated === 250 && hq.type === 'image' && hq.script === 'Hallo!' && hq.voice_id === 'v1');
r = await tool(envT(), 'glbgpt_generate', { model: 'heygen-video', prompt: 'Hallo!', images: ['https://x.example/face.png'] });
check('heygen without voice -> points to the voices list', r.err && r.text.includes('voice_id'));
r = await tool(envT(), 'glbgpt_list_models', { model: 'heygen-video' });
check('heygen details list public voices', !r.err && r.json.voices.length === 1 && r.json.voices[0].voice_id === 'v1');
r = await tool(env(), 'glbgpt_generate', { model: 'hidream-o1', prompt: 'x' });
check('website media without token -> asks for GLBGPT_TOKEN', r.err && r.text.includes('GLBGPT_TOKEN'));
r = await tool(envT(), 'glbgpt_generate', { model: 'made-up-media', prompt: 'x' });
check('unknown everywhere -> the API error', r.err && r.text.includes('Unknown model'));
r = await tool(envT(), 'glbgpt_generate', { model: 'hidream-o1', prompt: 'x', images: ['data:image/png;base64,AAAA'] });
check('website media refuses data: URIs', r.err && r.text.includes('data:'));
r = await tool(envT(), 'glbgpt_list_models', { type: '3d' });
check('list models type 3d -> the five website 3D models', !r.err && r.json.models.length === 5 && r.json.models.every((m) => m.type === '3d' && m.usage));

// generation
reset();
r = await tool(env(), 'glbgpt_generate', { model: 'nano-banana-2.1', prompt: 'pixel art', aspect_ratio: '1:1', resolution: '1K' });
const est = calls.find((c) => c.path === '/tasks/estimate');
const sub = submits()[0];
check('generate: estimate, then submit, then url', !r.err && r.json.status === 'succeeded' && r.json.url === 'https://cdn.example/out.png' && r.json.credits_estimated === 200 && r.json.billing_tier === 'nano-banana-2.1-tier');
check('generate: estimate and submit get the same body', JSON.stringify(est.body) === JSON.stringify(sub.body) && sub.body.model === 'nano-banana-2.1' && sub.body.aspect_ratio === '1:1');
check('generate: submit carries an Idempotency-Key', /^[0-9a-f-]{36}$/.test(sub.headers['Idempotency-Key']));
check('generate: no limit set, spend still counted', kvStore.get(spentKey) === '200');
check('generate: finished task leaves no bookkeeping behind', ![...kvStore.keys()].some((k) => k.startsWith('task:')));
reset();
r = await tool(env(), 'glbgpt_generate', { model: 'remove-bg', images: ['https://x.example/a.png'] });
check('image tool without prompt is fine', !r.err && submits()[0].body.prompt === undefined && submits()[0].body.images[0] === 'https://x.example/a.png');
r = await tool(env(), 'glbgpt_generate', { model: 'x', images: ['C:\\pics\\a.png'] });
check('local image path refused before anything is sent', r.err && r.text.includes('https'));
r = await tool(env(), 'glbgpt_generate', { prompt: 'x' });
check('missing model -> asks for one', r.err && r.text.includes('model is required'));
reset();
r = await tool(env(), 'glbgpt_generate', { model: 'kling-v3', prompt: 'orbit', duration: 5, audio: true, metadata: { foo: 1 } });
check('video fields + metadata passed through', !r.err && submits()[0].body.duration === 5 && submits()[0].body.audio === true && submits()[0].body.metadata.foo === 1);
reset({ submitNetErrors: 1 });
r = await tool(env(), 'glbgpt_generate', { model: 'nano-banana-2', prompt: 'x' });
const s2 = submits();
check('network error on submit -> one retry with the same Idempotency-Key', !r.err && s2.length === 2 && s2[0].headers['Idempotency-Key'] === s2[1].headers['Idempotency-Key']);
reset({ submitStatus: 402 });
r = await tool(env({ DAILY_CREDIT_LIMIT: '1000' }), 'glbgpt_generate', { model: 'nano-banana-2', prompt: 'x' });
check('submit refused (plan) -> message, reservation rolled back', r.err && r.text.includes("isn't included") && kvStore.get(spentKey) === '0');
reset({ estimateStatus: 402 });
r = await tool(env(), 'glbgpt_generate', { model: 'nano-banana-2', prompt: 'x' });
check('estimate says no credit -> nothing submitted', r.err && r.text.includes('paid credits') && !submits().length);
reset({ submitStatus: 429 });
r = await tool(env(), 'glbgpt_generate', { model: 'nano-banana-2', prompt: 'x' });
check('rate limit -> names the API limits', r.err && r.text.includes('60 requests/min'));

// limit
reset();
r = await tool(env({ DAILY_CREDIT_LIMIT: '400' }), 'glbgpt_generate', { model: 'a', prompt: 'x' });
r = await tool(env({ DAILY_CREDIT_LIMIT: '400' }), 'glbgpt_generate', { model: 'a', prompt: 'x' });
check('limit 400: two 200-credit images ok', !r.err && kvStore.get(spentKey) === '400');
calls.length = 0;
r = await tool(env({ DAILY_CREDIT_LIMIT: '400' }), 'glbgpt_generate', { model: 'a', prompt: 'x' });
check('limit 400: third refused after the price check, nothing submitted', r.err && r.text.includes('Daily limit reached') && !submits().length);
reset({ price: 200, reserved: 260 });
r = await tool(env({ DAILY_CREDIT_LIMIT: '1000' }), 'glbgpt_generate', { model: 'a', prompt: 'x' });
check('counter uses what GlobalGPT actually reserved (260, not the 200 estimate)', !r.err && kvStore.get(spentKey) === '260');
reset();
r = await tool(env({ DAILY_CREDIT_LIMIT: '0' }), 'glbgpt_generate', { model: 'a', prompt: 'x' });
check('limit 0: blocked before pricing', r.err && r.text.includes('is 0') && !calls.length);
r = await tool(env({ DAILY_CREDIT_LIMIT: 'off' }), 'glbgpt_generate', { model: 'a', prompt: 'x' });
check('non-number limit: blocked, not silently unlimited', r.err && r.text.includes("isn't a number") && !calls.length);
r = await tool(env({ DAILY_CREDIT_LIMIT: '5000', CREDITS: undefined }), 'glbgpt_generate', { model: 'a', prompt: 'x' });
check('limit set but no KV: blocked with a hint', r.err && r.text.includes('KV'));
reset();
r = await tool(env({ CREDITS: undefined }), 'glbgpt_generate', { model: 'a', prompt: 'x' });
check('no limit and no KV: works', !r.err && r.json.status === 'succeeded');
check('chat is not counted', (reset(), (await tool(env({ DAILY_CREDIT_LIMIT: '1' }), 'glbgpt_chat', { prompt: 'hi' })).err === false));

// long tasks and failures
reset({ pollsUntilDone: 20 });
r = await tool(env({ DAILY_CREDIT_LIMIT: '1000' }), 'glbgpt_generate', { model: 'kling-v3', prompt: 'orbit' });
check('long task: returns task_id while running', !r.err && r.json.status === 'processing' && r.json.task_id === 't-1' && r.json.note);
check('long task: polls every 5 s within ~40 s', state.polls >= 6 && state.polls <= 9);
r = await tool(env(), 'glbgpt_check_task', { task_id: 't-1' });
r = r.json.status === 'succeeded' ? r : await tool(env(), 'glbgpt_check_task', { task_id: 't-1' });
check('check_task: finishes with url', !r.err && r.json.status === 'succeeded' && r.json.url);
reset({ pollsUntilDone: 99 });
r = await tool(env({ DAILY_CREDIT_LIMIT: '1000' }), 'glbgpt_generate', { model: 'kling-v3', prompt: 'orbit' });
check('running task counted', kvStore.get(spentKey) === '200');
state.fail = 'content_policy_violation';
r = await tool(env({ DAILY_CREDIT_LIMIT: '1000' }), 'glbgpt_check_task', { task_id: 't-1' });
check('failed task -> reason, not charged, taken off the counter', r.err && r.text.includes('safety') && r.text.includes('No credits') && kvStore.get(spentKey) === '0');
r = await tool(env(), 'glbgpt_check_task', { task_id: 't-1' });
check('failing again does not take it off twice', kvStore.get(spentKey) === '0');
reset();
r = await tool(env(), 'glbgpt_check_task', { task_id: 'unknown' });
check('unknown task -> not found', r.err && r.text.toLowerCase().includes('not found'));

// models + usage + health
reset();
r = await tool(env(), 'glbgpt_list_models', { type: 'video' });
check('list models: live list, filtered by type', !r.err && r.json.count === 2 && calls[0].search === '?type=video');
r = await tool(env(), 'glbgpt_list_models', { model: 'kling-v3' });
check('list models: one model details', !r.err && r.json.id === 'kling-v3' && r.json.parameters);
r = await tool(env(), 'glbgpt_list_models', { model: 'nope' });
check('unknown model -> message', r.err && r.text.includes('Unknown model'));
reset();
kvStore.set(spentKey, '1234');
r = await tool(env({ DAILY_CREDIT_LIMIT: '20000' }), 'glbgpt_usage', {});
check('usage: limit, today, recent tasks', !r.err && r.json.daily_limit === 20000 && r.json.spent_today_via_connector === 1234 && r.json.recent[0].url === 'https://cdn.example/v.mp4');
r = await tool(env(), 'glbgpt_usage', { recent: 0 });
check('usage without limit says none, recent skipped', r.json.daily_limit === 'none' && r.json.recent === undefined);
const h = await (await worker.fetch(new Request(base + '/health'), env({ DAILY_CREDIT_LIMIT: '20000' }))).json();
const hs = JSON.stringify(h);
check('health: settings without values', h.CONNECTOR_SECRET.set && h.GLBGPT_API_KEY.looks_right && h.DAILY_CREDIT_LIMIT === 20000 && h.CREDITS_kv_bound && !hs.includes(SECRET) && !hs.includes(KEY));
reset();
r = await tool(env({ GLBGPT_API_KEY: ` Bearer ${KEY}\n` }), 'glbgpt_list_models', {});
check('key pasted with "Bearer " and newline still works', !r.err);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
