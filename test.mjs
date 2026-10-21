// Local test: runs the Worker in Node with a fake GlobalGPT API. No real calls, no credits spent.
import worker from './worker.js';
const SECRET = 'x'.repeat(40);
const TOKEN = 'aaa.bbb.ccc';
const base = 'https://glb.example.workers.dev';

// Fake clock: sleeps return at once and move time forward, so the 40s waits take no real time.
let now = Date.UTC(2026, 9, 21, 10, 0, 0);
Date.now = () => now;
globalThis.setTimeout = (fn, ms) => { now += ms || 0; Promise.resolve().then(fn); return 0; };

// Fake KV
const kvStore = new Map();
const KV = { get: async (k) => kvStore.get(k) ?? null, put: async (k, v) => { kvStore.set(k, v); } };

// Fake GlobalGPT API
const calls = [];
const state = { price: 500, taskPolls: 0, pollsUntilDone: 0, submitCode: null, chatMode: 'ok', tokenBad: false, taskFail: false };
const ok = (d, headers = { 'Content-Type': 'application/json' }) => new Response(typeof d === 'string' ? d : JSON.stringify(d), { status: 200, headers });
const sse = (lines) => new Response(new ReadableStream({ start(c) { for (const l of lines) c.enqueue(new TextEncoder().encode(l)); c.close(); } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  let body = init.body;
  if (typeof body === 'string') body = JSON.parse(body);
  calls.push({ method: init.method, path: u.pathname, auth: init.headers?.Authorization, body });
  if (u.host !== 'api2.glbgpt.com') return ok({ message: 'wrong host' });
  if (state.tokenBad) return ok({ code: 401, message: 'token invalid' });
  const p = u.pathname;
  if (p === '/user-api/api/user/info') return ok({ code: 1, data: { email: 'me@example.com', amount: '150000', balance: '0', currentSubscription: { plan_package: 'lifetime_unlimited', end_date: '2026-11-01 00:00:00' }, subscription: { end_date: '2099-01-01 00:00:00' } } });
  if (p === '/ai-api/cli/v1/models') return ok({ chat: { default: 'gpt-5.6-sol', models: [{ id: 'gpt-5.6-sol', label: 'balanced reasoning' }, { id: 'deepseek-v4-pro' }] }, media: { disabled: ['ideogram-3.0'] } });
  if (p === '/ai-api/ai/bill/estimatePrice') {
    if (state.estimateUnknown && body.model === state.estimateUnknown) return ok({ sellable: false, credits: 0, reasonCode: state.estimateReason ?? null });
    return ok({ sellable: true, credits: state.price });
  }
  if (p === '/ai-api/ai/storage/upload') return ok({ files: [{ url: 'https://cdn.example/ref.png' }] });
  if (p === '/ai-api/ai/task/get') {
    state.taskPolls++;
    if (state.taskFail) return ok({ task: { status: 'failed', errorCode: 'ANYWHERE_CONTENT_REJECTED', failedReasonShort: 'nsfw' } });
    if (state.taskPolls > state.pollsUntilDone) return ok({ task: { status: 'success', outputFileUrl: 'https://cdn.example/out.png', mediaType: 1, mediaW: 2048, mediaH: 2048 } });
    return ok({ task: { status: 'processing' } });
  }
  if (p === '/ai-api/cli/v1/chat/completions') {
    if (state.chatMode === 'nocredits') return ok({ code: 402, message: 'pay', data: { subCode: 4003 } });
    if (state.chatMode === 'json') return sse(['data: {"choices":[{"delta":{"content":"```json\\n{\\"a\\":"}}]}\n', 'data: {"choices":[{"delta":{"content":"1}\\n```"}}]}\n', 'data: [DONE]\n']);
    return sse(['data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]']);
  }
  if (p.endsWith('/task/submit') || p === '/ai-api/ai/apimart/image/generate') {
    if (state.submitCode) return ok({ code: state.submitCode, message: 'pay', data: { subCode: 4002 } });
    return ok({ taskId: 't-123' });
  }
  return ok({ message: 'unmocked ' + p });
};

const env = (extra = {}) => ({ GLBGPT_TOKEN: TOKEN, CONNECTOR_SECRET: SECRET, CREDITS: KV, ...extra });
async function rpc(e, method, params, path = `/mcp/${SECRET}`) {
  const r = await worker.fetch(new Request(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }), e);
  const t = await r.text(); let b = null; try { b = t ? JSON.parse(t) : null; } catch { b = t; } return { status: r.status, body: b };
}
const tool = async (e, name, args = {}) => { const r = await rpc(e, 'tools/call', { name, arguments: args }); const res = r.body.result; return { err: res.isError, text: res.content[0].text, json: (() => { try { return JSON.parse(res.content[0].text); } catch { return null; } })() }; };
const reset = (o = {}) => { Object.assign(state, { price: 500, taskPolls: 0, pollsUntilDone: 0, submitCode: null, chatMode: 'ok', tokenBad: false, taskFail: false, estimateUnknown: null, estimateReason: null }, o); calls.length = 0; kvStore.clear(); };
let failures = 0;
const check = (label, cond) => { if (!cond) failures++; console.log((cond ? 'PASS ' : 'FAIL ') + label); };
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
const spentKey = `spent:${day}`;

// auth / routing (same rules as discord-mcp)
check('wrong secret -> 404', (await rpc(env(), 'initialize', {}, '/mcp/wrong')).status === 404);
check('root -> 404', (await worker.fetch(new Request(base + '/'), env())).status === 404);
check('GET on mcp -> 405', (await worker.fetch(new Request(base + `/mcp/${SECRET}`), env())).status === 405);
const init = await rpc(env(), 'initialize', { protocolVersion: '2025-06-18' });
check('initialize echoes version + instructions', init.body.result.protocolVersion === '2025-06-18' && init.body.result.instructions.includes('credits'));
const note = await worker.fetch(new Request(base + `/mcp/${SECRET}`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }), env());
check('notification -> 202', note.status === 202);
const names = (await rpc(env(), 'tools/list')).body.result.tools.map((t) => t.name);
check('tools/list has the 6 tools', names.join() === 'glbgpt_chat,glbgpt_generate_image,glbgpt_generate_video,glbgpt_check_task,glbgpt_list_models,glbgpt_account');
const hdr = (h, e = env(), path = '/mcp') => worker.fetch(new Request(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }), e);
check('Bearer header works', (await hdr({ Authorization: 'Bearer ' + SECRET })).status === 200);
check('X-API-Key header works', (await hdr({ 'X-API-Key': SECRET })).status === 200);
check('wrong header -> 404', (await hdr({ Authorization: 'Bearer wrong' })).status === 404);
check('DISABLE_URL_SECRET blocks secret in path', (await rpc(env({ DISABLE_URL_SECRET: 'true' }), 'tools/list')).status === 404);
check('short secret refused', (await rpc(env({ CONNECTOR_SECRET: 'short' }), 'ping', {}, '/mcp/short')).status === 404);
check('unknown tool -> error', (await rpc(env(), 'tools/call', { name: 'toString' })).body.error?.code === -32602);

// chat
reset();
let r = await tool(env(), 'glbgpt_chat', { prompt: 'hi' });
const chatCall = calls.find((c) => c.path.endsWith('/chat/completions'));
check('chat streams the answer', !r.err && r.json.answer === 'Hello' && r.json.model === 'gpt-5.6-sol');
check('chat sends token + stream + messages', chatCall.auth === `Bearer ${TOKEN}` && chatCall.body.stream === true && chatCall.body.messages.at(-1).content === 'hi');
reset({ chatMode: 'json' });
r = await tool(env(), 'glbgpt_chat', { prompt: 'give json', system: 'be brief', response_schema: { type: 'object', properties: { a: { type: 'number' } } } });
const jc = calls.find((c) => c.path.endsWith('/chat/completions')).body;
check('chat with schema returns parsed JSON (fences stripped)', !r.err && r.json.a === 1);
check('chat with schema uses json_object + schema in system', jc.response_format.type === 'json_object' && jc.messages[0].content.includes('be brief') && jc.messages[0].content.includes('"a"'));
reset();
r = await tool(env(), 'glbgpt_chat', { prompt: 'look', images: ['https://x.example/a.png'] });
const vc = calls.find((c) => c.path.endsWith('/chat/completions')).body;
check('chat with image sends image_url part', !r.err && vc.messages[0].content[1].image_url.url === 'https://x.example/a.png');
r = await tool(env(), 'glbgpt_chat', { prompt: 'look', images: ['/Users/me/a.png'] });
check('chat refuses local paths', r.err);
reset({ chatMode: 'nocredits' });
r = await tool(env(), 'glbgpt_chat', { prompt: 'hi' });
check('chat 402 -> credits message', r.err && r.text.includes('used up'));
reset({ tokenBad: true });
r = await tool(env(), 'glbgpt_chat', { prompt: 'hi' });
check('chat with bad token -> login hint', r.err && r.text.includes('glbgpt login'));
r = await tool(env({ GLBGPT_TOKEN: '' }), 'glbgpt_chat', { prompt: 'hi' });
check('missing token -> clear error', r.err && r.text.includes('GLBGPT_TOKEN is not set'));

// image generation, no limit set
reset();
r = await tool(env(), 'glbgpt_generate_image', { prompt: 'a sneaker', aspect_ratio: '1:1' });
const submit = calls.find((c) => c.path.endsWith('/task/submit'));
check('image: succeeds with url', !r.err && r.json.status === 'succeeded' && r.json.url === 'https://cdn.example/out.png' && r.json.model === 'nano-banana-2');
check('image: body matches CLI (nano banana)', submit.path === '/ai-api/ai/nano_banana_vertexai/task/submit' && submit.body.agentId === '6136' && submit.body.image_request.imageSize === '2K' && submit.body.image_request.model === 'nano_banana_2' && submit.body.device.osplatform === 'cli');
check('image: estimate before submit', calls.findIndex((c) => c.path.endsWith('estimatePrice')) < calls.findIndex((c) => c.path.endsWith('/task/submit')));
check('no limit set: spend still counted', kvStore.get(spentKey) === '500');
reset();
r = await tool(env(), 'glbgpt_generate_image', { prompt: 'x', aspect_ratio: '7:3' });
check('bad aspect ratio -> allowed list, nothing priced', r.err && r.text.includes('Allowed') && !calls.length);
r = await tool(env(), 'glbgpt_generate_image', { prompt: 'x', model: 'veo-3.1' });
check('video model for image -> error', r.err && r.text.includes('video model'));
r = await tool(env(), 'glbgpt_generate_image', { prompt: 'x', model: 'nano-banan' });
check('typo model -> suggestion', r.err && r.text.includes('Did you mean'));
r = await tool(env(), 'glbgpt_generate_image', { prompt: 'x', reference_images: ['C:\\pics\\a.png'] });
check('local reference path refused', r.err && r.text.includes('URLs'));
reset();
r = await tool(env(), 'glbgpt_generate_image', { prompt: 'x', model: 'gpt-image-2', reference_images: ['data:image/png;base64,iVBORw0KGgo='] });
const gpt = calls.find((c) => c.path === '/ai-api/ai/apimart/image/generate');
check('data: reference uploaded, then sent as URL', !r.err && calls.some((c) => c.path === '/ai-api/ai/storage/upload') && gpt.body.imageUrls[0] === 'https://cdn.example/ref.png');
reset();
r = await tool(env(), 'glbgpt_generate_image', { prompt: 'x', model: 'ideogram-3.0-turbo', seed: 7, negative_prompt: 'blur', resolution: '2K' });
check('resolution on a model without one -> error', r.err && r.text.includes('resolution'));
r = await tool(env(), 'glbgpt_generate_image', { prompt: 'x', model: 'ideogram-3.0-turbo', seed: 7, negative_prompt: 'blur' });
const ideo = calls.find((c) => c.path === '/ai-api/ai/ideogram3/task/submit');
check('ideogram passes seed + negative prompt', !r.err && ideo.body.image_request.seed === 7 && ideo.body.image_request.negative_prompt === 'blur');

// Nano Banana 2.1 (from the web app, not the CLI)
reset();
r = await tool(env(), 'glbgpt_generate_image', { prompt: 'pixel art', model: 'nano-banana-2.1' });
const nb21 = calls.find((c) => c.path === '/ai-api/ai/nano_banana_vertexai/task/submit').body;
check('2.1: body uses agent 6252, model nano_banana_2_1, 1K default', !r.err && nb21.agentId === '6252' && nb21.image_request.model === 'nano_banana_2_1' && nb21.image_request.imageSize === '1K' && nb21.image_request.aspectRatio === undefined);
check('2.1: uses the price check when it knows the model', r.json.credits_estimated === 500);
reset({ estimateUnknown: 'nano-banana-2.1' });
r = await tool(env({ DAILY_CREDIT_LIMIT: '20000' }), 'glbgpt_generate_image', { prompt: 'pixel art', model: 'nano-banana-2.1', resolution: '2K' });
check('2.1: price check unknown -> listed price (2K = 300), counted', !r.err && r.json.credits_estimated === 300 && kvStore.get(spentKey) === '300');
reset({ estimateUnknown: 'nano-banana-2.1', estimateReason: 'insufficient_funds' });
r = await tool(env(), 'glbgpt_generate_image', { prompt: 'pixel art', model: 'nano-banana-2.1' });
check('2.1: insufficient funds still refused, nothing submitted', r.err && r.text.includes('Insufficient') && !calls.some((c) => c.path.endsWith('/task/submit')));
reset({ estimateUnknown: 'nano-banana-2' });
r = await tool(env(), 'glbgpt_generate_image', { prompt: 'x', model: 'nano-banana-2' });
check('models without a listed price still need the price check', r.err && !calls.some((c) => c.path.endsWith('/task/submit')));

// daily limit
reset();
r = await tool(env({ DAILY_CREDIT_LIMIT: '1000' }), 'glbgpt_generate_image', { prompt: 'x' });
check('limit 1000: first 500 ok', !r.err && kvStore.get(spentKey) === '500');
r = await tool(env({ DAILY_CREDIT_LIMIT: '1000' }), 'glbgpt_generate_image', { prompt: 'x' });
check('limit 1000: second 500 ok', !r.err && kvStore.get(spentKey) === '1000');
calls.length = 0;
r = await tool(env({ DAILY_CREDIT_LIMIT: '1000' }), 'glbgpt_generate_image', { prompt: 'x' });
check('limit 1000: third refused, nothing submitted', r.err && r.text.includes('Daily limit reached') && !calls.some((c) => c.path.endsWith('/task/submit')));
r = await tool(env({ DAILY_CREDIT_LIMIT: '20,000' }), 'glbgpt_generate_image', { prompt: 'x' });
check('limit written as 20,000 is understood', !r.err);
reset();
r = await tool(env({ DAILY_CREDIT_LIMIT: '0' }), 'glbgpt_generate_image', { prompt: 'x' });
check('limit 0: blocked before pricing', r.err && r.text.includes('is 0') && !calls.length);
r = await tool(env({ DAILY_CREDIT_LIMIT: 'off' }), 'glbgpt_generate_image', { prompt: 'x' });
check('non-number limit: blocked, not silently unlimited', r.err && r.text.includes("isn't a number") && !calls.length);
r = await tool(env({ DAILY_CREDIT_LIMIT: '5000', CREDITS: undefined }), 'glbgpt_generate_image', { prompt: 'x' });
check('limit set but no KV: blocked with a hint', r.err && r.text.includes('KV'));
reset();
r = await tool(env({ CREDITS: undefined }), 'glbgpt_generate_image', { prompt: 'x' });
check('no limit and no KV: works', !r.err && r.json.status === 'succeeded');
reset({ submitCode: 402 });
r = await tool(env({ DAILY_CREDIT_LIMIT: '1000' }), 'glbgpt_generate_image', { prompt: 'x' });
check('submit refused (402) -> message + reservation rolled back', r.err && r.text.includes('Insufficient') && kvStore.get(spentKey) === '0');
check('chat does not count toward the limit', (reset(), await tool(env({ DAILY_CREDIT_LIMIT: '1' }), 'glbgpt_chat', { prompt: 'hi' })).err === false);

// video + check_task
reset({ pollsUntilDone: 20 });
r = await tool(env(), 'glbgpt_generate_video', { prompt: 'orbit', model: 'seedance-2.0', duration: 5, generate_audio: true, start_image: 'https://x.example/a.png', end_image: 'https://x.example/b.png' });
const sd = calls.find((c) => c.path === '/ai-api/ai/seedance2/task/submit').body;
check('video: still generating after the wait -> task_id', !r.err && r.json.status === 'generating' && r.json.task_id === 't-123');
check('video: seedance body (ratio, audio, frames)', sd.ratio === '16:9' && sd.generateAudio === true && sd.image === 'https://x.example/a.png' && sd.lastFrameImage === 'https://x.example/b.png' && sd.resolution === '480p');
check('video: waited ~40s, not forever', state.taskPolls >= 10 && state.taskPolls <= 15);
r = await tool(env(), 'glbgpt_check_task', { task_id: 't-123' });
check('check_task: finishes with url', !r.err && r.json.status === 'succeeded' && r.json.url);
r = await tool(env(), 'glbgpt_generate_video', { prompt: 'x', model: 'grok-imagine-video-1.5' });
check('image-to-video-only model without start_image -> error', r.err && r.text.includes('start_image'));
r = await tool(env(), 'glbgpt_generate_video', { prompt: 'x', model: 'veo-3.1', duration: 5 });
check('unsupported duration -> allowed list', r.err && r.text.includes('Allowed: 8'));
r = await tool(env(), 'glbgpt_generate_video', { prompt: 'x', model: 'veo-3.1', generate_audio: true });
check('audio on a model without audio -> error', r.err && r.text.includes('audio'));
r = await tool(env(), 'glbgpt_generate_video', { prompt: 'x', resolution: '1080p' });
check('grok video rejects 1080p', r.err && r.text.includes('720p'));
reset({ taskFail: true });
r = await tool(env(), 'glbgpt_check_task', { task_id: 't-9' });
check('failed task -> content safety message', r.err && r.text.includes('content safety'));

// list models + account + health
reset();
r = await tool(env(), 'glbgpt_list_models', {});
check('list models: chat from catalog, disabled media hidden', !r.err && r.json.chat[0].id === 'gpt-5.6-sol' && r.json.chat[0].default && !r.json.image.some((m) => m.id === 'ideogram-3.0') && r.json.video.length === 6);
r = await tool(env(), 'glbgpt_list_models', { type: 'video' });
check('list models: type filter', !r.err && !r.json.image && !r.json.chat && r.json.video.find((m) => m.id === 'seedance-2.0').end_image);
kvStore.set(spentKey, '1234');
r = await tool(env({ DAILY_CREDIT_LIMIT: '20000' }), 'glbgpt_account');
check('account: plan, credits, limit, today', !r.err && r.json.plan === 'Unlimited (lifetime)' && r.json.credits_total === 150000 && r.json.daily_limit === 20000 && r.json.spent_today_via_connector === 1234);
r = await tool(env(), 'glbgpt_account');
check('account without limit says none', r.json.daily_limit === 'none');
const h = await (await worker.fetch(new Request(base + '/health'), env({ DAILY_CREDIT_LIMIT: '20000' }))).json();
const hs = JSON.stringify(h);
check('health: settings without values', h.CONNECTOR_SECRET.set && h.CONNECTOR_SECRET.sha256_first8.length === 8 && h.GLBGPT_TOKEN.looks_like_jwt && h.DAILY_CREDIT_LIMIT === 20000 && h.CREDITS_kv_bound && !hs.includes(SECRET) && !hs.includes(TOKEN));
const h2 = await (await worker.fetch(new Request(base + '/health'), env())).json();
check('health: no limit set', h2.DAILY_CREDIT_LIMIT === 'not set: no limit');
reset();
r = await tool(env({ GLBGPT_TOKEN: ` Bearer ${TOKEN}\n` }), 'glbgpt_account');
check('token pasted with "Bearer " and newline still works', !r.err && calls.at(-1).auth === `Bearer ${TOKEN}`);
reset();
r = await tool(env({ GLBGPT_TOKEN: `"${TOKEN}"` }), 'glbgpt_account');
check('token pasted with quotes (from credentials.json) still works', !r.err && calls.at(-1).auth === `Bearer ${TOKEN}`);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
