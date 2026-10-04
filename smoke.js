'use strict';
// Local smoke test: node test/smoke.js   (no network needed; real connectors are only checked for clean refusals)
const http = require('http');
const assert = require('assert');
process.env.RASOI_API_KEY = 'test-key';
process.env.TEST_FAST = '1';
const handler = require('../api/index.js');
const spec = require('../lib/tools.json');

const server = http.createServer((req, res) => handler(req, res).catch((e) => { console.error(e); res.statusCode = 500; res.end(String(e)); }));
let base, n = 0;
const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer test-key' };
async function rpc(method, params, path = '/mcp', headers = H) {
  const r = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method, params }) });
  const t = await r.text();
  return { status: r.status, json: t ? JSON.parse(t) : null };
}
async function call(name, args) {
  const r = await rpc('tools/call', { name, arguments: args });
  assert.strictEqual(r.status, 200, name);
  const res = r.json.result;
  return { isError: res.isError, data: JSON.parse(res.content[0].text) };
}
const t = async (name, fn) => { try { await fn(); console.log('  ok  ' + name); } catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.message || e)); process.exitCode = 1; } };

server.listen(0, async () => {
  base = `http://127.0.0.1:${server.address().port}`;
  await t('rejects a wrong key', async () => { assert.strictEqual((await rpc('tools/list', {}, '/mcp', { ...H, authorization: 'Bearer nope' })).status, 401); });
  await t('accepts key as Token header, x-api-key and ?key=', async () => {
    assert.strictEqual((await rpc('ping', {}, '/mcp', { ...H, authorization: 'Token test-key' })).status, 200);
    assert.strictEqual((await rpc('ping', {}, '/mcp', { 'content-type': 'application/json', 'x-api-key': 'test-key' })).status, 200);
    assert.strictEqual((await rpc('ping', {}, '/mcp?key=test-key', { 'content-type': 'application/json' })).status, 200);
  });
  await t('initialize', async () => { const r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } }); assert.strictEqual(r.json.result.protocolVersion, '2025-06-18'); assert.ok(r.json.result.capabilities.tools); });
  await t('notification gets 202', async () => { const r = await fetch(base + '/mcp', { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }); assert.strictEqual(r.status, 202); });
  await t('tools/list matches tools.json exactly (31 tools, names, schemas)', async () => {
    const got = (await rpc('tools/list')).json.result.tools;
    const want = spec.connectors.flatMap((c) => c.tools);
    assert.strictEqual(got.length, 31); assert.strictEqual(want.length, 31);
    for (const w of want) { const g = got.find((x) => x.name === w.name); assert.ok(g, 'missing ' + w.name); assert.deepStrictEqual(g.inputSchema, w.input_schema, w.name); assert.strictEqual(g.inputSchema.type, 'object'); }
  });
  await t('group endpoints filter tools', async () => {
    assert.strictEqual((await rpc('tools/list', {}, '/mcp/delhivery')).json.result.tools.length, 6);
    assert.strictEqual((await rpc('tools/list', {}, '/mcp/rasoi')).json.result.tools.length, 3);
    assert.strictEqual((await rpc('tools/list', {}, '/mcp/pine')).json.result.tools.length, 10);
    assert.strictEqual((await rpc('tools/list', {}, '/mcp/mocks')).json.result.tools.length, 19);
    assert.strictEqual((await rpc('tools/list', {}, '/mcp/real')).json.result.tools.length, 12);
  });

  await t('delhivery: serviceability yes / no', async () => {
    assert.strictEqual((await call('dlv_pincode_serviceability', { filter_codes: '700064' })).data.delivery_codes.length, 1);
    assert.strictEqual((await call('dlv_pincode_serviceability', { filter_codes: '700099' })).data.delivery_codes.length, 0);
  });
  await t('delhivery: charges', async () => { const r = await call('dlv_shipping_charges', { md: 'S', ss: 'Delivered', o_pin: '700064', d_pin: '700091', cgm: 1800, pt: 'Pre-paid' }); assert.ok(r.data[0].total_amount > 0); assert.strictEqual(r.data[0].zone, 'A'); });
  let awb;
  await t('delhivery: create, duplicate, track, pickup, cancel', async () => {
    const mk = (order) => ({ format: 'json', data: { shipments: [{ name: 'Mehta', add: 'CK 12 Salt Lake', pin: '700091', order, payment_mode: 'Prepaid' }], pickup_location: { name: 'FreshMart Salt Lake' } } });
    const a = await call('dlv_create_shipment', mk('ORD-20261004-AB12'));
    assert.strictEqual(a.data.success, true); awb = a.data.packages[0].waybill; assert.match(awb, /^\d{14}$/);
    const d = await call('dlv_create_shipment', mk('ORD-20261004-AB12'));
    assert.strictEqual(d.data.success, false); assert.strictEqual(d.data.packages[0].waybill, awb);
    const tr = await call('dlv_track_shipment', { waybill: awb });
    assert.strictEqual(tr.data.ShipmentData[0].Shipment.Status.Status, 'Manifested'); assert.ok(tr.data.ShipmentData[0].Shipment.ExpectedDeliveryDate);
    assert.strictEqual((await call('dlv_track_shipment', { waybill: '12345678901234' })).data.Success, false);
    assert.strictEqual((await call('dlv_pickup_request', { pickup_location: 'FreshMart Salt Lake', pickup_date: '2026-10-05', pickup_time: '18:00:00', expected_package_count: 1 })).data.success, true);
    const no = await call('dlv_pickup_request', { pickup_location: 'FreshMart Salt Lake', pickup_date: '2026-10-05', pickup_time: '22:30:00', expected_package_count: 1 });
    assert.strictEqual(no.isError, true); assert.strictEqual(no.data.error.code, 'no_pickup_capacity');
    assert.strictEqual((await call('dlv_cancel_shipment', { waybill: awb, cancellation: 'true' })).data.status, true);
    assert.strictEqual((await call('dlv_track_shipment', { waybill: awb })).data.ShipmentData[0].Shipment.Status.Status, 'Cancelled');
  });

  let quote;
  await t('rasoi: grocery quote (stock, substitutes, unknown item/store)', async () => {
    const r = await call('rasoi_grocery_quote', { home_pin: '700091', store_ids: ['FM-SALTLAKE', 'BB-NEWTOWN', 'NOPE'], items: [{ name: 'paneer', qty: 400, unit: 'g' }, { name: 'dahi', qty: 1, unit: 'kg' }, { name: 'dragonfruit', qty: 1, unit: 'kg' }] });
    quote = r.data; assert.strictEqual(quote.stores.length, 2); assert.strictEqual(quote.errors[0].code, 'unknown_store');
    const fm = quote.stores[0];
    assert.strictEqual(fm.items[0].packs, 2); assert.strictEqual(fm.items[0].line_total_paise, 19000);
    assert.strictEqual(fm.items[1].in_stock, false); assert.strictEqual(fm.items[1].store_substitutes[0].sku, 'curd-1kg');
    assert.strictEqual(fm.items[2].reason, 'not_listed');
    assert.strictEqual(quote.stores[1].items[0].in_stock, false);
  });
  const mandate = { status: 'ACTIVE', per_order_cap: 250, monthly_cap: 8000, spent_this_month: 3000, expires_at: '2027-03-31', approved_merchants: 'FreshMart Salt Lake, BigBasket New Town', approved_substitutions: 'curd 500 g -> curd 1 kg' };
  const cart = { merchant: 'FreshMart Salt Lake', items: [{ sku: 'paneer-200', packs: 1, line_total_paise: 9500 }], total_paise: 12000, delivery_slot: '19:40' };
  await t('rasoi: policy AUTO inside limits', async () => { const r = await call('rasoi_policy_evaluate', { mandate, cart }); assert.strictEqual(r.data.decision, 'AUTO'); assert.deepStrictEqual(r.data.reasons, []); });
  await t('rasoi: policy ESCALATE over per-order cap, bad merchant, bad substitution, health flag', async () => {
    const r = await call('rasoi_policy_evaluate', { mandate, cart: { ...cart, merchant: 'Random Mart', total_paise: 31500, substitutions: [{ from: 'paneer', to: 'tofu' }] }, health_flags: ['sugar over Papa limit'] });
    assert.strictEqual(r.data.decision, 'ESCALATE');
    assert.deepStrictEqual(r.data.reasons.map((x) => x.code).sort(), ['HEALTH_FLAG', 'MERCHANT_NOT_APPROVED', 'OVER_PER_ORDER_CAP', 'SUBSTITUTION_NOT_APPROVED']);
  });
  await t('rasoi: policy fails closed on missing mandate fields, monthly cap, expiry', async () => {
    assert.strictEqual((await call('rasoi_policy_evaluate', { mandate: { status: 'ACTIVE' }, cart })).data.decision, 'ESCALATE');
    assert.ok((await call('rasoi_policy_evaluate', { mandate: { ...mandate, spent_this_month: 7950 }, cart })).data.reasons.some((x) => x.code === 'OVER_MONTHLY_CAP'));
    assert.ok((await call('rasoi_policy_evaluate', { mandate: { ...mandate, expires_at: '2025-01-01' }, cart })).data.reasons.some((x) => x.code === 'MANDATE_EXPIRED'));
    assert.strictEqual((await call('rasoi_policy_evaluate', { mandate: { ...mandate, approved_substitutions: '' }, cart: { ...cart, substitutions: ['curd 500 g -> curd 1 kg'] } })).data.decision, 'ESCALATE');
    assert.strictEqual((await call('rasoi_policy_evaluate', { mandate, cart: { ...cart, substitutions: ['curd 500 g -> curd 1 kg'] } })).data.decision, 'AUTO');
  });
  await t('rasoi: policy diff against approved cart', async () => {
    const big = { ...cart, total_paise: 31500 };
    const same = await call('rasoi_policy_evaluate', { mandate, cart: big, approved_cart: big });
    assert.strictEqual(same.data.diff.changed, false); assert.strictEqual(same.data.approval_still_covers_cart, true); assert.strictEqual(same.data.decision, 'ESCALATE');
    const diff = await call('rasoi_policy_evaluate', { mandate, cart: { ...big, total_paise: 33000 }, approved_cart: big });
    assert.strictEqual(diff.data.diff.changed, true); assert.strictEqual(diff.data.approval_still_covers_cart, false);
  });
  await t('rasoi: nutrition dish, pieces, not found, ingredients', async () => {
    const r = await call('rasoi_food_nutrition', { dish: 'plain rice', portion: { unit: 'katori', count: 1, ml_per_unit: 150 } });
    assert.strictEqual(r.data.nutrients.energy_kcal, 195); assert.strictEqual(r.data.nutrients.carbs_g, 42);
    const roti = await call('rasoi_food_nutrition', { dish: 'Roti', portion: { unit: 'roti', count: 2 } });
    assert.strictEqual(roti.data.portion.grams, 80); assert.deepStrictEqual(roti.data.allergens, ['gluten']);
    const nf = await call('rasoi_food_nutrition', { dish: 'undhiyu', portion: { unit: 'katori', count: 1 } });
    assert.strictEqual(nf.isError, true); assert.strictEqual(nf.data.http_status, 404); assert.strictEqual(nf.data.error.code, 'dish_not_found');
    const ing = await call('rasoi_food_nutrition', { ingredients: [{ name: 'paneer', qty: 200, unit: 'g' }, { name: 'palak', qty: 250, unit: 'g' }, { name: 'mystery', qty: 1, unit: 'kg' }], servings: 4, portion: { unit: 'katori', count: 1 } });
    assert.ok(ing.data.allergens.includes('milk')); assert.strictEqual(ing.data.unknown_ingredients.length, 1); assert.strictEqual(ing.data.portion.share_of_recipe, 0.25);
  });

  await t('pine: full payment flow, one cart one payment', async () => {
    assert.ok((await call('pine_get_token', {})).data.access_token);
    const m = await call('pine_get_mandate_status', { mandate_id: 'MND-DEMO-001' });
    assert.strictEqual(m.data.status, 'ACTIVE'); assert.strictEqual(m.data.per_order_cap_paise, 250000);
    assert.strictEqual((await call('pine_get_mandate_status', { mandate_id: 'nope' })).data.error.code, 'MANDATE_NOT_FOUND');
    const o = await call('pine_create_order', { merchant_order_reference: 'ORD-20261004-AB12', order_amount: { value: 31500, currency: 'INR' } });
    const id = o.data.data.order_id; assert.strictEqual(o.data.data.status, 'CREATED');
    const dup = await call('pine_create_order', { merchant_order_reference: 'ORD-20261004-AB12', order_amount: { value: 31500, currency: 'INR' } });
    assert.strictEqual(dup.data.error.code, 'DUPLICATE_ORDER'); assert.strictEqual(dup.data.existing_order_id, id);
    assert.strictEqual((await call('pine_debit_mandate', { order_id: id, mandate_id: 'MND-DEMO-001', amount: 100 })).data.error.code, 'AMOUNT_MISMATCH');
    assert.strictEqual((await call('pine_debit_mandate', { order_id: id, mandate_id: 'MND-DEMO-001', amount: 31500 })).data.data.status, 'PROCESSED');
    assert.strictEqual((await call('pine_debit_mandate', { order_id: id, mandate_id: 'MND-DEMO-001', amount: 31500 })).data.error.code, 'ORDER_ALREADY_ACTIONED');
    assert.strictEqual((await call('pine_get_order', { order_id: id })).data.data.status, 'PROCESSED');
    assert.strictEqual((await call('pine_get_mandate_status', { mandate_id: 'MND-DEMO-001' })).data.used_this_month_paise, 31500);
    assert.strictEqual((await call('pine_refund_order', { order_id: id, refund_amount: 9500, reason: 'paneer missing' })).data.data.status, 'PARTIALLY_REFUNDED');
    assert.strictEqual((await call('pine_refund_order', { order_id: id, refund_amount: 99999 })).data.error.code, 'REFUND_EXCEEDS_PAID');
    assert.strictEqual((await call('pine_get_mandate_status', { mandate_id: 'MND-DEMO-001' })).data.used_this_month_paise, 22000);
  });
  await t('pine: failure triggers, caps, cancel, mandate link and revoke', async () => {
    const mk = async (ref, value) => (await call('pine_create_order', { merchant_order_reference: ref, order_amount: { value, currency: 'INR' } })).data.data.order_id;
    const f = await mk('ORD-X-FAIL', 5000);
    assert.strictEqual((await call('pine_debit_mandate', { order_id: f, mandate_id: 'MND-DEMO-001', amount: 5000 })).data.data.failure_reason, 'INSUFFICIENT_BALANCE');
    const p = await mk('ORD-X-PEND', 5000);
    assert.strictEqual((await call('pine_debit_mandate', { order_id: p, mandate_id: 'MND-DEMO-001', amount: 5000 })).data.data.status, 'PENDING');
    assert.strictEqual((await call('pine_get_order', { order_id: p })).data.data.status, 'PENDING');
    const big = await mk('ORD-BIG', 300000);
    assert.strictEqual((await call('pine_debit_mandate', { order_id: big, mandate_id: 'MND-DEMO-001', amount: 300000 })).data.error.code, 'MANDATE_PER_ORDER_LIMIT_EXCEEDED');
    assert.strictEqual((await call('pine_cancel_order', { order_id: big })).data.data.status, 'CANCELLED');
    const l = await call('pine_create_mandate_link', { monthly_cap: 8000, per_order_cap: 250, expires_at: '2027-03-31', funder_member_id: 'M1' });
    assert.strictEqual(l.data.status, 'PENDING_AUTHORISATION'); assert.match(l.data.authorisation_url, /^http/);
    const st = await call('pine_get_mandate_status', { mandate_id: l.data.mandate_id });
    assert.strictEqual(st.data.status, 'PENDING_AUTHORISATION'); assert.strictEqual(st.data.monthly_cap_paise, 800000);
    assert.strictEqual((await call('pine_revoke_mandate', { mandate_id: l.data.mandate_id, action: 'update', new_limits: { per_order_cap: 400 } })).data.per_order_cap, 400);
    assert.strictEqual((await call('pine_revoke_mandate', { mandate_id: l.data.mandate_id, action: 'revoke' })).data.status, 'REVOKED');
    assert.strictEqual((await call('pine_get_order', { order_id: 'v1-missing' })).data.error.code, 'ORDER_NOT_FOUND');
  });

  await t('real connectors refuse cleanly when not configured', async () => {
    for (const [name, args] of [['tg_send_message', { chat_id: '1', text: 'hi' }], ['tg_send_approval', { chat_id: '1', text: 'x', pending_id: 'P1' }], ['tg_get_file', { file_id: 'f' }], ['gnani_tts_synthesize', { text: 'namaste', language_code: 'hi-IN' }], ['gnani_stt_transcribe', { audio_file_id: 'f', language_code: 'hi-IN' }], ['sheets_read', { spreadsheet_id: 's', ranges: ['members'] }], ['sheets_append', { spreadsheet_id: 's', range: 'log', values: [['a']] }], ['gmail_search', { query: 'label:bank-sms' }], ['gmail_read', { message_id: 'abc' }]]) {
      const r = await call(name, args); assert.strictEqual(r.isError, true, name); assert.strictEqual(r.data.error.code, 'connector_not_configured', name);
    }
  });
  await t('missing required args and unknown tool are rejected', async () => {
    assert.strictEqual((await call('dlv_shipping_charges', { md: 'S' })).data.error.code, 'missing_param');
    assert.ok((await rpc('tools/call', { name: 'nope', arguments: {} })).json.error);
  });
  await t('REST mirrors work at the tools.json paths', async () => {
    const A = { authorization: 'Token test-key' };
    const g = async (p) => { const r = await fetch(base + p, { headers: A }); return { s: r.status, j: await r.json() }; };
    const po = async (p, b, h) => { const r = await fetch(base + p, { method: 'POST', headers: { ...A, 'content-type': 'application/json', ...(h || {}) }, body: typeof b === 'string' ? b : JSON.stringify(b) }); return { s: r.status, j: await r.json() }; };
    assert.strictEqual((await fetch(base + '/c/api/pin-codes/json/?filter_codes=700064')).status, 401);
    assert.strictEqual((await g('/c/api/pin-codes/json/?filter_codes=700064')).j.delivery_codes.length, 1);
    assert.ok((await g('/api/kinko/v1/invoice/charges/.json?md=S&ss=Delivered&o_pin=700064&d_pin=700091&cgm=900&pt=Pre-paid')).j[0].total_amount);
    const form = 'format=json&data=' + encodeURIComponent(JSON.stringify({ shipments: [{ name: 'A', add: 'B', pin: '700091', order: 'ORD-REST-1', payment_mode: 'Prepaid' }], pickup_location: { name: 'FM' } }));
    const c = await po('/api/cmu/create.json', form, { 'content-type': 'application/x-www-form-urlencoded' });
    assert.strictEqual(c.j.success, true);
    assert.ok((await g('/api/v1/packages/json/?waybill=' + c.j.packages[0].waybill)).j.ShipmentData);
    assert.strictEqual((await po('/rasoi/v1/foodstate/nutrition', { dish: 'undhiyu', portion: { unit: 'katori', count: 1 } })).s, 404);
    const o = await po('/api/pay/v1/orders', { merchant_order_reference: 'ORD-REST-2', order_amount: { value: 1000, currency: 'INR' } });
    assert.strictEqual((await g('/api/pay/v1/orders/' + o.j.data.order_id)).j.data.status, 'CREATED');
    assert.strictEqual((await po('/api/pay/v1/orders/' + o.j.data.order_id + '/cancel', {})).j.data.status, 'CANCELLED');
    assert.strictEqual((await g('/nope')).s, 404);
    const h = await (await fetch(base + '/')).json(); assert.strictEqual(h.tools, 31); assert.ok(!JSON.stringify(h).includes('test-key'));
  });
  await t('vercel-style rewrite (?__path=) is honoured', async () => {
    const r = await fetch(base + '/api/index?__path=/c/api/pin-codes/json/&filter_codes=700064', { headers: { authorization: 'Token test-key' } });
    assert.strictEqual((await r.json()).delivery_codes.length, 1);
    assert.strictEqual((await rpc('tools/list', {}, '/api/index?__path=/mcp/rasoi')).json.result.tools.length, 3);
  });
  server.close();
  console.log(process.exitCode ? '\nSOME TESTS FAILED' : '\nall tests passed');
});
