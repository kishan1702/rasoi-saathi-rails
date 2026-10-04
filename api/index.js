'use strict';
// Single entry point: MCP (Streamable HTTP, stateless JSON) at /mcp and /mcp/<group>,
// plus REST mirrors of the mock endpoints at the paths listed in tools.json.
const spec = require('../lib/tools.json');
const dlv = require('../lib/delhivery');
const pine = require('../lib/pine');
const rasoi = require('../lib/rasoi');
const household = require('../lib/household');
const real = require('../lib/real');
const store = require('../lib/store');
const { fail } = require('../lib/util');

const HANDLERS = {
  gnani_stt_transcribe: real.gnaniStt, gnani_tts_synthesize: real.gnaniTts,
  pine_get_token: pine.token, pine_get_mandate_status: pine.mandateStatus, pine_create_mandate_link: pine.createMandateLink, pine_revoke_mandate: pine.revokeMandate,
  pine_create_order: pine.createOrder, pine_debit_mandate: pine.debitMandate, pine_get_order: pine.getOrder, pine_capture_order: pine.captureOrder, pine_cancel_order: pine.cancelOrder, pine_refund_order: pine.refundOrder,
  dlv_pincode_serviceability: dlv.pincode, dlv_shipping_charges: dlv.charges, dlv_create_shipment: dlv.createShipment, dlv_pickup_request: dlv.pickup, dlv_track_shipment: dlv.track, dlv_cancel_shipment: dlv.cancel,
  rasoi_grocery_quote: rasoi.groceryQuote, rasoi_policy_evaluate: rasoi.policyEvaluate, rasoi_food_nutrition: rasoi.nutrition,
  tg_send_message: real.tgSendMessage, tg_send_voice: real.tgSendVoice, tg_send_approval: real.tgSendApproval, tg_get_file: real.tgGetFile, tg_answer_callback: real.tgAnswerCallback,
  sheets_read: real.sheetsRead, sheets_append: real.sheetsAppend, sheets_update: real.sheetsUpdate,
  gmail_search: real.gmailSearch, gmail_read: real.gmailRead,
};
const REAL = new Set(['gnani', 'telegram', 'google_sheets', 'gmail']);
const MOCK_TAG = { pine_labs: '[MOCK — no real money moves] ', delhivery_mock: '[MOCK] ', rasoi_capabilities: '' };
const READ_ONLY = /^(pine_get_|dlv_pincode|dlv_shipping|dlv_track|rasoi_|sheets_read|gmail_|tg_get_file|gnani_)/;
const TOOLS = [];
for (const c of spec.connectors) for (const t of c.tools) {
  TOOLS.push({ group: c.connector, name: t.name, description: (MOCK_TAG[c.connector] || '') + t.description, inputSchema: t.input_schema, annotations: { readOnlyHint: READ_ONLY.test(t.name), openWorldHint: REAL.has(c.connector) } });
}
Object.assign(HANDLERS, { household_inventory_check: household.inventoryCheck, household_recipes_list: household.recipesList, household_members_list: household.membersList });
TOOLS.push(
  { group: 'rasoi_capabilities', name: 'household_inventory_check', description: 'Read the household pantry from the shared sheet. Use for "do we have X", "what is in stock at home", "what is running low". Pass item to filter, or omit to list everything. Returns qty, unit, available (qty minus reserved), source, confidence, updated_at.', inputSchema: { type: 'object', properties: { item: { type: 'string' } } }, annotations: { readOnlyHint: true, openWorldHint: true } },
  { group: 'rasoi_capabilities', name: 'household_recipes_list', description: 'List the household recipes with whether each can be cooked from the current pantry and what is missing. Use for "what can I cook tonight". Optional health_filter (text matched against health_tags, e.g. diabetic). Always check member health rules before suggesting.', inputSchema: { type: 'object', properties: { health_filter: { type: 'string' } } }, annotations: { readOnlyHint: true, openWorldHint: true } },
  { group: 'rasoi_capabilities', name: 'household_members_list', description: 'List household members with role, can_approve, language and health rules from the shared sheet.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true, openWorldHint: true } }
);
const GROUP_ALIAS = { gnani: ['gnani'], pine: ['pine_labs'], pine_labs: ['pine_labs'], delhivery: ['delhivery_mock'], delhivery_mock: ['delhivery_mock'], rasoi: ['rasoi_capabilities'], rasoi_capabilities: ['rasoi_capabilities'], telegram: ['telegram'], sheets: ['google_sheets'], google_sheets: ['google_sheets'], gmail: ['gmail'], mocks: ['pine_labs', 'delhivery_mock', 'rasoi_capabilities'], real: ['gnani', 'telegram', 'google_sheets', 'gmail'] };

const KEY = () => (process.env.RASOI_API_KEY || '').trim();
function keyOk(req, query) {
  const k = KEY();
  if (!k) return true;
  const h = req.headers || {};
  const cands = [h.authorization, h['x-api-key'], h['api-key'], h['x-api-key-id'], h['api_key'], query.get('key'), query.get('api_key')].filter(Boolean).map((v) => String(v).replace(/^(Bearer|Token|ApiKey|Basic)\s+/i, '').trim());
  return cands.includes(k);
}
const scrub = (s) => { let o = String(s); for (const k of ['TELEGRAM_BOT_TOKEN', 'GNANI_API_KEY', 'RASOI_API_KEY', 'GMAIL_REFRESH_TOKEN', 'GMAIL_CLIENT_SECRET']) { const v = (process.env[k] || '').trim(); if (v) o = o.split(v).join('***'); } return o; };


// Platforms differ in how they pass tool arguments: wrapped, or nested objects as JSON strings. Normalise before validating.
function normArgs(args, t) {
  let a = args && typeof args === 'object' ? args : {};
  if (typeof args === 'string') { try { a = JSON.parse(args); } catch (e) { a = {}; } }
  for (const w of ['arguments', 'params', 'input', 'body', 'payload', 'data']) {
    if (a[w] && typeof a[w] === 'object' && !Array.isArray(a[w]) && !((t.inputSchema && t.inputSchema.properties) || {})[w]) a = { ...a[w], ...Object.fromEntries(Object.entries(a).filter(([k]) => k !== w)) };
  }
  const props = (t.inputSchema && t.inputSchema.properties) || {};
  const out = { ...a };
  for (const [k, def] of Object.entries(props)) {
    if (typeof out[k] === 'string' && (def.type === 'object' || def.type === 'array')) { try { out[k] = JSON.parse(out[k]); } catch (e) { /* leave */ } }
  }
  return out;
}

async function callTool(name, args, ctx) {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return fail(404, 'unknown_tool', `Unknown tool ${name}`);
  if (REAL.has(t.group) && !KEY()) return fail(503, 'server_key_not_set', 'Real connectors are disabled until RASOI_API_KEY is set on the server, because this endpoint is public.');
  args = normArgs(args, t);
  const miss = ((t.inputSchema && t.inputSchema.required) || []).filter((k) => args[k] === undefined || args[k] === null);
  if (miss.length) return fail(400, 'missing_param', `Missing required field(s): ${miss.join(', ')}. Received keys: ${Object.keys(args).join(', ') || '(none)'}`);
  try { return await HANDLERS[name](args, ctx); }
  catch (e) {
    const timeout = e && (e.name === 'AbortError' || /abort/i.test(String(e.message)));
    return fail(timeout ? 504 : 502, timeout ? 'upstream_timeout' : 'upstream_unreachable', scrub(timeout ? 'The upstream service did not answer in time' : (e && e.message) || 'request failed'));
  }
}

/* ------------------------------------------------------------------ MCP */
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
async function rpc(msg, ctx, groups) {
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  const error = (code, message) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return error(-32600, 'Invalid Request');
  if (msg.id === undefined) return null; // notification
  const list = TOOLS.filter((t) => !groups || groups.includes(t.group));
  switch (msg.method) {
    case 'initialize': {
      const want = msg.params && msg.params.protocolVersion;
      return reply({ protocolVersion: VERSIONS.includes(want) ? want : '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'rasoi-saathi-tools', version: '1.0.0' }, instructions: 'Tools for the Rasoi Saathi kitchen agent. pine_* and dlv_* are mocks; rasoi_* are the three custom capabilities; tg_*, sheets_*, gmail_* and gnani_* call the real services.' });
    }
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: list.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })) });
    case 'tools/call': {
      const p = msg.params || {};
      if (!list.find((t) => t.name === p.name)) return error(-32602, `Unknown tool: ${p.name}`);
      const res = await callTool(p.name, p.arguments || {}, ctx);
      const isError = res.status >= 400;
      const content = [{ type: 'text', text: JSON.stringify(isError ? { http_status: res.status, ...res.body } : res.body) }];
      if (res.image) content.push({ type: 'image', data: res.image.data, mimeType: res.image.mimeType });
      return reply({ content, isError });
    }
    case 'resources/list': return reply({ resources: [] });
    case 'resources/templates/list': return reply({ resourceTemplates: [] });
    case 'prompts/list': return reply({ prompts: [] });
    default: return error(-32601, `Method not found: ${msg.method}`);
  }
}

/* ------------------------------------------------------------------ REST mirrors */
// [method, path regex, tool, (match, query, body) => args]
const q = (query) => Object.fromEntries(query);
const num = (o, keys) => { for (const k of keys) if (o[k] !== undefined && o[k] !== '' && !Number.isNaN(Number(o[k]))) o[k] = Number(o[k]); return o; };
const ROUTES = [
  ['GET', /^\/c\/api\/pin-codes\/json$/, 'dlv_pincode_serviceability', (m, qy) => q(qy)],
  ['GET', /^\/api\/kinko\/v1\/invoice\/charges\/\.json$/, 'dlv_shipping_charges', (m, qy) => num(q(qy), ['cgm'])],
  ['POST', /^\/api\/cmu\/create\.json$/, 'dlv_create_shipment', (m, qy, b) => ({ format: b.format || 'json', data: b.data })],
  ['POST', /^\/fm\/request\/new$/, 'dlv_pickup_request', (m, qy, b) => b],
  ['GET', /^\/api\/v1\/packages\/json$/, 'dlv_track_shipment', (m, qy) => q(qy)],
  ['POST', /^\/api\/p\/edit$/, 'dlv_cancel_shipment', (m, qy, b) => b],
  ['POST', /^\/rasoi\/v1\/grocery\/quote$/, 'rasoi_grocery_quote', (m, qy, b) => b],
  ['POST', /^\/rasoi\/v1\/policy\/evaluate$/, 'rasoi_policy_evaluate', (m, qy, b) => b],
  ['POST', /^\/rasoi\/v1\/foodstate\/nutrition$/, 'rasoi_food_nutrition', (m, qy, b) => b],
  ['POST', /^\/api\/auth\/v1\/token$/, 'pine_get_token', () => ({})],
  ['POST', /^\/api\/pay\/v1\/orders$/, 'pine_create_order', (m, qy, b) => b],
  ['GET', /^\/api\/pay\/v1\/orders\/([^/]+)$/, 'pine_get_order', (m) => ({ order_id: m[1] })],
  ['POST', /^\/api\/pay\/v1\/orders\/([^/]+)\/capture$/, 'pine_capture_order', (m, qy, b) => ({ ...b, order_id: m[1] })],
  ['POST', /^\/api\/pay\/v1\/orders\/([^/]+)\/cancel$/, 'pine_cancel_order', (m) => ({ order_id: m[1] })],
  ['POST', /^\/api\/pay\/v1\/refunds\/([^/]+)$/, 'pine_refund_order', (m, qy, b) => ({ ...b, order_id: m[1] })],
  ['GET', /^\/mock\/p3p\/v1\/mandates\/([^/]+)$/, 'pine_get_mandate_status', (m) => ({ mandate_id: m[1] })],
  ['POST', /^\/mock\/p3p\/v1\/mandates$/, 'pine_create_mandate_link', (m, qy, b) => b],
  ['POST', /^\/mock\/p3p\/v1\/mandates\/([^/]+)\/(revoke|update)$/, 'pine_revoke_mandate', (m, qy, b) => ({ ...b, mandate_id: m[1], action: m[2] })],
  ['POST', /^\/mock\/p3p\/v1\/mandates\/([^/]+)\/debit$/, 'pine_debit_mandate', (m, qy, b) => ({ ...b, mandate_id: m[1] })],
];

async function readBody(req) {
  let b;
  try { b = req.body; } catch (_) { return { __invalid: true }; } // Vercel throws on malformed JSON
  if (b === undefined) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    b = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') {
    if (!b.trim()) return {};
    try { return JSON.parse(b); } catch (_) { /* maybe form-encoded */ }
    if ((req.headers['content-type'] || '').includes('urlencoded')) return Object.fromEntries(new URLSearchParams(b));
    return { __invalid: true };
  }
  return b || {};
}
function send(res, status, body, headers) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  for (const [k, v] of Object.entries(headers || {})) res.setHeader(k, v);
  res.end(body === undefined ? '' : JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  const u = new URL(req.url, 'http://x');
  let path = u.searchParams.get('__path') || u.pathname;
  u.searchParams.delete('__path');
  path = ('/' + path).replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
  const query = u.searchParams;
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const ctx = { origin: `${req.headers['x-forwarded-proto'] || 'https'}://${host}` };

  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type, authorization, x-api-key, mcp-session-id, mcp-protocol-version, accept');
  res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  if (req.method === 'GET' && (path === '/' || path === '/health')) {
    return send(res, 200, { service: 'rasoi-saathi-tools', ok: true, mcp_endpoint: `${ctx.origin}/mcp`, mcp_groups: Object.keys(GROUP_ALIAS).map((g) => `/mcp/${g}`), tools: TOOLS.length, api_key_required: Boolean(KEY()), connectors: { pine_labs: 'mock', delhivery_mock: 'mock', rasoi_capabilities: 'ready', ...Object.fromEntries(Object.entries(real.configured()).map(([k, v]) => [k, !KEY() ? 'disabled until RASOI_API_KEY is set' : v ? 'configured' : 'not configured'])) }, state: store.durable ? 'durable (KV)' : 'in-memory (resets when the function goes cold)' });
  }
  if (req.method === 'GET' && path === '/mock/mandate/authorise') {
    res.statusCode = 200; res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mock mandate</title><body style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem"><h2>Mock mandate authorised</h2><p>This is a demo stand-in for approving a UPI mandate. No real mandate was created and no money can move. The mock mandate becomes ACTIVE about 30 seconds after its link was created.</p></body>');
  }

  const mcp = path.match(/^\/(?:api\/)?mcp(?:\/([a-z_]+))?$/) || (path === '/' && req.method !== 'GET' ? ['/', undefined] : null);
  if (mcp) {
    if (mcp[1] && !GROUP_ALIAS[mcp[1]]) return send(res, 404, { error: `Unknown tool group ${mcp[1]}` });
    if (!keyOk(req, query)) return send(res, 401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized: missing or wrong API key' } }, { 'www-authenticate': 'Bearer' });
    if (req.method === 'DELETE') { res.statusCode = 204; return res.end(); }
    if (req.method !== 'POST') return send(res, 405, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Use POST with JSON-RPC (MCP Streamable HTTP). This server does not open an SSE stream.' } }, { allow: 'POST' });
    const body = await readBody(req);
    if (body.__invalid) return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    const groups = mcp[1] ? GROUP_ALIAS[mcp[1]] : null;
    const out = Array.isArray(body) ? (await Promise.all(body.map((m) => rpc(m, ctx, groups)))).filter(Boolean) : await rpc(body, ctx, groups);
    if (!out || (Array.isArray(out) && !out.length)) { res.statusCode = 202; return res.end(); }
    return send(res, 200, out);
  }

  for (const [method, re, tool, toArgs] of ROUTES) {
    const m = path.match(re);
    if (!m || method !== req.method) continue;
    if (!keyOk(req, query)) return send(res, 401, { success: false, error: { code: 'unauthorized', message: 'Missing or wrong API key. Send Authorization: Token <key>.' } });
    const body = req.method === 'POST' ? await readBody(req) : {};
    if (body.__invalid) return send(res, 400, { success: false, error: { code: 'invalid_json', message: 'Body is not valid JSON' } });
    const r = await callTool(tool, toArgs(m, query, body), ctx);
    return send(res, r.status, r.body);
  }
  return send(res, 404, { success: false, error: { code: 'not_found', message: `No route for ${req.method} ${path}` } });
};
module.exports.TOOLS = TOOLS;
