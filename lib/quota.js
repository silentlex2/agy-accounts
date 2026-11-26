const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadLocalConfig } = require('./local-config');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const BASES = [
  'https://daily-cloudcode-pa.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
];

function getProxy() {
  const cfg = loadLocalConfig();
  return process.env.AGY_PROXY || cfg.proxy || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
}

function getOAuthClient() {
  const cfg = loadLocalConfig();
  return {
    clientId: process.env.AGY_OAUTH_CLIENT_ID || cfg.oauthClientId || '',
    clientSecret: process.env.AGY_OAUTH_CLIENT_SECRET || cfg.oauthClientSecret || '',
  };
}

function post(url, headers, body, contentType) {
  const tmp = path.join(os.tmpdir(), 'agy-body-' + process.pid + '.json');
  fs.writeFileSync(tmp, body || '{}', 'utf8');
  const args = ['-s', '--max-time', '30'];
  const proxy = getProxy();
  if (proxy) args.push('-x', proxy);
  args.push('-H', 'Content-Type: ' + (contentType || 'application/json'), '-H', 'User-Agent: antigravity');
  for (const h of headers) args.push('-H', h);
  args.push('--data-binary', '@' + tmp, url);
  try {
    const out = execFileSync('curl.exe', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    return { status: 0, body: out, json: safeJson(out) };
  } catch (e) {
    return { status: -1, body: String(e.stdout || e.message), json: null };
  } finally { try { fs.unlinkSync(tmp); } catch (e) {} }
}
function safeJson(t) { try { return JSON.parse(t); } catch (e) { return null; } }

function needsRefresh(token) {
  const exp = token && token.expiry ? Date.parse(String(token.expiry).replace(/([+-]\d{2}):(\d{2})$/, '$1:$2')) : 0;
  if (!exp) return true;
  return exp - Date.now() < 120000;
}

function refresh(token) {
  if (!token || !token.refresh_token) throw new Error('no refresh_token in this account');
  const oauth = getOAuthClient();
  if (!oauth.clientId || !oauth.clientSecret) {
    throw new Error('token expired; set oauthClientId/oauthClientSecret in local.config.json (or AGY_OAUTH_CLIENT_ID/SECRET)');
  }
  const body = new URLSearchParams({
    client_id: oauth.clientId, client_secret: oauth.clientSecret,
    refresh_token: token.refresh_token, grant_type: 'refresh_token',
  }).toString();
  const r = post(TOKEN_URL, [], body, 'application/x-www-form-urlencoded');
  const j = r.json;
  if (!j || j.error) {
    let why = (r.body || '').slice(0, 200);
    if (j && j.error_description) why = j.error_description;
    else if (j && j.error) why = typeof j.error === 'string' ? j.error : JSON.stringify(j.error);
    throw new Error('refresh failed: ' + why);
  }
  const expiry = new Date(Date.now() + (j.expires_in || 3599) * 1000).toISOString();
  return Object.assign({}, token, { access_token: j.access_token, expires_in: j.expires_in || 3599, expiry });
}

function ensureToken(token) { return needsRefresh(token) ? refresh(token) : token; }

function fetchModelQuota(token) {
  const hdr = ['Authorization: Bearer ' + token.access_token];
  let last = null;
  for (const base of BASES) {
    const q = post(base + '/v1internal:retrieveUserQuota', hdr, '{}');
    if (q.json && !q.json.error && Array.isArray(q.json.buckets)) return { ok: true, base, buckets: q.json.buckets };
    last = q;
  }
  return { ok: false, error: (last && (last.body || '').slice(0, 300)) || 'unknown' };
}

function fetchQuota(token) {
  const at = token.access_token;
  const hdr = ['Authorization: Bearer ' + at];
  let last = null;
  for (const base of BASES) {
    const q = post(base + '/v1internal:retrieveUserQuotaSummary', hdr, '{}');
    if (q.json && !q.json.error) {
      const tiers = post(base + '/v1internal:loadCodeAssist', hdr, '{}');
      const mq = fetchModelQuota(token);
      return {
        ok: true,
        base: base,
        quota: q.json,
        tier: (tiers.json && (tiers.json.currentTier || (tiers.json.allowedTiers || [])[0])) || null,
        raw: tiers.json,
        models: mq.ok ? mq.buckets : [],
        modelsError: mq.ok ? null : mq.error,
      };
    }
    last = q;
  }
  return { ok: false, error: (last && (last.body || '').slice(0, 300)) || 'unknown' };
}

function summarize(quota) {
  const buckets = [];
  for (const g of (quota && quota.groups) || []) {
    for (const b of g.buckets || []) {
      buckets.push({ group: g.displayName, window: b.window, remaining: b.remainingFraction, reset: b.resetTime, id: b.bucketId });
    }
  }
  return buckets;
}

function windowOf(resetIso) {
  if (!resetIso) return '-';
  const h = (Date.parse(resetIso) - Date.now()) / 3600000;
  if (!isFinite(h)) return '-';
  if (h <= 12) return '5h';
  if (h <= 24 * 8) return 'weekly';
  return '-';
}

// retrieveUserQuota is the only endpoint that reports per-model Gemini quota;
// retrieveUserQuotaSummary covers the third-party group (Claude / GPT) only.
function geminiBuckets(buckets) {
  const g = (buckets || []).filter(function (b) { return /^gemini/i.test(String(b.modelId || '')); });
  if (!g.length) return [];
  const frac = g.reduce(function (m, b) {
    const v = (b.remainingFraction === undefined || b.remainingFraction === null) ? 1 : Number(b.remainingFraction);
    return v < m ? v : m;
  }, 1);
  const resets = g.map(function (b) { return b.resetTime; }).filter(Boolean).sort();
  const reset = resets.length ? resets[0] : null;
  return [{
    group: 'Gemini 系模型',
    window: windowOf(reset),
    remaining: frac,
    reset: reset,
    id: 'gemini-models',
    models: g.map(function (b) { return b.modelId; }),
  }];
}

function summarizeAll(res) {
  return geminiBuckets(res && res.models).concat(summarize(res && res.quota));
}

module.exports = { ensureToken, refresh, needsRefresh, fetchQuota, fetchModelQuota, summarize, summarizeAll, geminiBuckets, getProxy, post };
