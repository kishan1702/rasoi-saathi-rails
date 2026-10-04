'use strict';
// The three Rasoi capabilities. Quote and nutrition use small synthetic tables (clearly marked);
// the policy engine is real, deterministic logic.
const { ok, fail, hashInt } = require('./util');

/* ---------------------------------------------------------------- 1. grocery quote */
// [sku, display name, aliases, pack size, pack unit (g|ml|pc), base price in rupees, substitutes]
const SKUS = [
  ['atta-5kg', 'Whole wheat atta 5 kg', ['atta', 'wheat flour', 'aata', 'gehun atta'], 5000, 'g', 245, ['atta-1kg']],
  ['atta-1kg', 'Whole wheat atta 1 kg', [], 1000, 'g', 56, []],
  ['rice-1kg', 'Sona masoori rice 1 kg', ['rice', 'chawal'], 1000, 'g', 68, ['rice-5kg']],
  ['rice-5kg', 'Sona masoori rice 5 kg', [], 5000, 'g', 320, []],
  ['toor-1kg', 'Toor (arhar) dal 1 kg', ['toor dal', 'arhar dal', 'dal', 'tur dal'], 1000, 'g', 165, ['toor-500']],
  ['toor-500', 'Toor (arhar) dal 500 g', [], 500, 'g', 86, []],
  ['moong-500', 'Moong dal 500 g', ['moong dal', 'mung dal'], 500, 'g', 72, []],
  ['rajma-500', 'Rajma 500 g', ['rajma', 'kidney beans'], 500, 'g', 95, []],
  ['chana-500', 'Kabuli chana 500 g', ['chana', 'chole', 'chickpeas', 'kabuli chana'], 500, 'g', 78, []],
  ['milk-500', 'Toned milk 500 ml', ['milk', 'doodh', 'dudh'], 500, 'ml', 28, ['milk-1l']],
  ['milk-1l', 'Toned milk 1 L', [], 1000, 'ml', 54, []],
  ['curd-500', 'Curd 500 g', ['curd', 'dahi', 'yogurt', 'yoghurt'], 500, 'g', 40, ['curd-1kg']],
  ['curd-1kg', 'Curd 1 kg', [], 1000, 'g', 75, []],
  ['paneer-200', 'Paneer 200 g', ['paneer', 'cottage cheese'], 200, 'g', 95, ['paneer-400', 'tofu-200']],
  ['paneer-400', 'Paneer 400 g', [], 400, 'g', 180, []],
  ['tofu-200', 'Tofu 200 g', ['tofu'], 200, 'g', 70, []],
  ['ghee-500', 'Ghee 500 ml', ['ghee'], 500, 'ml', 330, []],
  ['oil-1l', 'Mustard oil 1 L', ['oil', 'mustard oil', 'tel', 'sarson tel'], 1000, 'ml', 175, ['sunoil-1l']],
  ['sunoil-1l', 'Sunflower oil 1 L', ['sunflower oil', 'refined oil'], 1000, 'ml', 150, []],
  ['eggs-6', 'Eggs, pack of 6', ['egg', 'eggs', 'anda', 'ande'], 6, 'pc', 48, ['eggs-12']],
  ['eggs-12', 'Eggs, pack of 12', [], 12, 'pc', 92, []],
  ['bread-400', 'Brown bread 400 g', ['bread', 'brown bread'], 1, 'pc', 50, []],
  ['onion-1kg', 'Onion 1 kg', ['onion', 'onions', 'pyaz', 'pyaaz'], 1000, 'g', 38, []],
  ['potato-1kg', 'Potato 1 kg', ['potato', 'potatoes', 'aloo', 'alu'], 1000, 'g', 32, []],
  ['tomato-500', 'Tomato 500 g', ['tomato', 'tomatoes', 'tamatar'], 500, 'g', 24, []],
  ['bhindi-500', 'Bhindi (okra) 500 g', ['bhindi', 'okra', 'lady finger'], 500, 'g', 36, []],
  ['palak-250', 'Palak (spinach) 250 g', ['palak', 'spinach'], 250, 'g', 22, []],
  ['gobhi-1', 'Cauliflower, 1 piece', ['gobhi', 'cauliflower', 'phool gobhi'], 1, 'pc', 40, []],
  ['ginger-100', 'Ginger 100 g', ['ginger', 'adrak'], 100, 'g', 18, []],
  ['garlic-100', 'Garlic 100 g', ['garlic', 'lahsun', 'lehsun'], 100, 'g', 22, []],
  ['chilli-100', 'Green chilli 100 g', ['green chilli', 'chilli', 'hari mirch', 'mirchi'], 100, 'g', 12, []],
  ['dhania-100', 'Coriander leaves 100 g', ['coriander', 'dhania', 'hara dhania'], 100, 'g', 15, []],
  ['lemon-4', 'Lemon, pack of 4', ['lemon', 'nimbu'], 4, 'pc', 20, []],
  ['sugar-1kg', 'Sugar 1 kg', ['sugar', 'cheeni', 'chini'], 1000, 'g', 48, []],
  ['salt-1kg', 'Iodised salt 1 kg', ['salt', 'namak'], 1000, 'g', 28, []],
  ['tea-250', 'Tea 250 g', ['tea', 'chai', 'chai patti'], 250, 'g', 140, []],
  ['besan-500', 'Besan 500 g', ['besan', 'gram flour'], 500, 'g', 62, []],
  ['poha-500', 'Poha 500 g', ['poha', 'chivda'], 500, 'g', 45, []],
].map(([sku, name, aliases, pack, unit, price, subs]) => ({ sku, name, aliases, pack, unit, price, subs }));
const SKU = Object.fromEntries(SKUS.map((s) => [s.sku, s]));

const STORES = {
  'FM-SALTLAKE': { merchant: 'FreshMart Salt Lake', pin: '700064', mult: 1.0, oos: ['curd-500'], slotMin: 45, minOrder: 0 },
  'BB-NEWTOWN': { merchant: 'BigBasket New Town', pin: '700156', mult: 0.96, oos: ['paneer-200', 'palak-250'], slotMin: 90, minOrder: 20000 },
  'KIRANA-CK': { merchant: 'CK Market Kirana', pin: '700091', mult: 1.05, oos: ['bhindi-500', 'atta-5kg', 'tofu-200'], slotMin: 30, minOrder: 0 },
};
const UNIT = { kg: ['g', 1000], g: ['g', 1], gm: ['g', 1], gram: ['g', 1], grams: ['g', 1], l: ['ml', 1000], litre: ['ml', 1000], liter: ['ml', 1000], ltr: ['ml', 1000], ml: ['ml', 1], pc: ['pc', 1], pcs: ['pc', 1], piece: ['pc', 1], pieces: ['pc', 1], dozen: ['pc', 12], packet: ['pack', 1], pack: ['pack', 1], packets: ['pack', 1], dabba: ['pack', 1] };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function matchSku(name) {
  const n = norm(name);
  if (!n) return null;
  return SKUS.find((s) => s.sku === n || norm(s.name) === n || s.aliases.includes(n))
    || SKUS.filter((s) => s.aliases.some((a) => n.includes(a) || a.includes(n))).sort((a, b) => b.aliases[0].length - a.aliases[0].length)[0] || null;
}
function packsNeeded(s, qty, unit) {
  const u = UNIT[norm(unit)];
  if (!u) return null;
  if (u[0] === 'pack') return Math.ceil(qty);
  if (u[0] !== s.unit) return null;
  return Math.max(1, Math.ceil((qty * u[1]) / s.pack));
}
const priceAt = (st, s) => Math.round(s.price * st.mult) * 100; // paise, whole rupees
const slotAt = (st) => { const t = new Date(Math.ceil((Date.now() + st.slotMin * 60000) / 600000) * 600000); return { delivery_by: t.toISOString(), delivery_by_ist: new Date(t.getTime() + 19800000).toISOString().slice(11, 16) + ' IST' }; };

async function groceryQuote(a) {
  if (!/^[1-9]\d{5}$/.test(String(a.home_pin || ''))) return fail(400, 'invalid_home_pin', 'home_pin must be a 6-digit pincode');
  if (!Array.isArray(a.store_ids) || !a.store_ids.length) return fail(400, 'missing_store_ids', 'store_ids is required');
  if (!Array.isArray(a.items) || !a.items.length) return fail(400, 'missing_items', 'items is required');
  const stores = [], errors = [];
  for (const id of a.store_ids) {
    const st = STORES[String(id).toUpperCase()];
    if (/DOWN/i.test(String(id))) { errors.push({ store_id: id, code: 'store_quote_failed', message: 'Store did not respond; quote unavailable' }); continue; }
    if (!st) { errors.push({ store_id: id, code: 'unknown_store', message: `Unknown store. Known stores: ${Object.keys(STORES).join(', ')}` }); continue; }
    let subtotal = 0;
    const items = a.items.map((req) => {
      const s = matchSku(req.name);
      if (!s) return { requested: req, in_stock: false, reason: 'not_listed' };
      const packs = packsNeeded(s, Number(req.qty), req.unit);
      if (!packs) return { requested: req, sku: s.sku, name: s.name, in_stock: false, reason: 'unit_not_understood', pack_size: s.pack, pack_unit: s.unit };
      const inStock = !st.oos.includes(s.sku);
      const line = { requested: req, sku: s.sku, name: s.name, in_stock: inStock, pack_size: s.pack, pack_unit: s.unit, packs: packs, unit_price_paise: priceAt(st, s), line_total_paise: inStock ? priceAt(st, s) * packs : 0 };
      if (!inStock) { line.reason = 'out_of_stock'; line.store_substitutes = s.subs.map((k) => SKU[k]).filter((x) => !st.oos.includes(x.sku)).map((x) => ({ sku: x.sku, name: x.name, pack_size: x.pack, pack_unit: x.unit, unit_price_paise: priceAt(st, x), in_stock: true })); }
      subtotal += line.line_total_paise;
      return line;
    });
    stores.push({ store_id: String(id).toUpperCase(), merchant: st.merchant, store_pin: st.pin, next_delivery_slot: slotAt(st), min_order_paise: st.minOrder, items, items_subtotal_paise: subtotal, all_in_stock: items.every((i) => i.in_stock), meets_min_order: subtotal >= st.minOrder });
  }
  return ok({ quote_id: `Q-${Date.now().toString(36)}-${hashInt(JSON.stringify(a)) % 1000}`, home_pin: String(a.home_pin), quoted_at: new Date().toISOString(), valid_for_minutes: 30, currency: 'INR', stores, errors, note: 'Synthetic catalogue. Prices exclude delivery; get that from dlv_shipping_charges. store_substitutes are what the store offers, not what the household approved: check them against mandate.approved_substitutions.' });
}

/* ---------------------------------------------------------------- 2. policy evaluate */
const pick = (o, keys) => { for (const k of keys) if (o && o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; };
const list = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;\n]/) : []).map((s) => (typeof s === 'string' ? s.trim() : s)).filter(Boolean);
// returns paise; fields ending _paise are paise, everything else is rupees
function money(o, base) {
  const p = pick(o, [`${base}_paise`]);
  if (p !== undefined) return Number(p);
  const r = pick(o, [base, `${base}_inr`, `${base}_rupees`]);
  return r === undefined ? undefined : Math.round(Number(String(r).replace(/[₹,\s]/g, '')) * 100);
}
const itemKey = (i) => norm(i.sku || i.name || i.item || JSON.stringify(i));
const itemQty = (i) => Number(i.packs ?? i.qty ?? i.quantity ?? 1);
const itemPrice = (i) => Number(i.line_total_paise ?? i.price_paise ?? i.unit_price_paise ?? 0);

function diffCarts(appr, cart) {
  const d = { changed: false, changes: [] };
  const add = (c) => { d.changed = true; d.changes.push(c); };
  if (norm(appr.merchant) !== norm(cart.merchant)) add({ field: 'merchant', approved: appr.merchant, now: cart.merchant });
  if (Number(appr.total_paise) !== Number(cart.total_paise)) add({ field: 'total_paise', approved: appr.total_paise, now: cart.total_paise, delta_paise: Number(cart.total_paise) - Number(appr.total_paise) });
  if (appr.delivery_slot !== undefined && cart.delivery_slot !== undefined && String(appr.delivery_slot) !== String(cart.delivery_slot)) add({ field: 'delivery_slot', approved: appr.delivery_slot, now: cart.delivery_slot });
  const A = new Map((appr.items || []).map((i) => [itemKey(i), i])), C = new Map((cart.items || []).map((i) => [itemKey(i), i]));
  for (const [k, i] of C) { const o = A.get(k); if (!o) add({ field: 'item_added', item: i }); else if (itemQty(o) !== itemQty(i) || itemPrice(o) !== itemPrice(i)) add({ field: 'item_changed', approved: o, now: i }); }
  for (const [k, i] of A) if (!C.has(k)) add({ field: 'item_removed', item: i });
  if (JSON.stringify((appr.substitutions || []).map((s) => norm(JSON.stringify(s))).sort()) !== JSON.stringify((cart.substitutions || []).map((s) => norm(JSON.stringify(s))).sort())) add({ field: 'substitutions', approved: appr.substitutions || [], now: cart.substitutions || [] });
  return d;
}

async function policyEvaluate(a) {
  const m = a.mandate, cart = a.cart;
  if (!m || typeof m !== 'object') return fail(400, 'missing_mandate', 'mandate (the row from the mandate tab) is required');
  if (!cart || !cart.merchant || !Array.isArray(cart.items) || !Number.isInteger(cart.total_paise)) return fail(400, 'invalid_cart', 'cart needs merchant, items[] and integer total_paise');
  const reasons = [];
  const R = (code, message, extra) => reasons.push({ code, message, ...(extra || {}) });
  const rs = (p) => `₹${(p / 100).toFixed(p % 100 ? 2 : 0)}`;

  const status = String(pick(m, ['status', 'mandate_status']) || '').toUpperCase();
  if (!status) R('MANDATE_FIELD_MISSING', 'Mandate row has no status; cannot confirm it is active', { field: 'status' });
  else if (status !== 'ACTIVE') R('MANDATE_NOT_ACTIVE', `Mandate status is ${status}`);
  const exp = pick(m, ['expires_at', 'expiry', 'valid_until']);
  if (exp && new Date(`${String(exp).slice(0, 10)}T23:59:59+05:30`).getTime() < Date.now()) R('MANDATE_EXPIRED', `Mandate expired on ${exp}`);
  const auto = pick(m, ['auto_pay', 'auto_pay_enabled', 'autopay']);
  if (auto !== undefined && /^(n|no|false|0|off)$/i.test(String(auto))) R('AUTO_PAY_DISABLED', 'The funder has switched off automatic payment');

  const per = money(m, 'per_order_cap') ?? money(m, 'per_order_limit');
  if (per === undefined || Number.isNaN(per)) R('MANDATE_FIELD_MISSING', 'Mandate row has no per-order cap', { field: 'per_order_cap' });
  else if (cart.total_paise > per) R('OVER_PER_ORDER_CAP', `Total ${rs(cart.total_paise)} is over the ${rs(per)} per-order limit`, { limit_paise: per, over_by_paise: cart.total_paise - per });
  const monthly = money(m, 'monthly_cap') ?? money(m, 'monthly_limit');
  const spent = money(m, 'spent_this_month') ?? money(m, 'used_this_month') ?? money(m, 'month_spent');
  if (monthly === undefined || Number.isNaN(monthly)) R('MANDATE_FIELD_MISSING', 'Mandate row has no monthly cap', { field: 'monthly_cap' });
  else if (spent === undefined || Number.isNaN(spent)) R('MANDATE_FIELD_MISSING', 'Mandate row has no spent_this_month; cannot check the monthly cap', { field: 'spent_this_month' });
  else if (spent + cart.total_paise > monthly) R('OVER_MONTHLY_CAP', `This order would take the month to ${rs(spent + cart.total_paise)}, over the ${rs(monthly)} monthly limit`, { limit_paise: monthly, remaining_paise: Math.max(0, monthly - spent) });

  const merchants = list(pick(m, ['approved_merchants', 'merchants'])).map(norm);
  if (!merchants.length) R('MANDATE_FIELD_MISSING', 'Mandate row lists no approved merchants', { field: 'approved_merchants' });
  else if (!merchants.includes(norm(cart.merchant)) && !merchants.includes(norm(cart.store_id))) R('MERCHANT_NOT_APPROVED', `${cart.merchant} is not an approved merchant`);

  const okSubs = list(pick(m, ['approved_substitutions', 'substitutions'])).map((s) => norm(typeof s === 'string' ? s.replace(/->|=>|→/g, ' to ') : `${s.from || s.original} to ${s.to || s.substitute}`));
  for (const s of cart.substitutions || []) {
    const k = norm(typeof s === 'string' ? s.replace(/->|=>|→/g, ' to ') : `${s.from || s.original || s.requested} to ${s.to || s.substitute || s.with}`);
    if (!okSubs.includes(k)) R('SUBSTITUTION_NOT_APPROVED', `Substitution "${typeof s === 'string' ? s : `${s.from || s.original || s.requested} → ${s.to || s.substitute || s.with}`}" is not in the approved list`, { substitution: s });
  }
  for (const f of list(a.health_flags)) R('HEALTH_FLAG', `Health flag raised for this cart: ${f}`, { flag: f });
  const sum = cart.items.reduce((t, i) => t + (Number(i.line_total_paise) || 0), 0);
  if (sum > cart.total_paise) R('TOTAL_BELOW_ITEM_SUM', `Item lines add to ${rs(sum)} but the total is ${rs(cart.total_paise)}`);

  const out = { decision: reasons.length ? 'ESCALATE' : 'AUTO', reasons, cart_total_paise: cart.total_paise, evaluated_at: new Date().toISOString(), policy_version: 'rasoi-policy-1.0' };
  if (a.approved_cart && typeof a.approved_cart === 'object') {
    out.diff = diffCarts(a.approved_cart, cart);
    if (out.diff.changed) { reasons.push({ code: 'CART_CHANGED_SINCE_APPROVAL', message: 'The cart differs from the one that was approved; a new approval card is needed' }); out.decision = 'ESCALATE'; }
    const blocking = reasons.filter((r) => ['MANDATE_NOT_ACTIVE', 'MANDATE_EXPIRED', 'HEALTH_FLAG', 'CART_CHANGED_SINCE_APPROVAL'].includes(r.code));
    out.approval_still_covers_cart = !out.diff.changed && blocking.length === 0;
  } else out.diff = null;
  return ok(out);
}

/* ---------------------------------------------------------------- 3. food-state nutrition */
// Approximate values per 100 g, cooked/as eaten for dishes, raw for ingredients.
// [kcal, carbs g, sugar g, protein g, fat g, fibre g, sodium mg, glycaemic index, allergens, grams per piece (if counted by piece)]
const DISHES = {
  'roti': [264, 50, 1.5, 9, 3.5, 7, 180, 62, ['gluten'], 40], 'chapati': 'roti', 'phulka': 'roti',
  'paratha': [320, 45, 2, 7, 13, 5, 300, 66, ['gluten'], 80],
  'plain rice': [130, 28, 0.1, 2.7, 0.3, 0.4, 2, 73, []], 'rice': 'plain rice', 'chawal': 'plain rice', 'steamed rice': 'plain rice',
  'jeera rice': [160, 28, 0.2, 2.8, 4, 0.5, 180, 72, []],
  'dal': [105, 15, 1, 6.5, 2.5, 3.5, 250, 32, []], 'dal tadka': 'dal', 'toor dal': 'dal', 'arhar dal': 'dal',
  'moong dal': [98, 14, 1, 7, 2, 3.5, 230, 31, []],
  'rajma': [125, 17, 1.5, 6.5, 3.5, 5, 290, 29, []], 'rajma chawal': [140, 24, 0.8, 4.5, 2.5, 2.8, 180, 55, []],
  'chole': [150, 19, 2.5, 7, 5.5, 5.5, 320, 33, []], 'chana masala': 'chole',
  'bhindi': [95, 8, 2, 2, 6.5, 3.5, 220, 20, []], 'bhindi sabzi': 'bhindi', 'bhindi masala': 'bhindi',
  'aloo gobhi': [110, 12, 2.5, 2.5, 6, 2.8, 260, 55, []], 'aloo sabzi': [120, 16, 1.5, 2, 5.5, 2, 280, 70, []],
  'palak paneer': [165, 6, 2, 8.5, 12, 2.5, 330, 15, ['milk']], 'paneer butter masala': [240, 8, 4.5, 9, 19, 1.2, 420, 20, ['milk', 'tree nuts']],
  'paneer bhurji': [220, 5, 2.5, 13, 17, 1, 360, 15, ['milk']], 'mixed veg': [95, 10, 3, 2.5, 5, 3, 250, 40, []],
  'curd': [62, 4.5, 4.5, 3.5, 3.3, 0, 45, 28, ['milk']], 'dahi': 'curd', 'raita': [65, 5.5, 4.5, 3, 3, 0.5, 190, 30, ['milk']],
  'khichdi': [120, 20, 0.5, 4.5, 2.5, 1.8, 210, 55, []], 'poha': [160, 27, 2, 3, 4.5, 1.5, 280, 64, ['peanuts']],
  'upma': [150, 22, 1.5, 3.5, 5.5, 1.8, 300, 66, ['gluten']], 'idli': [135, 27, 0.5, 4.5, 0.5, 1.5, 250, 70, [], 40],
  'dosa': [185, 29, 0.8, 4, 6, 1.5, 280, 72, [], 90], 'sambar': [65, 10, 2, 3, 1.5, 2.5, 310, 40, []],
  'egg curry': [155, 5, 2, 9.5, 11, 1, 340, 20, ['egg']], 'omelette': [185, 1.5, 1, 12, 15, 0, 330, 0, ['egg'], 60],
  'chicken curry': [165, 5, 2, 15, 9.5, 1, 380, 20, []], 'kheer': [150, 23, 17, 4, 5, 0.2, 50, 60, ['milk', 'tree nuts']],
  'chai': [45, 7, 6.5, 1.2, 1.3, 0, 15, 55, ['milk']], 'tea': 'chai',
};
const ING = {
  'atta': [340, 71, 0.4, 12, 1.7, 11, 2, 62, ['gluten']], 'wheat flour': 'atta', 'maida': [348, 74, 0.3, 11, 0.9, 2.7, 2, 75, ['gluten']],
  'rice': [356, 78, 0.1, 7, 0.5, 0.4, 5, 73, []], 'toor dal': [335, 58, 1.5, 22, 1.7, 9, 28, 29, []], 'moong dal': [348, 60, 1.2, 24, 1.2, 8, 27, 29, []],
  'rajma': [333, 60, 2, 23, 1.3, 16, 12, 29, []], 'chana': [360, 61, 10, 19, 6, 12, 24, 28, []], 'besan': [387, 58, 10, 22, 6.5, 10, 64, 27, []],
  'milk': [60, 4.8, 4.8, 3.2, 3.3, 0, 44, 31, ['milk']], 'curd': [62, 4.5, 4.5, 3.5, 3.3, 0, 45, 28, ['milk']], 'paneer': [265, 3.5, 2.5, 18, 20, 0, 22, 15, ['milk']],
  'ghee': [900, 0, 0, 0, 100, 0, 0, 0, ['milk']], 'butter': [730, 0.5, 0.5, 0.6, 81, 0, 600, 0, ['milk']], 'oil': [900, 0, 0, 0, 100, 0, 0, 0, []],
  'mustard oil': [900, 0, 0, 0, 100, 0, 0, 0, ['mustard']], 'egg': [143, 0.7, 0.4, 12.6, 9.5, 0, 142, 0, ['egg']], 'chicken': [165, 0, 0, 31, 3.6, 0, 74, 0, []],
  'onion': [40, 9, 4.2, 1.1, 0.1, 1.7, 4, 15, []], 'tomato': [18, 3.9, 2.6, 0.9, 0.2, 1.2, 5, 15, []], 'potato': [77, 17, 0.8, 2, 0.1, 2.2, 6, 78, []],
  'bhindi': [33, 7, 1.5, 1.9, 0.2, 3.2, 7, 20, []], 'palak': [23, 3.6, 0.4, 2.9, 0.4, 2.2, 79, 15, []], 'gobhi': [25, 5, 1.9, 1.9, 0.3, 2, 30, 15, []],
  'sugar': [387, 100, 100, 0, 0, 0, 1, 65, []], 'jaggery': [383, 98, 97, 0.4, 0.1, 0, 30, 84, []], 'salt': [0, 0, 0, 0, 0, 0, 38758, 0, []],
  'peanuts': [567, 16, 4, 26, 49, 8.5, 18, 14, ['peanuts']], 'cashew': [553, 30, 6, 18, 44, 3.3, 12, 22, ['tree nuts']], 'almond': [579, 22, 4.4, 21, 50, 12.5, 1, 15, ['tree nuts']],
  'poha': [346, 77, 0.5, 6.6, 1.2, 1, 5, 64, []], 'suji': [360, 73, 0.3, 12.7, 1, 3.9, 1, 66, ['gluten']], 'bread': [250, 47, 5, 9, 3.5, 6, 450, 70, ['gluten']],
  'soy': [446, 30, 7, 36, 20, 9, 2, 16, ['soy']], 'tofu': [76, 1.9, 0.6, 8, 4.8, 0.3, 7, 15, ['soy']], 'sesame': [573, 23, 0.3, 18, 50, 12, 11, 35, ['sesame']],
};
const resolve = (tbl, k) => { let v = tbl[k]; while (typeof v === 'string') v = tbl[v]; return v; };
const ALIAS = { aloo: 'potato', pyaz: 'onion', tamatar: 'tomato', doodh: 'milk', dahi: 'curd', chawal: 'rice', cheeni: 'sugar', namak: 'salt', anda: 'egg', eggs: 'egg', spinach: 'palak', okra: 'bhindi', cauliflower: 'gobhi', 'arhar dal': 'toor dal', dal: 'toor dal', chickpeas: 'chana', tel: 'oil', 'sunflower oil': 'oil', mungfali: 'peanuts', peanut: 'peanuts', kaju: 'cashew', badam: 'almond', rava: 'suji', gur: 'jaggery' };
const ML = { katori: 150, bowl: 250, glass: 250, cup: 200, ladle: 60, karchi: 60, kadchi: 60, plate: 300, tbsp: 15, tablespoon: 15, tsp: 5, teaspoon: 5, ml: 1, g: 1, gram: 1, grams: 1 };
const PIECE = ['piece', 'pieces', 'pc', 'roti', 'chapati', 'phulka', 'paratha', 'idli', 'dosa', 'egg', 'omelette'];
const toG = (qty, unit) => { const u = norm(unit); if (u === 'kg' || u === 'l') return qty * 1000; if (ML[u]) return qty * ML[u]; return null; };

async function nutrition(a) {
  const p = a.portion;
  if (!p || typeof p !== 'object') return fail(400, 'missing_portion', 'portion is required');
  const count = Number(p.count ?? 1), unit = norm(p.unit || 'katori');
  if (!(count > 0)) return fail(400, 'invalid_portion', 'portion.count must be positive');
  const N = (row, g) => ({ energy_kcal: +(row[0] * g / 100).toFixed(0), carbs_g: +(row[1] * g / 100).toFixed(1), sugar_g: +(row[2] * g / 100).toFixed(1), protein_g: +(row[3] * g / 100).toFixed(1), fat_g: +(row[4] * g / 100).toFixed(1), fibre_g: +(row[5] * g / 100).toFixed(1), sodium_mg: +(row[6] * g / 100).toFixed(0) });
  const base = { source: 'rasoi mock table (approximate, IFCT-style values). Stand-in for the HealthifyMe food-state rail; not clinical data.', mock: true };

  if (a.dish) {
    const key = norm(a.dish), row = resolve(DISHES, key);
    if (!row) return fail(404, 'dish_not_found', `No nutrition entry for "${a.dish}". Call again with the ingredient list.`);
    let grams, basis;
    if (PIECE.includes(unit) && row[9]) { grams = count * row[9]; basis = `${count} piece(s) at ${row[9]} g each`; }
    else {
      const per = Number(p.ml_per_unit) > 0 ? Number(p.ml_per_unit) : ML[unit];
      if (!per) return fail(400, 'unknown_portion_unit', `Cannot size portion unit "${p.unit}". Give ml_per_unit.`);
      grams = count * per; basis = `${count} × ${per} ml, taken as 1 g per ml`;
    }
    const n = N(row, grams);
    return ok({ dish: a.dish, matched: key, portion: { unit: p.unit || 'katori', count, grams: Math.round(grams), basis }, nutrients: { ...n, glycaemic_index: row[7], glycaemic_load: +((row[7] * n.carbs_g) / 100).toFixed(1) }, allergens: row[8], confidence: 0.7, ...base });
  }
  if (Array.isArray(a.ingredients) && a.ingredients.length) {
    const tot = [0, 0, 0, 0, 0, 0, 0], allergens = new Set(), unknown = [], used = [];
    let gl = 0, mass = 0;
    for (const i of a.ingredients) {
      let k = norm(i.name || i.ingredient || i.item); k = ALIAS[k] || k;
      const row = resolve(ING, k) || resolve(ING, Object.keys(ING).find((x) => k.includes(x)) || '');
      const g = toG(Number(i.qty ?? i.quantity ?? i.grams ?? 0), i.unit || (i.grams !== undefined ? 'g' : ''));
      if (!row || !g) { unknown.push({ ingredient: i, reason: !row ? 'not_in_table' : 'quantity_or_unit_not_understood' }); continue; }
      for (let j = 0; j < 7; j++) tot[j] += row[j] * g / 100;
      gl += row[7] * (row[1] * g / 100) / 100; mass += g; row[8].forEach((x) => allergens.add(x)); used.push({ name: k, grams: Math.round(g) });
    }
    if (!used.length) return fail(404, 'ingredients_not_found', 'None of the ingredients could be matched', { unknown });
    // "ingredients" is the whole recipe; "portion" is what one eater gets. servings (if given) divides the pot.
    const servings = Number(a.servings ?? p.servings ?? 0);
    const share = servings > 0 ? count / servings : 1;
    const n = N(tot.map((x) => x * 100), share);
    return ok({ dish: null, portion: { unit: p.unit || null, count, share_of_recipe: +share.toFixed(3), basis: servings > 0 ? `${count} of ${servings} servings of the recipe` : 'whole ingredient list (give servings to get one eater\'s share)' }, ingredients_used: used, unknown_ingredients: unknown, nutrients: { ...n, glycaemic_load: +(gl * share).toFixed(1) }, allergens: [...allergens], confidence: unknown.length ? 0.4 : 0.6, ...base });
  }
  return fail(400, 'missing_dish_or_ingredients', 'Give dish or ingredients');
}

module.exports = { groceryQuote, policyEvaluate, nutrition, STORES };
