'use strict';
// Small key-value store. Uses Upstash / Vercel KV over REST when configured
// (KV_REST_API_URL + KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN).
// Otherwise falls back to in-memory, which survives only while the function instance stays warm.
const mem = globalThis.__rasoiStore || (globalThis.__rasoiStore = new Map());
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const durable = Boolean(URL_ && TOK);

async function cmd(arr) {
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: `Bearer ${TOK}`, 'content-type': 'application/json' }, body: JSON.stringify(arr) });
  const j = await r.json();
  if (j.error) throw new Error(`kv: ${j.error}`);
  return j.result;
}
async function get(key) {
  if (durable) { const v = await cmd(['GET', `rasoi:${key}`]); return v == null ? null : JSON.parse(v); }
  const e = mem.get(key);
  if (!e) return null;
  if (e.exp && e.exp < Date.now()) { mem.delete(key); return null; }
  return e.v;
}
async function set(key, value, ttlSec = 7 * 86400) {
  if (durable) { await cmd(['SET', `rasoi:${key}`, JSON.stringify(value), 'EX', String(ttlSec)]); return; }
  mem.set(key, { v: value, exp: Date.now() + ttlSec * 1000 });
}
module.exports = { get, set, durable };
