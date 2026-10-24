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
const defaults = { price: 200, reserved: undefined, polls: 0, pollsUntilDone: 0, fail: null, submitStatus: 200, submitNetErrors: 0, keyBad: false, chatJsonReject: false, estimateStatus: 200, webPay: false, webFail: false, webPolls: 0, webPollsUntilDone: 0, webMediaType: 0, webMjButtons: false };
const res = (status, d, headers = {}) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const err = (status, code, message = code) => res(status, { error: { message, type: code, code } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
  calls.push({ method: init.method, path: u.pathname.replace('/ai-api/open/v1', ''), search: u.search, headers: init.headers, body });
  if (url === 'https://api2.glbgpt.com/ai-api/ai/agent/chatStream' || url === 'https://api2.glbgpt.com/dify-api/ai/agent/chatStream') {
    if (init.headers?.Authorization !== `Bearer ${TOKEN}`) return res(200, { code: 401, message: 'token invalid' });
    if (state.webPay) return res(200, { code: 402, message: 'pay', data: { subCode: 4010 } });
    const sse = ['data:{"event":"message","answer":"O"}\n\n', 'data:{"event":"message","answer":body.json ? "{\\"a\\":" : "K"}\n\n'.replace('body.json ? "{\\"a\\":" : "K"', body.query.includes('JSON Schema') ? '"{\\"a\\":1}"' : '"K"'), 'data:{"event":"message_end","metadata":{"usage":{"prompt_tokens":7000,"completion_tokens":2}}}\n\n'];
    if (body.query.includes('JSON Schema')) sse[0] = 'data:{"event":"message","answer":""}\n\n';
    return new Response(new ReadableStream({ start(c) { for (const l of sse) c.enqueue(new TextEncoder().encode(l)); c.close(); } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }
  if ((url.startsWith('https://api2.glbgpt.com/ai-api/') || url.startsWith('https://api2.glbgpt.com/user-api/')) && !url.startsWith(API) && !url.endsWith('/agent/chatStream')) {
    if (init.headers?.Authorization !== `Bearer ${TOKEN}`) return res(200, { code: 401, message: 'token invalid' });
    const wp = u.pathname;
    if (wp === '/ai-api/ai/task/get') { state.webPolls = (state.webPolls || 0) + 1; return res(200, state.webFail ? { code: 1, task: { status: 'failed', failedReason: 'nsfw', errorCode: 'X' } } : state.webPolls > (state.webPollsUntilDone || 0) ? { code: 1, task: { status: 'success', outputFileUrl: 'https://cdn.example/web.png', mediaType: state.webMediaType || 1, conversationId: 'c1', input: JSON.stringify({ prompt: 'a cat' }), output: state.webMjButtons ? JSON.stringify({ action: 'IMAGINE', buttons: [{ customId: 'MJ::U1', label: 'U1' }, { customId: 'MJ::U2', label: 'U2' }, { customId: 'MJ::reroll', label: '', emoji: '🔄' }] }) : undefined } } : { code: 1, task: { status: 'processing' } }); }
    if (wp === '/ai-api/ai/agent/uploadFile') return res(200, { code: 1, files: [{ fileKey: 'pdf-key', url: 'https://static.futureshareai.com/f/doc.pdf' }] });
    if (wp === '/ai-api/ai/storage/upload' || wp === '/ai-api/ai/detector/frame/upload') { state.uploads = (state.uploads || 0) + 1; return res(200, { code: 1, files: [{ fileKey: wp.includes('frame') ? 'frame-key' : 'file-key' }] }); }
    if (wp === '/user-api/api/user/bill/list') return res(200, { code: 1, data: { list: [{ direction: 'decrease', model: 'ai-video-detector', display_name: 'AI Video Detector', cost: 0, original_cost: 20, source_type: 'chat_usage', created_at: '2026-10-21' }, { direction: 'increase', cost: 130, source_type: 'daily_checkin', category_name: 'Daily Check-in Reward', created_at: '2026-10-21' }] } });
    if (wp === '/ai-api/ai/assets/list') return res(200, { code: 1, data: { next_cursor: null, items: body.source_type === 'UPLOADS' ? [{ asset_id: 'up1', url: 'https://static.futureshareai.com/u/file-key.png', source_type: 'UPLOAD_FILE', media_type: 1 }] : [{ asset_id: 'a76', url: 'https://cdn.example/mine.png', source_type: 'CREATED', media_type: 1 }, { asset_id: 'a90', url: 'https://static.futureshareai.com/v/clip.mp4', source_type: 'CREATED', media_type: 2 }] } });
    if (wp === '/ai-api/ai/detector/analyze') return res(200, { code: 1, aiGenerated: { availability: 'available', score: 0.91 }, deepfake: { availability: 'available', score: 0.04 }, summary: 'Likely AI-generated' });
    if (wp === '/ai-api/ai/media/list/myCreation') return res(200, { code: 1, records: [{ id: '76', agentId: '6249', status: 'success', mediaType: 1, outputFileUrl: 'https://cdn.example/mine.png' }, { id: '77', agentId: '6233', status: 'success', mediaType: 4, outputFileUrl: 'https://cdn.example/m.glb', createAt: '2026-10-21 10:00:00' }, { id: '78', agentId: '6224', status: 'failed', mediaType: 2, failedReasonShort: 'busy' }] });
    if (wp === '/ai-api/ai/heygen/quotes/video') return res(200, { data: { currency: 'usd', estimated_amount: 0.25 } });
    if (wp === '/ai-api/ai/heygen/videos') return res(200, { operation: { id: 'op1', status: 'pending', kind: 'create_video', billing_status: 'reserved' } });
    if (wp.startsWith('/ai-api/ai/heygen/operations/')) return res(200, { operation: { id: 'op1', status: 'succeeded' }, data: { video_url: 'https://cdn.example/heygen.mp4' } });
    if (wp === '/ai-api/ai/heygen/voices') return res(200, { data: [{ voice_id: 'v1', name: 'Anna', language: 'de', type: 'public' }, { voice_id: 'v2', type: 'private' }] });
    if (state.webPay) return res(200, { code: 402, message: 'pay', data: { subCode: 4002 } });
    return res(200, { code: 1, taskId: 'w1' });
  }
  if (url.endsWith('.pdf') && url.startsWith('https://cdn.example/')) return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Length': '4' } });
  if (url.startsWith('https://cdn.example/') || url.startsWith('https://static.futureshareai.com/')) return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'Content-Type': 'image/png', 'Content-Length': '4' } });
  if (!url.startsWith(API)) return err(404, 'wrong_host');
  if (state.keyBad || init.headers?.Authorization !== `Bearer ${KEY}`) return err(401, 'invalid_api_key');
  const p = u.pathname.replace('/ai-api/open/v1', '');
  if (p === '/models' && init.method === 'GET') return res(200, { object: 'list', data: [{ id: 'nano-banana-2.1', type: u.searchParams.get('type') || 'image', price: { '1K': 200 } }, { id: 'kling-v3', type: 'video' }] });
  if (p.startsWith('/models/')) return /\/(nope|claude-opus-5\.5|heygen-video)$/.test(p) ? err(404, 'model_not_found', 'Unknown model') : res(200, { id: decodeURIComponent(p.slice(8)), parameters: { resolution: ['1K', '2K'] } });
  if (p === '/tasks/estimate' && ['hidream-o1', 'kling-o1', 'heygen-video', 'video-upscale', 'tripo-h3.1', 'wan-2.6', 'ideogram-4.5', 'scribe-v2', 'made-up-media', 'ai-poster', 'ai-product-images', 'midjourney', 'ideogram-3.0', 'video-translate', 'talking-photo', 'meshy-7', 'wan-2.7', 'seedance-1.0-pro', 'ai-image-detector', 'ai-video-detector', 'wan3.0-video-prime', 'logo-maker', 'ai-translate'].includes(body.model)) return err(404, 'model_not_found', `Unknown model ${body.model}`);
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
  if (p === '/tasks' && init.method === 'GET') return res(200, { object: 'list', data: [{ id: 't-0', model: 'kling-v3', type: 'video', status: 'succeeded', credits_reserved: 500, output: { url: 'https://cdn.example/v.mp4' } }, { id: 't-f', model: 'agnes-video-v2.0', type: 'video', status: 'failed', credits_reserved: 45 }] });
  if (p.startsWith('/tasks/')) {
    state.polls++;
    if (p === '/tasks/unknown') return err(404, 'not_found', 'task not found');
    if (state.fail) return res(200, { id: p.slice(7), status: 'failed', error: { code: state.fail, message: 'provider said no', retryable: false } });
    if (state.polls > state.pollsUntilDone) return res(200, { id: p.slice(7), model: 'nano-banana-2.1', type: 'image', status: 'succeeded', credits_reserved: state.reserved ?? state.price, output: { url: 'https://cdn.example/out.png', type: 'image' } });
    return res(200, { id: p.slice(7), status: 'processing' });
  }
  if (p === '/chat/completions') {
    if (['claude-opus-5.5', 'perplexity', 'sonar', 'made-up-model', 'deep-research', 'chatpdf'].includes(body.model)) return err(404, 'model_not_found', `The model '${body.model}' does not exist or you do not have access to it.`);
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
const web = calls.find((c) => c.path === '/dify-api/ai/agent/chatStream');
check('API refuses -> website chat answers', !r.err && r.json.answer === 'OK' && r.json.via === 'website' && r.json.model === 'claude-opus-5.5');
check('website call: agent 6242, token, system folded into the query', web.body.agentId === '6242' && web.headers.Authorization === `Bearer ${TOKEN}` && web.body.query === 'be brief\n\nhi' && web.body.enableSearch === false);
check('website chat matches the chat page: /dify-api, no productNo, no thinking_patch', !('productNo' in web.body) && !('thinking_patch' in web.body.inputs));
check('website usage reported', r.json.usage.prompt_tokens === 7000);
reset();
r = await tool(envT(), 'glbgpt_chat', { prompt: 'search', model: 'sonar' });
check('alias sonar -> perplexity (agent 4372)', !r.err && calls.find((c) => c.path === '/dify-api/ai/agent/chatStream').body.agentId === '4372');
reset();
r = await tool(envT(), 'glbgpt_chat', { prompt: 'json', model: 'claude-opus-5.5', response_schema: { type: 'object' } });
check('website chat with schema -> parsed JSON', !r.err && r.json.a === 1);
reset();
r = await tool(envT(), 'glbgpt_chat', { prompt: 'hi', model: 'gpt-5.6-luna' });
check('API models never go to the website', !r.err && !calls.some((c) => c.path.endsWith('/ai/agent/chatStream')));
reset();
r = await tool(env(), 'glbgpt_chat', { prompt: 'hi', model: 'claude-opus-5.5' });
check('website model without token -> asks for GLBGPT_TOKEN', r.err && r.text.includes('GLBGPT_TOKEN'));
r = await tool(envT(), 'glbgpt_chat', { prompt: 'hi', model: 'made-up-model' });
check('unknown everywhere -> the API error, no website call', r.err && r.text.includes('does not exist') && !calls.some((c) => c.path.endsWith('/ai/agent/chatStream')));
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
check('website video: still running -> web task id, table price (kling o1 720p 10 s = 2000)', !r.err && r.json.status === 'processing' && r.json.task_id === 'web:w1' && !r.json.price_note && r.json.credits_estimated === 2000);
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
reset({ webMediaType: 4 });
r = await tool(envT(), 'glbgpt_generate', { model: 'tripo-h3.1', prompt: 'a chair', metadata: { quad: true } });
const td = calls.find((c) => c.path === '/ai-api/ai/3d/task/submit').body;
check('3D: prompt + options, website price (textured 660 + quad 170 = 830)', !r.err && td.model === 'tripo-h3.1' && td.prompt === 'a chair' && td.quad === true && r.json.credits_estimated === 830);
check('3D result labelled 3d', !r.err && r.json.type === '3d');
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'tripo-h3.1', prompt: 'a chair', metadata: { texture: false } });
check('tripo without texture -> 330', !r.err && r.json.credits_estimated === 330);
r = await tool(envT(), 'glbgpt_generate', { model: 'meshy-7', prompt: 'a chair' });
check('meshy default (full) -> 2640', !r.err && r.json.credits_estimated === 2640);
r = await tool(envT(), 'glbgpt_generate', { model: 'meshy-7', prompt: 'a chair', metadata: { shouldTexture: false, enableRigging: true } });
check('meshy preview + rigging -> 2200', !r.err && r.json.credits_estimated === 2200);

// website options: pass-through, enhance, per-model fixes
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'hidream-o1', prompt: 'x', metadata: { someNewField: 7, agentId: '9999', enhance_prompt: true } });
const pt = calls.find((c) => c.path === '/ai-api/ai/hidream/task/submit').body;
check('metadata passes through, routing keys protected, enhance toggle', !r.err && pt.someNewField === 7 && pt.agentId === '6249' && pt.enhancePrompt === true && !('enhance_prompt' in pt));
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'hidream-o1', prompt: 'x' });
check('enhance off by default', calls.find((c) => c.path === '/ai-api/ai/hidream/task/submit').body.enhancePrompt === false);
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'ai-poster', prompt: 'apples', metadata: { textBlocks: ['Apple Market', { text: 'Sat 10am', position: 'middle' }], usageContext: 'store-business' } });
const po = calls.find((c) => c.path === '/ai-api/ai/tools/poster/generate').body;
check('ai poster: strings become {text, position}', !r.err && JSON.stringify(po.textBlocks) === JSON.stringify([{ text: 'Apple Market', position: 'top' }, { text: 'Sat 10am', position: 'middle' }]) && po.usageContext === 'store-business');
r = await tool(envT(), 'glbgpt_generate', { model: 'ai-poster', prompt: 'x', metadata: { textBlocks: [{ text: 'a', position: 'side' }] } });
check('ai poster: bad position refused before submitting', r.err && r.text.includes('top, middle, bottom'));
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'ai-product-images', prompt: 'x', images: ['https://x.example/p.png'], metadata: { text: 'NEW' } });
const pi = calls.find((c) => c.path === '/ai-api/ai/tools/product-images/generate').body;
check('product images: text gets a default position', !r.err && pi.text === 'NEW' && pi.textPosition === 'bottom');
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'kling-o1', prompt: 'x', duration: 3 });
check('kling o1: 3 s refused before submitting', r.err && r.text.includes('5, 10') && !calls.some((c) => c.path === '/ai-api/ai/klingO1/task/submit'));
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'kling-o1', prompt: 'restyle @Video1', video_url: 'https://x.example/v.mp4', duration: 4 });
const ke = calls.find((c) => c.path === '/ai-api/ai/klingO1/task/submit').body;
check('kling o1 video edit: duration = video length, @Video tag removed', !r.err && ke.duration === 4 && ke.prompt === 'restyle' && ke.videoList.includes('v.mp4'));
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'wan-2.6', prompt: 'x', aspect_ratio: '9:16', resolution: '1080P' });
check('wan 2.6: ratio becomes a size (1080*1920)', !r.err && calls.find((c) => c.path.startsWith('/ai-api/ai/ali-wan26/')).body.size === '1080*1920');
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'wan-2.6', prompt: 'x' });
check('wan 2.6: default size 1280*720', !r.err && calls.find((c) => c.path.startsWith('/ai-api/ai/ali-wan26/')).body.size === '1280*720');
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'wan-2.7', prompt: 'x', duration: 3, images: ['https://x.example/a.png'], video_url: 'https://x.example/v.mp4' });
const w27 = calls.find((c) => c.path === '/ai-api/ai/ali-wan/27/task/submit').body;
check('wan 2.7: video_url -> references instead of keyframes', !r.err && w27.references.length === 2 && w27.references[1].type === 'reference_video' && !w27.keyframes);
r = await tool(envT(), 'glbgpt_generate', { model: 'seedance-1.0-pro', prompt: 'x', duration: 3 });
check('seedance: only 5 or 10 s', r.err && r.text.includes('5, 10'));
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'midjourney', prompt: 'a cat --v 7.0 --ar 16:9 --stylize 200', images: ['https://x.example/a.png'] });
const mj = calls.find((c) => c.path === '/ai-api/ai/zeakai/mj/submit/imagine').body;
check('midjourney: --v/--ar moved into fields, images as image prompts', !r.err && mj.image_request.version === '7.0' && mj.image_request.aspect === '16:9' && mj.image_request.prompt === 'a cat --stylize 200' && mj.fileList[0] === 'https://x.example/a.png' && mj.image_request.base64Array.length === 1);
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'midjourney', prompt: 'a cat' });
const mj2 = calls.find((c) => c.path === '/ai-api/ai/zeakai/mj/submit/imagine').body;
check('midjourney default: V8.2 with --hd, 1:1', !r.err && mj2.image_request.version === '8.2' && mj2.image_request.prompt === 'a cat --hd' && mj2.image_request.aspect === '1:1');
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'ideogram-3.0', prompt: 'x', metadata: { style_preset: 'WATERCOLOR' } });
const i3 = calls.find((c) => c.path === '/ai-api/ai/ideogram3/task/submit').body.image_request;
check('ideogram 3.0: style preset with style_type AUTO', !r.err && i3.style_preset === 'WATERCOLOR' && i3.style_type === 'AUTO');
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'video-translate', video_url: 'https://x.example/v.mp4', duration: 4, metadata: { outputLanguage: 'German' } });
const vt = calls.find((c) => c.path === '/ai-api/ai/video-tools/task/submit').body;
check('video translate: language, no prompt, no voice fields', !r.err && vt.outputLanguage === 'German' && !('prompt' in vt) && !('voicePrompt' in vt) && !('resolution' in vt));
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'talking-photo', prompt: 'Hello there', images: ['https://x.example/f.png'], metadata: { voice: 'Puck (Male)' } });
const tp = calls.find((c) => c.path === '/ai-api/ai/video-tools/task/submit').body;
check('talking photo: script, voice, default voice prompt, resolution', !r.err && tp.prompt === 'Hello there' && tp.voice === 'Puck (Male)' && tp.voicePrompt === 'Say the following.' && tp.resolution === '720p');
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


// usage: website generations and released credits
reset();
r = await tool(envT(), 'glbgpt_usage', { recent: 5 });
check('usage lists website generations', !r.err && Array.isArray(r.json.recent_website) && r.json.recent_website.find((x) => x.task_id === 'web:77').model === 'tripo-h3.1' && r.json.recent_website.find((x) => x.task_id === 'web:77').type === '3d' && r.json.recent_website.find((x) => x.task_id === 'web:78').reason === 'busy' && /^2026-/.test(r.json.recent_website[0].created ?? '2026-'));
r = await tool(env(), 'glbgpt_usage', { recent: 5 });
check('usage without token: no website list', !r.err && r.json.recent_website === undefined);
check('failed task in usage: 0 credits, reservation shown as released', r.json.recent.find((t) => t.task_id === 't-f').credits === 0 && r.json.recent.find((t) => t.task_id === 't-f').credits_released === 45);

// detectors
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'ai-image-detector', images: ['https://cdn.example/other.png'] });
const an = calls.find((c) => c.path === '/ai-api/ai/detector/analyze').body;
check('image detector: uploaded, found in library, scores back directly', !r.err && r.json.status === 'succeeded' && r.json.ai_generated === 0.91 && r.json.deepfake === 0.04 && r.json.summary === 'Likely AI-generated' && an.mediaId === 'up1' && an.mediaSource === 'uploaded' && an.mediaType === 'IMAGE' && an.agentId === '6200' && calls.some((c) => c.path === '/ai-api/ai/storage/upload'));
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'ai-image-detector', images: ['https://cdn.example/mine.png'] });
const an2 = calls.find((c) => c.path === '/ai-api/ai/detector/analyze').body;
check('image detector: library item analysed by asset id, no upload', !r.err && an2.mediaId === 'a76' && an2.mediaSource === 'generated' && !calls.some((c) => c.path === '/ai-api/ai/storage/upload'));
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'ai-image-detector', images: ['data:image/png;base64,iVBORw0KGgo='] });
check('image detector: data: URI uploaded', !r.err && r.json.ai_generated === 0.91 && calls.some((c) => c.path === '/ai-api/ai/storage/upload'));
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'ai-video-detector', video_url: 'https://static.futureshareai.com/v/clip.mp4', duration: 5, metadata: { frame_ms: 1500 } });
const av = calls.find((c) => c.path === '/ai-api/ai/detector/analyze').body;
check('video detector: library video, frame cut on the CDN and uploaded', !r.err && av.mediaType === 'VIDEO' && av.mediaId === 'a90' && av.frameFileKey === 'frame-key' && av.frameTimestampMs === 1500 && av.durationSeconds === 5 && calls.some((c) => c.path.startsWith('/cdn-cgi/media/mode=frame,time=1.5s')));
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'ai-video-detector', video_url: 'https://cdn.example/v.mp4', duration: 5, images: ['https://cdn.example/f.png'] });
check('video detector: other host uploaded, frame from images[0]', !r.err && calls.some((c) => c.path === '/ai-api/ai/storage/upload') && calls.find((c) => c.path === '/ai-api/ai/detector/analyze').body.frameFileKey === 'frame-key');
r = await tool(envT(), 'glbgpt_generate', { model: 'ai-video-detector', video_url: 'https://static.futureshareai.com/v/clip.mp4', duration: 90 });
check('video detector over 60 s refused', r.err && r.text.includes('60 seconds'));
r = await tool(envT(), 'glbgpt_list_models', { type: 'detector' });
check('list models type detector -> the two detectors', !r.err && r.json.models.length === 2 && r.json.models.every((m) => m.type === 'detector' && m.usage && m.price));

// website price tables, credit records
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'wan-2.6', prompt: 'x' });
check('wan 2.6 720P 5 s = 900 (as charged)', !r.err && r.json.credits_estimated === 900);
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'wan3.0-video-prime', prompt: 'x', duration: 2, resolution: '480P' });
check('wan 3.0 prime 480P 2 s = 300 (as charged)', !r.err && r.json.credits_estimated === 300);
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'kling-o1', prompt: 'x', video_url: 'https://x.example/v.mp4', duration: 4 });
check('kling o1 video edit 720p 4 s = 1200', !r.err && r.json.credits_estimated === 1200);
r = await tool(envT(), 'glbgpt_usage', { recent: 3 });
const cr = r.json.credit_records;
check('usage: credit records with list price and income', !r.err && cr[0].what === 'AI Video Detector' && cr[0].credits === 0 && cr[0].list_price === 20 && cr[1].credits === 130);

reset();
r = await tool(envT({ DAILY_CREDIT_LIMIT: '5000' }), 'glbgpt_generate', { model: 'ai-image-detector', images: ['https://cdn.example/mine.png'] });
check('detector run counted against the daily limit (20)', !r.err && kvStore.get(spentKey) === '20');
reset();
r = await tool(envT({ DAILY_CREDIT_LIMIT: '10' }), 'glbgpt_generate', { model: 'ai-image-detector', images: ['https://cdn.example/mine.png'] });
check('detector refused when over the daily limit', r.err && r.text.includes('Daily limit') && !calls.some((c) => c.path === '/ai-api/ai/detector/analyze'));

// logo maker, midjourney buttons
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'logo-maker', aspect_ratio: '1:1', metadata: { brandName: 'Apple Market', style: 'minimalist', industry: 'food' } });
const lm = calls.find((c) => c.path === '/ai-api/ai/logo-maker/generate').body;
check('logo maker: brand, style, industry, size, agent 6128, 100 credits', !r.err && lm.brandName === 'Apple Market' && lm.style === 'minimalist' && lm.industry === 'food' && lm.size === '1:1' && lm.agentId === '6128' && r.json.credits_estimated === 100);
r = await tool(envT(), 'glbgpt_generate', { model: 'logo-maker' });
check('logo maker without brand or prompt -> asks', r.err && r.text.includes('brandName'));
r = await tool(envT(), 'glbgpt_generate', { model: 'logo-maker', metadata: { brandName: 'X', style: 'neon' } });
check('logo maker bad style refused', r.err && r.text.includes('minimalist'));
reset({ webMjButtons: true });
r = await tool(envT(), 'glbgpt_generate', { model: 'midjourney', prompt: 'a cat' });
check('midjourney result lists its buttons', !r.err && JSON.stringify(r.json.actions) === JSON.stringify(['U1', 'U2', 'reroll']) && r.json.actions_note);
reset({ webMjButtons: true });
r = await tool(envT(), 'glbgpt_generate', { model: 'midjourney', metadata: { action: 'u2', task_id: 'web:w9' } });
const ma = calls.find((c) => c.path === '/ai-api/ai/zeakai/mj/submit/action');
check('midjourney action: U2 of the given task, no prompt needed', !r.err && ma && ma.body.image_request.customId === 'MJ::U2' && ma.body.image_request.taskId === 'w9' && ma.body.image_request.model === 'mj-zeakai-action' && ma.body.conversationId === 'c1' && ma.body.name === 'U2' && !('action' in ma.body.image_request));
r = await tool(envT(), 'glbgpt_generate', { model: 'midjourney', metadata: { action: 'V9', task_id: 'web:w9' } });
check('midjourney unknown button -> lists the buttons', r.err && r.text.includes('U1, U2, reroll'));

// workflow agents: deep research (chat), ai translate (text)
reset();
r = await tool(envT(), 'glbgpt_chat', { model: 'deep-research', prompt: 'hi' });
const dr = calls.find((c) => c.path === '/dify-api/ai/agent/chatStream');
check('deep research: website agent 4341 through /dify-api', !r.err && r.json.answer === 'OK' && dr && dr.body.agentId === '4341' && !('thinking_patch' in dr.body.inputs));
reset();
r = await tool(envT(), 'glbgpt_generate', { model: 'ai-translate', prompt: 'Hallo Welt', metadata: { target_language: 'English' } });
const tr = calls.find((c) => c.path === '/dify-api/ai/agent/chatStream');
check('ai translate: /dify-api, agent 6174, translate inputs, text back', !r.err && r.json.text === 'OK' && r.json.type === 'text' && tr.body.agentId === '6174' && tr.body.inputs.translate_type === 'text' && tr.body.inputs.target_language === 'English' && tr.body.query === 'Hallo Welt');
r = await tool(envT(), 'glbgpt_list_models', { type: 'chat' });
check('deep research listed with the website chat models', !r.err && r.json.models.some((m) => m.id === 'deep-research' && m.source === 'website'));

// chatpdf: document upload, then the agent
reset();
r = await tool(envT(), 'glbgpt_chat', { model: 'chatpdf', prompt: 'Summarise it', files: ['https://cdn.example/doc.pdf'] });
const up = calls.find((c) => c.path === '/ai-api/ai/agent/uploadFile');
const cp = calls.find((c) => c.path === '/ai-api/ai/agent/chatStream');
check('chatpdf: PDF uploaded for agent 6081, sent as a local_file', !r.err && r.json.answer === 'OK' && up && cp.body.agentId === '6081' && cp.body.files[0].uploadFileId === 'pdf-key' && cp.body.files[0].transferMethod === 'local_file' && cp.body.files[0].type === 'file' && cp.body.productNo === 'glbgpt' && !calls.some((c) => c.path === '/chat/completions'));
r = await tool(envT(), 'glbgpt_chat', { model: 'chatpdf', prompt: 'Summarise it' });
check('chatpdf without a file -> asks for it', r.err && r.text.includes('files'));
r = await tool(envT(), 'glbgpt_chat', { model: 'chatpdf', prompt: 'x', files: ['https://cdn.example/pic.png'] });
check('chatpdf refuses a non-PDF', r.err && r.text.includes('PDF'));
r = await tool(envT(), 'glbgpt_chat', { model: 'made-up-model', prompt: 'x', files: ['https://cdn.example/doc.pdf'] });
check('files with an API model -> explains', r.err && r.text.includes('website-only'));

reset();
r = await tool(envT(), 'glbgpt_chat', { model: 'chatpdf', prompt: 'Summarise it', images: ['https://cdn.example/doc.pdf'] });
check('chatpdf also takes the PDF in images (older tool lists)', !r.err && r.json.answer === 'OK' && calls.some((c) => c.path === '/ai-api/ai/agent/uploadFile'));

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
