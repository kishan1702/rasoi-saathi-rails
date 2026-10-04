'use strict';
// MOCK of Pine Labs Online order APIs plus placeholder P3P mandate APIs. No real money moves.
// Demo triggers:
//   - merchant_order_reference ending in -PEND -> debit stays PENDING for ~20 s, then PROCESSED
//   - merchant_order_reference ending in -FAIL -> debit FAILED (INSUFFICIENT_BALANCE)
//   - mandate_id MND-DEMO-001 is a seeded ACTIVE mandate (caps from MOCK_MANDATE_* env, default 15000 / 2500 rupees)
//   - mandates made by pine_create_mandate_link become ACTIVE 30 s after creation (stands in for the funder's UPI approval)
const { ok, fail, b64u, rid, iso } = require('./util');
const store = require('./store');

const R = (rupees) => Math.round(Number(rupees) * 100);
const ym = () => new Date().toISOString().slice(0, 7);

async function token() {
  return ok({ access_token: `mock_${rid(16)}`, token_type: 'Bearer', expires_in: 3600, expires_at: iso(Date.now() + 3600e3), mock: true });
}

function decodeMandate(id) {
  if (id === 'MND-DEMO-001') {
    return { monthly: Number(process.env.MOCK_MANDATE_MONTHLY_CAP || 15000), per: Number(process.env.MOCK_MANDATE_PER_ORDER_CAP || 2500), exp: process.env.MOCK_MANDATE_EXPIRES_AT || `${new Date().getUTCFullYear() + 1}-12-31`, funder: 'demo', created: 0 };
  }
  if (!/^MND_/.test(String(id || ''))) return null;
  try { const [monthly, per, exp, funder, created] = JSON.parse(b64u.dec(String(id).slice(4))); return { monthly, per, exp, funder, created }; } catch (_) { return null; }
}
async function mandateView(id) {
  const m = decodeMandate(id);
  if (!m) return null;
  const over = (await store.get(`pine:mandate:${id}`)) || {};
  const monthly = over.monthly ?? m.monthly, per = over.per ?? m.per, exp = over.exp ?? m.exp;
  let status = 'ACTIVE';
  if (over.revoked) status = 'REVOKED';
  else if (new Date(`${exp}T23:59:59+05:30`).getTime() < Date.now()) status = 'EXPIRED';
  else if (m.created && Date.now() - m.created * 1000 < 30000) status = 'PENDING_AUTHORISATION';
  const used = (await store.get(`pine:used:${id}:${ym()}`)) || 0;
  return { mandate_id: id, status, frequency: 'MONTHLY', currency: 'INR', monthly_cap: monthly, per_order_cap: per, monthly_cap_paise: R(monthly), per_order_cap_paise: R(per), used_this_month_paise: used, remaining_this_month_paise: Math.max(0, R(monthly) - used), expires_at: exp, funder_member_id: m.funder, last_debit_at: (await store.get(`pine:last:${id}`)) || null, mock: true };
}

async function mandateStatus({ mandate_id }) {
  if (!mandate_id) return fail(400, 'missing_param', 'mandate_id is required');
  const v = await mandateView(mandate_id);
  if (!v) return fail(404, 'MANDATE_NOT_FOUND', `No mandate ${mandate_id}`);
  return ok(v);
}

async function createMandateLink(a, ctx) {
  for (const k of ['monthly_cap', 'per_order_cap', 'expires_at', 'funder_member_id']) if (a[k] === undefined || a[k] === '') return fail(400, 'missing_param', `${k} is required`);
  if (!(Number(a.monthly_cap) > 0) || !(Number(a.per_order_cap) > 0)) return fail(400, 'invalid_cap', 'caps must be positive rupee amounts');
  if (Number(a.per_order_cap) > Number(a.monthly_cap)) return fail(400, 'invalid_cap', 'per_order_cap cannot exceed monthly_cap');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.expires_at)) || new Date(a.expires_at).getTime() < Date.now()) return fail(400, 'invalid_expiry', 'expires_at must be a future date, YYYY-MM-DD');
  const id = 'MND_' + b64u.enc(JSON.stringify([Number(a.monthly_cap), Number(a.per_order_cap), a.expires_at, String(a.funder_member_id), Math.floor(Date.now() / 1000)]));
  return ok({ mandate_id: id, status: 'PENDING_AUTHORISATION', authorisation_url: `${ctx.origin}/mock/mandate/authorise?mandate_id=${encodeURIComponent(id)}`, monthly_cap: Number(a.monthly_cap), per_order_cap: Number(a.per_order_cap), expires_at: a.expires_at, funder_member_id: String(a.funder_member_id), note: 'MOCK: becomes ACTIVE about 30 seconds after creation, standing in for the funder approving in their UPI app.', mock: true });
}

async function revokeMandate({ mandate_id, action, new_limits }) {
  const m = decodeMandate(mandate_id);
  if (!m) return fail(404, 'MANDATE_NOT_FOUND', `No mandate ${mandate_id}`);
  const over = (await store.get(`pine:mandate:${mandate_id}`)) || {};
  if (action === 'revoke') over.revoked = true;
  else if (action === 'update') {
    const n = new_limits || {};
    if (n.monthly_cap === undefined && n.per_order_cap === undefined && n.expires_at === undefined) return fail(400, 'missing_new_limits', 'new_limits needs monthly_cap, per_order_cap or expires_at');
    if (n.monthly_cap !== undefined) over.monthly = Number(n.monthly_cap);
    if (n.per_order_cap !== undefined) over.per = Number(n.per_order_cap);
    if (n.expires_at !== undefined) over.exp = String(n.expires_at);
  } else return fail(400, 'invalid_action', 'action must be revoke or update');
  await store.set(`pine:mandate:${mandate_id}`, over, 400 * 86400);
  return ok({ ...(await mandateView(mandate_id)), action_applied: action, state_is_durable: store.durable });
}

const pub = (o) => ({ data: { order_id: o.order_id, merchant_order_reference: o.ref, status: o.status, order_amount: { value: o.amount, currency: 'INR' }, captured_amount: o.captured || 0, refunded_amount: o.refunded || 0, failure_reason: o.failure || null, mandate_id: o.mandate_id || null, created_at: o.created_at, updated_at: o.updated_at, mock: true } });
async function load(order_id) {
  const o = await store.get(`pine:order:${order_id}`);
  if (o && o.status === 'PENDING' && o.settle_at && Date.now() >= o.settle_at) { o.status = 'PROCESSED'; o.updated_at = iso(Date.now()); await save(o); }
  return o;
}
const save = (o) => store.set(`pine:order:${o.order_id}`, o);

async function createOrder(a) {
  const ref = a.merchant_order_reference, amt = a.order_amount || {};
  if (!ref) return fail(400, 'missing_param', 'merchant_order_reference is required');
  if (!Number.isInteger(amt.value) || amt.value <= 0 || amt.currency !== 'INR') return fail(400, 'invalid_amount', 'order_amount.value must be a positive integer in paise with currency INR');
  const dup = await store.get(`pine:ref:${ref}`);
  if (dup) return fail(409, 'DUPLICATE_ORDER', `An order already exists for merchant_order_reference ${ref}`, { existing_order_id: dup });
  const now = iso(Date.now());
  const o = { order_id: `v1-${Date.now().toString(36)}-${rid(4)}`, ref, amount: amt.value, status: 'CREATED', purchase_details: a.purchase_details || null, created_at: now, updated_at: now };
  await save(o); await store.set(`pine:ref:${ref}`, o.order_id);
  return ok(pub(o));
}

async function debitMandate({ order_id, mandate_id, amount }) {
  const o = await load(order_id);
  if (!o) return fail(404, 'ORDER_NOT_FOUND', `No order ${order_id}`);
  if (o.status !== 'CREATED') return fail(409, 'ORDER_ALREADY_ACTIONED', `Order is ${o.status}; a debit was already attempted. Check pine_get_order.`, { current_status: o.status });
  if (amount !== o.amount) return fail(422, 'AMOUNT_MISMATCH', `Debit amount ${amount} does not equal order amount ${o.amount}`);
  const m = await mandateView(mandate_id);
  if (!m) return fail(404, 'MANDATE_NOT_FOUND', `No mandate ${mandate_id}`);
  if (m.status !== 'ACTIVE') return fail(422, m.status === 'EXPIRED' ? 'MANDATE_EXPIRED' : 'MANDATE_NOT_ACTIVE', `Mandate is ${m.status}`);
  if (amount > m.per_order_cap_paise) return fail(422, 'MANDATE_PER_ORDER_LIMIT_EXCEEDED', `Amount ${amount} exceeds per-order cap ${m.per_order_cap_paise} paise`);
  if (amount > m.remaining_this_month_paise) return fail(422, 'MANDATE_MONTHLY_LIMIT_EXCEEDED', `Amount ${amount} exceeds remaining monthly amount ${m.remaining_this_month_paise} paise`);
  o.mandate_id = mandate_id; o.updated_at = iso(Date.now());
  if (/-FAIL$/i.test(o.ref)) { o.status = 'FAILED'; o.failure = 'INSUFFICIENT_BALANCE'; }
  else {
    if (/-PEND$/i.test(o.ref)) { o.status = 'PENDING'; o.settle_at = Date.now() + 20000; } else o.status = 'PROCESSED';
    o.captured = amount;
    await store.set(`pine:used:${mandate_id}:${ym()}`, m.used_this_month_paise + amount, 40 * 86400);
    await store.set(`pine:last:${mandate_id}`, o.updated_at, 400 * 86400);
  }
  await save(o);
  return ok(pub(o));
}

async function getOrder({ order_id }) {
  const o = await load(order_id);
  if (!o) return fail(404, 'ORDER_NOT_FOUND', `No order ${order_id}. ${store.durable ? '' : 'Note: this mock keeps orders in memory unless a KV store is configured, so an order can be lost if the server restarted.'}`.trim());
  return ok(pub(o));
}
async function captureOrder({ order_id, capture_amount }) {
  const o = await load(order_id);
  if (!o) return fail(404, 'ORDER_NOT_FOUND', `No order ${order_id}`);
  if (o.status !== 'PROCESSED' && o.status !== 'AUTHORIZED') return fail(409, 'INVALID_ORDER_STATE', `Cannot capture an order in status ${o.status}`);
  if (capture_amount !== undefined && capture_amount > o.amount) return fail(422, 'CAPTURE_EXCEEDS_ORDER', 'capture_amount exceeds order amount');
  o.captured = capture_amount ?? o.amount; o.status = 'PROCESSED'; o.captured_final = true; o.updated_at = iso(Date.now()); await save(o);
  return ok(pub(o));
}
async function cancelOrder({ order_id }) {
  const o = await load(order_id);
  if (!o) return fail(404, 'ORDER_NOT_FOUND', `No order ${order_id}`);
  if (o.status !== 'CREATED' && o.status !== 'FAILED') return fail(409, 'INVALID_ORDER_STATE', `Cannot cancel an order in status ${o.status}; refund it instead`);
  o.status = 'CANCELLED'; o.updated_at = iso(Date.now()); await save(o);
  return ok(pub(o));
}
async function refundOrder({ order_id, refund_amount, reason }) {
  const o = await load(order_id);
  if (!o) return fail(404, 'ORDER_NOT_FOUND', `No order ${order_id}`);
  if (!['PROCESSED', 'PARTIALLY_REFUNDED'].includes(o.status)) return fail(409, 'INVALID_ORDER_STATE', `Cannot refund an order in status ${o.status}`);
  if (!Number.isInteger(refund_amount) || refund_amount <= 0) return fail(400, 'invalid_amount', 'refund_amount must be a positive integer in paise');
  const left = (o.captured || 0) - (o.refunded || 0);
  if (refund_amount > left) return fail(422, 'REFUND_EXCEEDS_PAID', `Only ${left} paise left to refund`);
  o.refunded = (o.refunded || 0) + refund_amount; o.status = o.refunded >= o.captured ? 'REFUNDED' : 'PARTIALLY_REFUNDED'; o.updated_at = iso(Date.now());
  if (o.mandate_id) { const k = `pine:used:${o.mandate_id}:${ym()}`; await store.set(k, Math.max(0, ((await store.get(k)) || 0) - refund_amount), 40 * 86400); }
  await save(o);
  return ok({ ...pub(o), refund: { refund_id: `rf-${rid(5)}`, amount: refund_amount, reason: reason || null, status: 'PROCESSED' } });
}

module.exports = { token, mandateStatus, createMandateLink, revokeMandate, createOrder, debitMandate, getOrder, captureOrder, cancelOrder, refundOrder };
