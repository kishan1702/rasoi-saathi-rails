// Rasoi Saathi MCP server: Delhivery mock, Rasoi capabilities (mock), Gnani STT/TTS wrapper (real calls).
const TOOLS = [{"name": "gnani_stt_transcribe", "description": "Transcribe a recorded voice note to text. Use for every incoming voice note. Returns the transcript; treat short, garbled or empty transcripts as low confidence and read back critical entities before acting. [POST /stt/v3]", "inputSchema": {"type": "object", "properties": {"audio_file_id": {"type": "string", "description": "File reference from tg_get_file"}, "language_code": {"type": "string", "enum": ["hi-IN", "en-IN", "bn-IN", "gu-IN", "kn-IN", "ml-IN", "mr-IN", "pa-IN", "ta-IN", "te-IN", "en-hi-IN-latn"], "description": "Sender's language from members.language_code"}}, "required": ["audio_file_id", "language_code"]}}, {"name": "gnani_tts_synthesize", "description": "Turn a short reply (under 40 words) into speech in the member's language. Use for every spoken reply, then send with tg_send_voice. [POST /api/v1/tts/inference]", "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}, "language_code": {"type": "string"}, "voice": {"type": "string", "description": "Gnani voice name, e.g. simran"}}, "required": ["text", "language_code"]}}, {"name": "dlv_pincode_serviceability", "description": "Check if a pincode is serviceable. Empty delivery_codes means not serviceable. [GET /c/api/pin-codes/json/?filter_codes={pin}]", "inputSchema": {"type": "object", "properties": {"filter_codes": {"type": "string"}}, "required": ["filter_codes"]}}, {"name": "dlv_shipping_charges", "description": "Delivery cost for a store-to-home lane. Include in final delivered cost. [GET /api/kinko/v1/invoice/charges/.json]", "inputSchema": {"type": "object", "properties": {"md": {"type": "string", "enum": ["S", "E"]}, "ss": {"type": "string", "enum": ["Delivered"]}, "o_pin": {"type": "string"}, "d_pin": {"type": "string"}, "cgm": {"type": "integer", "description": "weight in grams"}, "pt": {"type": "string", "enum": ["Pre-paid", "COD"]}}, "required": ["md", "ss", "o_pin", "d_pin", "cgm", "pt"]}}, {"name": "dlv_create_shipment", "description": "Create a shipment from the store to the home after payment. Check orders for an existing AWB first. [POST /api/cmu/create.json]", "inputSchema": {"type": "object", "properties": {"format": {"type": "string", "enum": ["json"]}, "data": {"type": "object", "properties": {"shipments": {"type": "array", "items": {"type": "object", "properties": {"name": {"type": "string"}, "add": {"type": "string"}, "pin": {"type": "string"}, "phone": {"type": "string"}, "order": {"type": "string"}, "payment_mode": {"type": "string"}, "products_desc": {"type": "string"}, "total_amount": {"type": "number"}, "weight": {"type": "number"}}, "required": ["name", "add", "pin", "order", "payment_mode"]}}, "pickup_location": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}}, "required": ["shipments", "pickup_location"]}}, "required": ["format", "data"]}}, {"name": "dlv_pickup_request", "description": "Book a pickup at the store. An error means no capacity (no rider); never report it as booked. [POST /fm/request/new/]", "inputSchema": {"type": "object", "properties": {"pickup_location": {"type": "string"}, "pickup_date": {"type": "string"}, "pickup_time": {"type": "string"}, "expected_package_count": {"type": "integer"}}, "required": ["pickup_location", "pickup_date", "pickup_time", "expected_package_count"]}}, {"name": "dlv_track_shipment", "description": "Track by AWB. Read Status.Status and ExpectedDeliveryDate. [GET /api/v1/packages/json/?waybill={awb}]", "inputSchema": {"type": "object", "properties": {"waybill": {"type": "string"}}, "required": ["waybill"]}}, {"name": "dlv_cancel_shipment", "description": "Cancel a shipment when the order was cancelled or refunded. [POST /api/p/edit]", "inputSchema": {"type": "object", "properties": {"waybill": {"type": "string"}, "cancellation": {"type": "string", "enum": ["true"]}}, "required": ["waybill", "cancellation"]}}, {"name": "rasoi_grocery_quote", "description": "Capability 1 of 3. For each store, which requested items are in stock now, price, pack size, approved substitutes and next delivery slot. in_stock false means not available; never assume stock. [POST /rasoi/v1/grocery/quote]", "inputSchema": {"type": "object", "properties": {"home_pin": {"type": "string"}, "store_ids": {"type": "array", "items": {"type": "string"}}, "items": {"type": "array", "items": {"type": "object", "properties": {"name": {"type": "string"}, "qty": {"type": "number"}, "unit": {"type": "string"}}, "required": ["name", "qty", "unit"]}}}, "required": ["home_pin", "store_ids", "items"]}}, {"name": "rasoi_policy_evaluate", "description": "Capability 2 of 3. Deterministic household policy engine. Returns AUTO or ESCALATE with reasons, and a diff against any previously approved cart. The only authority on whether you may pay without asking. [POST /rasoi/v1/policy/evaluate]", "inputSchema": {"type": "object", "properties": {"mandate": {"type": "object", "description": "Row from the mandate tab"}, "cart": {"type": "object", "properties": {"merchant": {"type": "string"}, "items": {"type": "array"}, "substitutions": {"type": "array"}, "total_paise": {"type": "integer"}, "delivery_slot": {"type": "string"}}, "required": ["merchant", "items", "total_paise"]}, "approved_cart": {"type": "object", "description": "Previously approved cart, if any"}, "health_flags": {"type": "array", "items": {"type": "string"}}}, "required": ["mandate", "cart"]}}, {"name": "rasoi_food_nutrition", "description": "Capability 3 of 3 (stand-in for the HealthifyMe food-state rail). Nutrients and allergens for a dish or ingredient list per household-unit portion. 404 dish_not_found means decompose into ingredients or mark low confidence. [POST /rasoi/v1/foodstate/nutrition]", "inputSchema": {"type": "object", "properties": {"dish": {"type": "string"}, "ingredients": {"type": "array", "items": {"type": "object"}}, "portion": {"type": "object", "properties": {"unit": {"type": "string"}, "count": {"type": "number"}, "ml_per_unit": {"type": "number"}}}}, "required": ["portion"]}}];
const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const SERVICEABLE = new Set(['560001','560034','560095','400001','400051','110001','110016','700001','600001','500001','411001','122001','201301']);
const shipments = globalThis.__shipments || (globalThis.__shipments = {});
const CATALOG = {
  atta: { price: 62, pack: '1 kg', subs: ['multigrain atta'] }, rice: { price: 95, pack: '1 kg', subs: ['brown rice'] },
  dal: { price: 130, pack: '1 kg', subs: ['moong dal'] }, 'toor dal': { price: 148, pack: '1 kg', subs: [] },
  milk: { price: 33, pack: '500 ml', subs: ['toned milk'] }, curd: { price: 40, pack: '400 g', subs: [] },
  paneer: { price: 95, pack: '200 g', subs: ['tofu'] }, onion: { price: 42, pack: '1 kg', subs: [] },
  tomato: { price: 38, pack: '1 kg', subs: [] }, potato: { price: 30, pack: '1 kg', subs: [] },
  oil: { price: 165, pack: '1 L', subs: ['mustard oil'] }, sugar: { price: 48, pack: '1 kg', subs: ['jaggery'] },
  peanuts: { price: 110, pack: '500 g', subs: [] }, 'gulab jamun': { price: 180, pack: '500 g', subs: [] }, eggs: { price: 84, pack: '12', subs: [] },
};
const NUTRI = {
  roti: { kcal: 104, carb_g: 18, protein_g: 3, fat_g: 3, sugar_g: 0.5, allergens: ['gluten'], per: 'piece 40g' },
  dal: { kcal: 120, carb_g: 18, protein_g: 7, fat_g: 2, sugar_g: 1, allergens: [], per: 'katori 150ml' },
  rice: { kcal: 130, carb_g: 28, protein_g: 2.5, fat_g: 0.3, sugar_g: 0, allergens: [], per: 'katori 150ml' },
  'aloo gobi': { kcal: 140, carb_g: 16, protein_g: 3, fat_g: 7, sugar_g: 2, allergens: [], per: 'katori 150ml' },
  poha: { kcal: 180, carb_g: 30, protein_g: 4, fat_g: 5, sugar_g: 2, allergens: ['peanut'], per: 'katori 150ml' },
  'gulab jamun': { kcal: 150, carb_g: 25, protein_g: 2, fat_g: 5, sugar_g: 18, allergens: ['milk','gluten'], per: 'piece 40g' },
  'chicken curry': { kcal: 210, carb_g: 6, protein_g: 20, fat_g: 12, sugar_g: 2, allergens: [], per: 'katori 150ml' },
};
const ok = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }] });
const err = (o) => ({ isError: true, content: [{ type: 'text', text: JSON.stringify(o) }] });

async function gnani(tool, a) {
  const key = process.env.GNANI_API_KEY;
  if (!key) return err({ error: 'gnani_key_not_configured' });
  const headers = { 'X-API-Key-ID': key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  try {
    if (tool === 'gnani_tts_synthesize') {
      const r = await fetch('https://api.vachana.ai/api/v1/tts/inference', { method: 'POST', headers,
        body: JSON.stringify({ text: a.text, model: 'timbre-v2.5', language: a.language_code, voice: a.voice || 'Nalini', speed: 1.0, audio_config: { sample_rate: 24000, num_channels: 1, sample_width: 2, encoding: 'linear_pcm', container: 'wav' } }) });
      const ct = r.headers.get('content-type') || '';
      if (ct.includes('json')) return r.ok ? ok(await r.json()) : err({ status: r.status, body: await r.json().catch(() => null) });
      const buf = Buffer.from(await r.arrayBuffer());
      return r.ok ? ok({ content_type: ct, audio_base64: buf.toString('base64') }) : err({ status: r.status });
    }
    let audio;
    if (/^https?:\/\//.test(a.audio_file_id)) { const f = await fetch(a.audio_file_id); audio = Buffer.from(await f.arrayBuffer()); }
    else if (a.audio_base64) audio = Buffer.from(a.audio_base64, 'base64');
    else return err({ error: 'audio_file_id must be a fetchable https URL (from tg_get_file) or pass audio_base64' });
    const fd = new FormData();
    fd.append('audio_file', new Blob([audio]), 'voice.ogg');
    fd.append('language_code', a.language_code);
    fd.append('format', 'transcribe');
    const h2 = { 'X-API-Key-ID': key, Authorization: 'Bearer ' + key };
    const r = await fetch('https://api.vachana.ai/stt/v3', { method: 'POST', headers: h2, body: fd });
    const body = await r.json().catch(() => null);
    return r.ok ? ok(body) : err({ status: r.status, body });
  } catch (e) { return err({ error: String(e) }); }
}

function call(name, a) {
  switch (name) {
    case 'dlv_pincode_serviceability': {
      const p = String(a.filter_codes);
      return ok(SERVICEABLE.has(p) ? { delivery_codes: [{ postal_code: { pin: Number(p), pre_paid: 'Y', cash: 'Y', repl: 'N', cod: 'Y', is_oda: 'N', district: 'Mock District', state_code: 'KA' } }] } : { delivery_codes: [] });
    }
    case 'dlv_shipping_charges': {
      if (!SERVICEABLE.has(String(a.d_pin))) return err({ error: 'destination_not_serviceable' });
      const w = Math.max(500, a.cgm || 500); const base = (a.md === 'E' ? 55 : 38) + Math.ceil((w - 500) / 500) * 12;
      const cod = a.pt === 'COD' ? 25 : 0;
      return ok([{ charge_DL: base, charge_COD: cod, total_amount: base + cod, zone: a.o_pin === a.d_pin ? 'A' : 'B', status: a.ss }]);
    }
    case 'dlv_create_shipment': {
      const out = [];
      for (const s of (a.data && a.data.shipments) || []) {
        const dup = Object.values(shipments).find((x) => x.order === s.order);
        const awb = dup ? dup.waybill : '3' + String(10000000000 + (hash(s.order) % 89999999999));
        shipments[awb] = { waybill: awb, order: s.order, pin: s.pin, status: 'Manifested', created: Date.now(), cancelled: false };
        out.push({ waybill: awb, order: s.order, status: 'Success', remarks: dup ? 'Existing shipment returned' : '' });
      }
      return ok({ success: true, packages: out, package_count: out.length, upload_wbn: 'UPL' + Date.now() });
    }
    case 'dlv_pickup_request': {
      if (/^(0[0-6]|2[2-3])/.test(String(a.pickup_time))) return err({ success: false, error: 'No rider capacity for requested slot' });
      return ok({ success: true, pickup_id: 'PU' + (hash(a.pickup_location + a.pickup_date + a.pickup_time) % 1000000), pickup_location: a.pickup_location, pickup_date: a.pickup_date, expected_package_count: a.expected_package_count });
    }
    case 'dlv_track_shipment': {
      const s = shipments[a.waybill];
      if (!s) return ok({ ShipmentData: [], Error: 'Waybill not found' });
      const age = (Date.now() - s.created) / 60000;
      const st = s.cancelled ? 'Cancelled' : age < 5 ? 'Manifested' : age < 20 ? 'In Transit' : age < 40 ? 'Out for Delivery' : 'Delivered';
      return ok({ ShipmentData: [{ Shipment: { AWB: s.waybill, ReferenceNo: s.order, Status: { Status: st, StatusDateTime: new Date().toISOString(), StatusType: st === 'Delivered' ? 'DL' : 'UD' }, ExpectedDeliveryDate: new Date(s.created + 4 * 3600e3).toISOString() } }] });
    }
    case 'dlv_cancel_shipment': {
      const s = shipments[a.waybill];
      if (!s) return err({ status: false, error: 'Waybill not found' });
      s.cancelled = true; return ok({ status: true, waybill: a.waybill, remark: 'Cancellation requested' });
    }
    case 'rasoi_grocery_quote': {
      const stores = (a.store_ids || []).map((sid) => ({
        store_id: sid, next_delivery_slot: '18:00-20:00 today',
        items: (a.items || []).map((it) => {
          const key = String(it.name).toLowerCase(); const c = CATALOG[key];
          const inStock = !!c && (hash(sid + key) % 7 !== 0);
          return inStock ? { name: it.name, in_stock: true, qty: it.qty, unit: it.unit, unit_price_paise: Math.round(c.price * 100 * (1 + (hash(sid) % 5) / 100)), pack_size: c.pack, substitutes: c.subs }
                         : { name: it.name, in_stock: false, substitutes: c ? c.subs : [] };
        }) }));
      return ok({ home_pin: a.home_pin, quoted_at: new Date().toISOString(), stores });
    }
    case 'rasoi_policy_evaluate': {
      const m = a.mandate || {}, c = a.cart || {}, reasons = [];
      const cap = m.per_order_cap_paise ?? m.cap_paise ?? 50000;
      if (c.total_paise > cap) reasons.push('total_exceeds_per_order_cap');
      if (m.allowed_merchants && !m.allowed_merchants.includes(c.merchant)) reasons.push('merchant_not_in_mandate');
      if ((c.substitutions || []).length > 0) reasons.push('substitutions_present');
      if ((a.health_flags || []).length > 0) reasons.push('health_flag_present');
      let diff = null;
      if (a.approved_cart) { diff = { total_delta_paise: c.total_paise - (a.approved_cart.total_paise || 0), items_changed: JSON.stringify(c.items) !== JSON.stringify(a.approved_cart.items) };
        if (diff.total_delta_paise > 0 || diff.items_changed) reasons.push('cart_differs_from_approved'); }
      else reasons.push('no_prior_approval');
      return ok({ decision: reasons.length ? 'ESCALATE' : 'AUTO', reasons, diff });
    }
    case 'rasoi_food_nutrition': {
      const p = a.portion || {}; const n = p.count || 1;
      const k = a.dish && String(a.dish).toLowerCase(); const row = k && NUTRI[k];
      if (!row) return { status: 404, body: { error: 'dish_not_found' } };
      const sc = (v) => Math.round(v * n * 10) / 10;
      return ok({ dish: a.dish, portion: p, basis: row.per, kcal: sc(row.kcal), carb_g: sc(row.carb_g), protein_g: sc(row.protein_g), fat_g: sc(row.fat_g), sugar_g: sc(row.sugar_g), allergens: row.allergens, confidence: 'mock_table' });
    }
  }
  return err({ error: 'unknown_tool ' + name });
}

async function rpc(m) {
  const { id, method, params } = m;
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  if (method === 'initialize') return reply({ protocolVersion: (params && params.protocolVersion) || '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'rasoi-saathi-rails', version: '1.0.0' } });
  if (method === 'ping') return reply({});
  if (method === 'tools/list') return reply({ tools: TOOLS });
  if (method === 'tools/call') {
    const n = params.name, a = params.arguments || {};
    if (!TOOLS.find((t) => t.name === n)) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool' } };
    let r = n.startsWith('gnani_') ? await gnani(n, a) : call(n, a);
    if (r.status === 404) r = err(r.body);
    return reply(r);
  }
  if (id === undefined) return null;
  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const url = (req.url || '').split('?')[0];
  if (req.method === 'GET' && url === '/health') return res.status(200).json({ ok: true, tools: TOOLS.map((t) => t.name) });
  if (req.method === 'GET') return res.status(200).json({ name: 'rasoi-saathi-rails', mcp: 'POST /mcp (JSON-RPC)', tools: TOOLS.length });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body) return res.status(400).json({ error: 'bad body' });
  if (Array.isArray(body)) { const out = (await Promise.all(body.map(rpc))).filter(Boolean); return res.status(200).json(out); }
  const out = await rpc(body);
  if (!out) return res.status(202).end();
  return res.status(200).json(out);
};
