'use strict';
// Read-only household data from a Google Sheet that is shared "anyone with the link can view".
// No credentials needed. Set HOUSEHOLD_SHEET_ID in Vercel to point at another sheet.
const { ok, fail, http } = require('./util');
const DEFAULT_ID = '1z9EIswo2reH2ekg6gbX5C2hLTzrESN9ZHJYOa0Jzicg';
const sheetId = () => (process.env.HOUSEHOLD_SHEET_ID || DEFAULT_ID).trim();

function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
async function tab(name) {
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId())}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;
  const r = await http(url, {}, { timeoutMs: 15000 });
  if (r.status !== 200) throw Object.assign(new Error(`sheet_${r.status}`), { res: fail(502, 'household_sheet_unreachable', `Could not read tab "${name}" (HTTP ${r.status}). The sheet must be shared as anyone-with-the-link viewer.`) });
  const rows = parseCsv(r.text).filter((x) => x.some((c) => c !== ''));
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((x) => Object.fromEntries(head.map((h, i) => [h, x[i] === undefined ? '' : x[i]])));
}
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
async function guard(fn) { try { return await fn(); } catch (e) { return (e && e.res) || fail(502, 'household_sheet_error', String((e && e.message) || e)); } }

const inventoryCheck = (a) => guard(async () => {
  const rows = await tab('inventory');
  const q = norm(a.item);
  const hit = q ? rows.filter((r) => { const n = norm(r.item); return n.includes(q) || q.includes(n.split(' (')[0]); }) : rows;
  const items = hit.map((r) => { const qty = num(r.qty), res = num(r.reserved_qty) || 0; const avail = qty === null ? null : Math.max(0, qty - res);
    return { item: r.item, qty, unit: r.unit, reserved_qty: res, available: avail, in_stock: avail !== null && avail > 0, source: r.source, confidence: num(r.confidence), updated_at: r.updated_at, low_confidence: (num(r.confidence) || 0) < 0.7 }; });
  return ok({ query: a.item || null, found: items.length, items, note: 'Quantities come from the household sheet, not from the stores. Low-confidence rows must be confirmed with a person before they change what is cooked or bought.' });
});
const recipesList = (a) => guard(async () => {
  const [recipes, inv] = await Promise.all([tab('recipes'), tab('inventory')]);
  const stock = inv.map((r) => ({ full: norm(r.item), n: norm(r.item).split(' ')[0], ok: (num(r.qty) || 0) - (num(r.reserved_qty) || 0) > 0 }));
  const have = (name) => stock.some((s) => s.ok && (s.full.includes(name) || s.n === name || name.startsWith(s.n) || s.n.startsWith(name)));
  const out = recipes.map((r) => {
    const ing = String(r.ingredients || '').split(';').map((x) => x.trim()).filter(Boolean).map((x) => norm(x.replace(/[0-9.]+\s*(kg|g|ml|l|pc)?/gi, '')));
    const missing = ing.filter((n) => n && !have(n.split(' ')[0]));
    return { dish: r.dish, ingredients: r.ingredients, servings: num(r.servings), time_min: num(r.time_min), health_tags: r.health_tags, notes: r.notes, can_cook_from_stock: missing.length === 0, missing_ingredients: missing };
  });
  const filter = norm(a.health_filter);
  const list = filter ? out.filter((r) => norm(r.health_tags).includes(filter)) : out;
  return ok({ count: list.length, recipes: list.sort((x, y) => Number(y.can_cook_from_stock) - Number(x.can_cook_from_stock)), note: 'Ingredient match is by name only, not by quantity. Check the nutrition tool and each member health rule before suggesting a dish.' });
});
const membersList = () => guard(async () => ok({ members: await tab('members') }));
module.exports = { inventoryCheck, recipesList, membersList };
