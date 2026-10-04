'use strict';
const crypto = require('crypto');

const b64u = {
  enc: (s) => Buffer.from(s, 'utf8').toString('base64url'),
  dec: (s) => Buffer.from(s, 'base64url').toString('utf8'),
};
const hashInt = (s) => parseInt(crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 8), 16);
const rid = (n = 8) => crypto.randomBytes(n).toString('hex');
const ok = (body) => ({ status: 200, body });
const fail = (status, code, message, extra) => ({ status, body: { success: false, error: { code, message }, ...(extra || {}) } });
const notConfigured = (connector, vars) =>
  fail(503, 'connector_not_configured', `${connector} is not configured on this server. Set ${vars.join(', ')} in the Vercel project's environment variables and redeploy.`);

// fetch with a timeout; returns {status, json?, text, headers, buffer?}
async function http(url, opts = {}, { timeoutMs = 25000, binary = false } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    if (binary) return { status: r.status, headers: r.headers, buffer: Buffer.from(await r.arrayBuffer()) };
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch (_) { /* not json */ }
    return { status: r.status, headers: r.headers, text, json };
  } finally { clearTimeout(t); }
}
const istNow = () => new Date(Date.now() + 5.5 * 3600 * 1000);
const iso = (ms) => new Date(ms).toISOString();

module.exports = { b64u, hashInt, rid, ok, fail, notConfigured, http, istNow, iso };
