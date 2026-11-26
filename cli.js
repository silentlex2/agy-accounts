#!/usr/bin/env node
'use strict';
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const cred = require('./lib/cred');
const pool = require('./lib/pool');
const quota = require('./lib/quota');
const { loadLocalConfig } = require('./lib/local-config');

function getUsage() { return require('./lib/usage'); }

function resolveLauncher() {
  const cfg = loadLocalConfig();
  const candidates = [
    process.env.AGY_LAUNCHER || '',
    cfg.launcher || '',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'antigravity', 'Antigravity.exe'),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return candidates[2];
}

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
function fmtPct(f) {
  if (f === null || f === undefined) return '  ?  ';
  return String(Math.round(Number(f) * 100)).padStart(3) + '% ';
}
function fmtReset(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  const h = Math.round((d.getTime() - Date.now()) / 3600000);
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  return stamp + (h >= 0 ? ' (in ' + (h >= 24 ? Math.round(h / 24) + 'd' : h + 'h') + ')' : ' (passed)');
}

function cmdCurrent() {
  const c = cred.read();
  const exp = c.token && c.token.expiry ? new Date(c.token.expiry) : null;
  const left = exp ? Math.round((exp.getTime() - Date.now()) / 60000) : null;
  console.log('active account : ' + (c.email || '(no email in blob)'));
  console.log('auth method    : ' + (c.authMethod || '-'));
  console.log('access token   : ' + (c.token && c.token.access_token ? 'present' : 'missing') +
    (left === null ? '' : '  expires in ' + left + ' min'));
  const st = pool.load();
  console.log('in pool        : ' + (c.email && st.accounts[c.email] ? 'yes' : 'no (run: add)'));
}

function cmdList() {
  const st = pool.load();
  const cur = (function () { try { return cred.read().email; } catch (e) { return null; } })();
  if (!st.order.length) { console.log('pool is empty. run: add'); return; }
  console.log('  #  account                        label            added');
  st.order.forEach((email, i) => {
    const a = st.accounts[email];
    const mark = email === cur ? '*' : ' ';
    console.log(mark + ' ' + String(i + 1).padStart(2) + '  ' + email.padEnd(30) + '  ' + String(a.label || '').padEnd(15) + '  ' + (a.addedAt || '').slice(0, 10));
  });
  console.log('\n* = currently active in Antigravity');
}

function cmdAdd() {
  const c = cred.read();
  if (!c.email) throw new Error('blob has no id_token_email');
  const st = pool.load();
  const label = arg('label', '');
  pool.upsert(st, { email: c.email, label: label === true ? '' : label, blob: c.raw, addedAt: new Date().toISOString() });
  st.current = c.email;
  pool.save(st);
  console.log('saved account: ' + c.email + (label && label !== true ? ' (' + label + ')' : '') + '  -> ' + pool.FILE);
}

function resolveAccount(st, key) {
  if (!key || key === true) throw new Error('usage: use <email | #number>');
  let email = key;
  if (/^#?\d+$/.test(String(key))) {
    const idx = Number(String(key).replace('#', '')) - 1;
    email = st.order[idx];
  }
  if (!email || !st.accounts[email]) throw new Error('unknown account: ' + key + '  (run: list)');
  return email;
}

function isExeRunning(exeName) {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq ' + exeName, '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return out.toLowerCase().includes(exeName.toLowerCase());
  } catch (e) {
    return false;
  }
}

function launchAppSilently() {
  const cfg = loadLocalConfig();
  const exePath = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'antigravity', 'Antigravity.exe');
  const ensureCore = process.env.AGY_ENSURE_CORE || cfg.ensureCoreScript || '';
  const ctxAgent = process.env.AGY_CTX_AGENT || cfg.ctxAgentScript || '';
  const proxy = quota.getProxy();

  if (ensureCore && fs.existsSync(ensureCore)) {
    try { execFileSync(process.execPath, [ensureCore], { stdio: 'ignore', windowsHide: true, timeout: 8000 }); } catch (e) {}
  }

  if (ctxAgent && fs.existsSync(ctxAgent)) {
    try {
      const pChild = spawn(process.execPath, [ctxAgent], { detached: true, stdio: 'ignore', windowsHide: true });
      pChild.unref();
    } catch (e) {}
  }

  const customLauncher = process.env.AGY_LAUNCHER || cfg.launcher || '';
  const launchTarget = fs.existsSync(exePath) ? exePath : (customLauncher && fs.existsSync(customLauncher) ? customLauncher : resolveLauncher());
  const launchEnv = Object.assign({}, process.env);
  if (proxy) {
    Object.assign(launchEnv, {
      PROXY: proxy,
      HTTP_PROXY: proxy,
      HTTPS_PROXY: proxy,
      ALL_PROXY: proxy,
      http_proxy: proxy,
      https_proxy: proxy,
      all_proxy: proxy,
      NO_PROXY: 'localhost,127.0.0.1,::1',
      no_proxy: 'localhost,127.0.0.1,::1',
    });
  }
  const exeArgs = [];
  if (proxy) exeArgs.push('--proxy-server=' + proxy);
  if (ctxAgent) exeArgs.push('--remote-debugging-port=9333');
  // 注意：GUI 可执行文件 Antigravity.exe 不可设 windowsHide:true，否则主窗口可能被 SW_HIDE 隐藏
  const child = /\.(cmd|bat)$/i.test(launchTarget)
    ? spawn('cmd.exe', ['/c', launchTarget], { detached: true, stdio: 'ignore', windowsHide: true, env: launchEnv })
    : spawn(launchTarget, exeArgs, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        env: launchEnv,
      });
  child.unref();
}

function restartApp(fastMode) {
  const logFile = path.join(__dirname, 'restart.log');
  const logStep = (m) => {
    try { fs.appendFileSync(logFile, new Date().toISOString() + ' ' + m + '\n', 'utf8'); } catch (e) {}
  };
  try { fs.writeFileSync(logFile, '', 'utf8'); } catch (e) {}
  logStep('restarting Antigravity silently (pid=' + process.pid + ')');

  // 严禁加 /T：切号脚本本身是 Antigravity 派生的子进程，/T 会把自己一并杀掉导致无法拉起新窗口
  try { execFileSync('taskkill', ['/IM', 'Antigravity.exe', '/F'], { stdio: 'ignore', windowsHide: true }); } catch (e) {}
  try { execFileSync('taskkill', ['/IM', 'language_server.exe', '/F'], { stdio: 'ignore', windowsHide: true }); } catch (e) {}
  logStep('taskkill issued');

  // 使用快速 tasklist + 内存 sleep，避免频繁拉起 powershell 弹窗与耗时
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    if (!isExeRunning('Antigravity.exe')) break;
    sleep(200);
  }
  logStep('process exited after ' + (Date.now() - t0) + 'ms');

  launchAppSilently();
  logStep('launchAppSilently called');

  if (fastMode) return true;

  for (let i = 0; i < 60; i++) {
    sleep(500);
    if (isExeRunning('language_server.exe')) {
      console.log('client is back (language_server up after ' + ((i + 1) * 0.5) + 's)');
      return true;
    }
  }
  console.log('WARNING: client did not come back within 30s');
  return false;
}
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, ms | 0));
}

function cmdUse(key) {
  const st = pool.load();
  const email = resolveAccount(st, key);
  const target = st.accounts[email];
  const cur = (function () { try { return cred.read(); } catch (e) { return null; } })();
  if (cur && cur.email === email) { console.log('already active: ' + email); if (arg('no-restart', false)) return; }
  if (cur) {
    const b = pool.backup(cur.email, cur.raw);
    pool.upsert(st, { email: cur.email, blob: cur.raw, addedAt: st.accounts[cur.email] ? st.accounts[cur.email].addedAt : new Date().toISOString() });
    pool.save(st);
    console.log('backed up current credential -> ' + b);
  }
  cred.write(target.blob);
  const verify = cred.read();
  if (verify.email !== email) {
    if (cur) { cred.write(cur.raw); console.log('MISMATCH: wrote ' + email + ' but read back ' + verify.email + ' -> rolled back'); process.exitCode = 2; return; }
    throw new Error('verification failed and no backup to roll back to');
  }
  st.current = email;
  pool.save(st);
  console.log('switched to: ' + email + '  (verified)');
  if (arg('no-restart', false)) { console.log('skipped restart (--no-restart); client keeps the old session until it reopens'); return; }
  restartApp(arg('fast', false));
}

function cmdNewAccount() {
  const st = pool.load();
  let cur = null;
  try { cur = cred.read(); } catch (e) { cur = null; }
  if (cur && cur.email && cur.raw) {
    pool.backup(cur.email, cur.raw);
    pool.upsert(st, {
      email: cur.email,
      label: st.accounts[cur.email] ? st.accounts[cur.email].label : '',
      blob: cur.raw,
      addedAt: st.accounts[cur.email] && st.accounts[cur.email].addedAt ? st.accounts[cur.email].addedAt : new Date().toISOString(),
    });
    pool.save(st);
  }
  try { cred.remove(); } catch (e) {}
  restartApp(true);
}

function cmdQuota() {
  const st = pool.load();
  const all = arg('all', false);
  const cur = (function () { try { return cred.read(); } catch (e) { return null; } })();
  const emails = all ? st.order.slice() : [cur ? cur.email : null].filter(Boolean);
  if (!emails.length) { console.log('no account'); return; }
  for (const email of emails) {
    let token;
    if (cur && cur.email === email) token = cur.token;
    else if (st.accounts[email]) token = (typeof st.accounts[email].blob === 'string' ? JSON.parse(st.accounts[email].blob) : st.accounts[email].blob).token;
    if (!token) { console.log(email + ': no token stored'); continue; }
    try {
      const fresh = quota.ensureToken(token);
      const res = quota.fetchQuota(fresh);
      if (!res.ok) { console.log(email + ': quota failed -> ' + res.error); continue; }
      const tier = res.tier ? (res.tier.name || res.tier.tierName || res.tier.id || '') : '';
      console.log('\n' + email + (tier ? '   [' + tier + ']' : ''));
      for (const b of quota.summarizeAll(res)) {
        console.log('  ' + String(b.group || '').padEnd(22) + String(b.window || '').padEnd(7) + ' left ' + fmtPct(b.remaining) + ' reset ' + fmtReset(b.reset));
        if (b.models && b.models.length) console.log('      ' + b.models.join(', '));
      }
      if (fresh !== token && st.accounts[email]) {
        const blob = JSON.parse(st.accounts[email].blob);
        blob.token = fresh;
        pool.upsert(st, { email: email, blob: JSON.stringify(blob) });
        pool.save(st);
      }
    } catch (e) { console.log(email + ': ' + e.message); }
  }
}

function cmdUsage() {
  const days = Number(arg('days', 30));
  const evs = getUsage().collect();
  if (!evs.length) { console.log('no local usage records found'); return; }
  const now = Date.now();
  const cut = now - days * 86400000;
  const inRange = evs.filter(e => e.ts * 1000 >= cut);
  const byModel = {}, byDay = {};
  let tIn = 0, tOut = 0, tCache = 0, tAll = 0;
  for (const e of inRange) {
    const d = new Date(e.ts * 1000);
    const day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    tIn += e.input; tOut += e.output; tCache += e.cached; tAll += e.total;
    const m = byModel[e.model] || (byModel[e.model] = { i: 0, o: 0, c: 0, t: 0, n: 0 });
    m.i += e.input; m.o += e.output; m.c += e.cached; m.t += e.total; m.n++;
    const dd = byDay[day] || (byDay[day] = { i: 0, o: 0, t: 0, n: 0 });
    dd.i += e.input; dd.o += e.output; dd.t += e.total; dd.n++;
  }
  console.log('local usage, last ' + days + ' day(s): ' + inRange.length + ' generations');
  console.log('input ' + tIn.toLocaleString() + '   output ' + tOut.toLocaleString() + '   cached ' + tCache.toLocaleString() + '   total ' + tAll.toLocaleString());
  console.log('\nby model:');
  Object.entries(byModel).sort((a, b) => b[1].t - a[1].t).forEach(([k, v]) => {
    console.log('  ' + k.padEnd(32) + ' calls ' + String(v.n).padStart(3) + '   in ' + String(v.i).padStart(8) + '   out ' + String(v.o).padStart(6) + '   total ' + String(v.t).padStart(9));
  });
  console.log('\nby day:');
  Object.entries(byDay).sort().forEach(([k, v]) => {
    console.log('  ' + k + '   calls ' + String(v.n).padStart(3) + '   in ' + String(v.i).padStart(8) + '   out ' + String(v.o).padStart(6) + '   total ' + String(v.t).padStart(9));
  });
}


function cmdTurns() {
  const usage = getUsage();
  const list = usage.listConvs();
  if (!list.length) { console.log('没有找到 Antigravity 会话数据库'); return; }
  if (arg('list', false)) {
    console.log('最近会话:');
    list.slice(0, 10).forEach(function (c) {
      const when = new Date(c.mtime).toISOString().slice(0, 16).replace('T', ' ');
      console.log('  [' + c.src + '] ' + c.id + '   ' + when + 'Z');
    });
    return;
  }
  let target = list[0];
  const pref = arg('conv', null);
  if (pref && pref !== true) {
    target = list.find(function (c) { return c.id.indexOf(String(pref)) === 0; }) || null;
    if (!target) { console.log('没有匹配 "' + pref + '" 的会话'); process.exitCode = 1; return; }
  }
  const turns = usage.readTurns(target.path);
  if (!turns.length) { console.log('会话 ' + target.id + ' 没有推理元数据'); return; }
  if (arg('json', false)) { console.log(JSON.stringify({ conv: target.id, src: target.src, turns: turns }, null, 1)); return; }

  if (arg('stats', false)) {
    const valid = turns.filter(function (t) { return t.dur > 0; });
    const ttfts = valid.map(function (t) { return t.ttft; }).filter(function (v) { return v > 0; });
    const tpss = valid.map(function (t) { return t.tps; }).filter(function (v) { return v > 0; });
    const outTok = valid.reduce(function (s, t) { return s + t.output; }, 0);
    const thinkTok = valid.reduce(function (s, t) { return s + t.think; }, 0);
    console.log('');
    console.log('Antigravity 轮次统计 [' + target.src + ']  ' + target.id);
    console.log('轮次 ' + turns.length + '   有计时 ' + valid.length + '   输出 ' + outTok + ' tok');
    if (ttfts.length) console.log('首字延迟   平均 ' + avg(ttfts).toFixed(2) + 's   中位 ' + pctOf(ttfts, 50).toFixed(2) + 's   p90 ' + pctOf(ttfts, 90).toFixed(2) + 's   最大 ' + Math.max.apply(null, ttfts).toFixed(2) + 's');
    if (tpss.length) console.log('生成速率   平均 ' + avg(tpss).toFixed(1) + ' tok/s   中位 ' + pctOf(tpss, 50).toFixed(1) + ' tok/s   p10 ' + pctOf(tpss, 10).toFixed(1));
    if (outTok) console.log('思考占比   ' + Math.round((thinkTok / outTok) * 100) + '%  (' + thinkTok + ' / ' + outTok + ')');
    const byEp = {};
    valid.forEach(function (t) {
      const k = t.endpoint || '-';
      const b = byEp[k] || (byEp[k] = { n: 0, ttft: [], tps: [], out: 0 });
      b.n++; b.out += t.output;
      if (t.ttft > 0) b.ttft.push(t.ttft);
      if (t.tps > 0) b.tps.push(t.tps);
    });
    console.log('按后端端点:');
    Object.keys(byEp).sort(function (a, b) { return byEp[b].n - byEp[a].n; }).forEach(function (k) {
      const b = byEp[k];
      console.log('  ' + String(k).padEnd(26) + ' 轮次 ' + String(b.n).padStart(4) + '   首字中位 ' + pctOf(b.ttft, 50).toFixed(2) + 's   速率中位 ' + pctOf(b.tps, 50).toFixed(1) + ' tok/s   输出 ' + b.out);
    });
    return;
  }

  const all = arg('all', false);
  const lv = arg('last', null);
  const lastN = (lv && lv !== true) ? Math.max(1, Number(lv)) : (all ? turns.length : 1);
  const show = turns.slice(Math.max(0, turns.length - lastN));
  console.log('');
  console.log('Antigravity 轮次检测 [' + target.src + ']');
  console.log('会话: ' + target.id + '   共 ' + turns.length + ' 轮');
  for (const t of show) {
    const share = t.dur > 0 ? Math.round((t.ttft / t.dur) * 100) : 0;
    console.log(Array(59).join('-'));
    console.log('#' + t.idx + '   首字占比 ' + share + '%');
    console.log('  界面模型   ' + (t.client || '-'));
    console.log('  后端端点   ' + (t.endpoint || '-'));
    console.log('  内部枚举   ' + (t.enum || '-'));
    console.log('  速率       ' + (t.tps || '-') + ' tok/s');
    console.log('  耗时       ' + fmtSec(t.dur) + '   首字 ' + fmtSec(t.ttft));
    console.log('  Token      入 ' + t.input + ' (+sys ' + t.sys + ') | 出 ' + t.output + ' (思考 ' + t.think + ' / 正文 ' + t.content + ') | 缓存 ' + t.cached);
    const flags = ['used_non_gemini_model', 'used_claude', 'used_claude_conservative'].filter(function (k) { return t.meta[k] !== undefined; });
    if (flags.length) console.log('  路由标记   ' + flags.map(function (k) { return k.replace('used_', '') + '=' + t.meta[k]; }).join('   '));
  }
}

function fmtSec(v) { return (v === null || v === undefined) ? '-' : Number(v).toFixed(3) + 's'; }
function avg(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function pctOf(a, p) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); const i = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1)))); return s[i]; }
function cmdExportPage() {
  const withQuota = arg('quota', false);
  const outFile = path.join(__dirname, 'magpie-plugin', 'page', 'data.js');
  const st = pool.load();
  let cur = null;
  try {
    const c = cred.read();
    cur = {
      email: c.email,
      authMethod: c.authMethod,
      expiresInMin: c.token && c.token.expiry ? Math.round((Date.parse(c.token.expiry) - Date.now()) / 60000) : null,
    };
  } catch (e) { cur = null; }

  const toBucket = (q, email) => ({ account: email, group: q.group, window: q.window, remaining: q.remaining, reset: q.reset, models: q.models || null });

  const accounts = st.order.map((email) => {
    const a = st.accounts[email] || {};
    let buckets = a.quota || [];
    let stale = false;
    if (withQuota) {
      let fetched = false;
      try {
        let token = null;
        if (cur && cur.email === email) { try { token = cred.read().token; } catch (e) {} }
        if (!token && a.blob) { const b = JSON.parse(a.blob); token = b.token || null; }
        if (token) {
          const fresh = quota.ensureToken(token);
          const res = quota.fetchQuota(fresh);
          if (res.ok) {
            buckets = quota.summarizeAll(res);
            fetched = true;
            pool.upsert(st, { email: email, quota: buckets, quotaAt: new Date().toISOString() });
            if (fresh !== token && a.blob) { const b = JSON.parse(a.blob); b.token = fresh; st.accounts[email].blob = JSON.stringify(b); }
            pool.save(st);
          }
        }
      } catch (e) { buckets = buckets || []; }
      stale = !fetched;
    }
    const mapped = (stale && withQuota)
      ? [{ account: email, group: '配额读取失败', window: '-', remaining: null, reset: null, models: null }]
      : buckets.map((q) => toBucket(q, email));
    return { email: email, label: a.label || '', addedAt: a.addedAt, stale: stale, quota: mapped };
  });

  // The account Antigravity is signed in as is not always the one kept in the pool;
  // show it too so the tiles never describe an account that is not in use.
  if (cur && cur.email && !st.accounts[cur.email]) {
    let liveBuckets = [];
    let stale = true;
    if (withQuota) {
      try {
        const tok = cred.read().token;
        if (tok) {
          const res = quota.fetchQuota(quota.ensureToken(tok));
          if (res.ok) { liveBuckets = quota.summarizeAll(res); stale = false; }
        }
      } catch (e) { liveBuckets = []; }
    }
    accounts.unshift({
      email: cur.email,
      label: '当前登录（不在池中）',
      addedAt: null,
      stale: stale,
      quota: liveBuckets.map((q) => toBucket(q, cur.email)),
    });
  }

  const days = Number(arg('days', 30));
  const cut = Date.now() - days * 86400000;
  const usage = getUsage();
  const evs = usage.collect().filter((e) => e.ts * 1000 >= cut);
  const byModelMap = {}, byDayMap = {};
  let tIn = 0, tOut = 0, tAll = 0;
  for (const e of evs) {
    tIn += e.input; tOut += e.output; tAll += e.total;
    const m = byModelMap[e.model] || (byModelMap[e.model] = { model: e.model, calls: 0, input: 0, output: 0, total: 0 });
    m.calls++; m.input += e.input; m.output += e.output; m.total += e.total;
    const d = new Date(e.ts * 1000);
    const day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const dd = byDayMap[day] || (byDayMap[day] = { day: day, calls: 0, total: 0 });
    dd.calls++; dd.total += e.total;
  }

  const turnsBlock = (function () {
    try {
      const list = usage.listConvs();
      if (!list.length) return null;
      const conv = list[0];
      const all = usage.readTurns(conv.path).filter(function (x) { return x.dur > 0; });
      if (!all.length) return null;
      const ttfts = all.map(function (x) { return x.ttft; }).filter(function (v) { return v > 0; });
      const tpss = all.map(function (x) { return x.tps; }).filter(function (v) { return v > 0; });
      const stats = {
        count: all.length,
        ttftMedian: Math.round(pctOf(ttfts, 50) * 100) / 100,
        ttftP90: Math.round(pctOf(ttfts, 90) * 100) / 100,
        tpsMedian: Math.round(pctOf(tpss, 50) * 10) / 10,
        output: all.reduce(function (s, x) { return s + x.output; }, 0),
      };
      const last = all.slice(-8).map(function (x) {
        return {
          idx: x.idx,
          client: x.client,
          endpoint: x.endpoint,
          enum: x.enum,
          tps: x.tps,
          ttft: x.ttft,
          dur: x.dur,
          input: x.input + x.sys,
          output: x.output,
          think: x.think,
          cached: x.cached,
          claude: x.meta.used_claude === 'true',
          nonGemini: x.meta.used_non_gemini_model === 'true',
        };
      });
      return { conv: conv.id, src: conv.src, stats: stats, last: last };
    } catch (e) { return null; }
  })();

  const data = {
    generatedAt: new Date().toISOString(),
    current: cur,
    accounts: accounts,
    turns: turnsBlock,
    usage: {
      days: days,
      calls: evs.length,
      input: tIn,
      output: tOut,
      total: tAll,
      byModel: Object.values(byModelMap).sort((a, b) => b.total - a.total),
      byDay: Object.values(byDayMap).sort((a, b) => (a.day < b.day ? -1 : 1)),
    },
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, 'globalThis.AGY_DATA = ' + JSON.stringify(data, null, 1) + ';\n', 'utf8');
  console.log('page snapshot written: ' + outFile);
  console.log('  accounts ' + accounts.length + ' · quota buckets ' + accounts.reduce((n, a) => n + a.quota.length, 0) + ' · usage ' + evs.length + ' generations');
}

function pickGeminiBucket(buckets) {
  if (!Array.isArray(buckets)) return null;
  const hit = buckets.find((b) => {
    if (!b) return false;
    if (b.id === 'gemini-models') return true;
    if (typeof b.group === 'string' && /gemini/i.test(b.group)) return true;
    if (Array.isArray(b.models) && b.models.some((m) => /^gemini/i.test(String(m)))) return true;
    return false;
  });
  if (!hit) return null;
  const models = Array.isArray(hit.models)
    ? hit.models.filter((m) => /^gemini/i.test(String(m)))
    : [];
  return {
    remaining: (hit.remaining === undefined || hit.remaining === null) ? null : Number(hit.remaining),
    window: hit.window || '5h',
    reset: hit.reset || null,
    models: models,
  };
}

function readSnapshotFallback(email) {
  try {
    const snapFile = path.join(__dirname, 'magpie-plugin', 'page', 'data.js');
    if (!fs.existsSync(snapFile)) return null;
    const raw = fs.readFileSync(snapFile, 'utf8').replace(/^globalThis\.AGY_DATA\s*=\s*/, '').replace(/;\s*$/, '');
    const snap = JSON.parse(raw);
    const item = (snap.accounts || []).find((a) => a && a.email === email);
    return item ? { quota: item.quota || [], quotaAt: snap.generatedAt || null } : null;
  } catch (e) {
    return null;
  }
}

function cmdMenuData() {
  const withRefresh = arg('refresh', false);
  const st = pool.load();
  let cur = null;
  try { cur = cred.read(); } catch (e) { cur = null; }
  const curEmail = cur && cur.email ? cur.email : null;

  // 若当前客户端登录了一个列表里还没有的新号，自动保存凭据到列表，免去手动添加
  if (curEmail && cur && cur.raw && !st.accounts[curEmail]) {
    pool.upsert(st, {
      email: curEmail,
      label: '',
      blob: cur.raw,
      addedAt: new Date().toISOString(),
    });
    st.current = curEmail;
    pool.save(st);
  }

  const list = [];
  const pushAccount = (email, meta, inPool) => {
    let buckets = (meta && meta.quota) || [];
    let quotaAt = (meta && meta.quotaAt) || null;
    let err = null;

    if (!buckets.length && !withRefresh) {
      const fb = readSnapshotFallback(email);
      if (fb && fb.quota.length) {
        buckets = fb.quota;
        quotaAt = fb.quotaAt;
      }
    }

    if (withRefresh) {
      try {
        let token = null;
        if (cur && cur.email === email) token = cur.token;
        else if (meta && meta.blob) token = JSON.parse(meta.blob).token || null;
        if (token) {
          const fresh = quota.ensureToken(token);
          const res = quota.fetchQuota(fresh);
          if (res.ok) {
            buckets = quota.summarizeAll(res);
            quotaAt = new Date().toISOString();
            if (inPool) {
              const patch = { email, quota: buckets, quotaAt };
              if (fresh !== token && meta && meta.blob) {
                const b = JSON.parse(meta.blob);
                b.token = fresh;
                patch.blob = JSON.stringify(b);
              }
              pool.upsert(st, patch);
              pool.save(st);
            }
          } else {
            err = res.error || '配额拉取失败';
          }
        } else {
          err = '缺少 OAuth token';
        }
      } catch (e) {
        err = e.message || String(e);
      }
    }

    list.push({
      email,
      shortName: String(email).slice(0, 4),
      label: (meta && meta.label) || (inPool ? '' : '当前未入池'),
      active: email === curEmail,
      inPool,
      quotaAt,
      gemini: pickGeminiBucket(buckets),
      error: err,
    });
  };

  if (curEmail && !st.accounts[curEmail]) {
    pushAccount(curEmail, null, false);
  }
  for (const email of st.order) {
    if (st.accounts[email]) pushAccount(email, st.accounts[email], true);
  }

  console.log(JSON.stringify({
    currentEmail: curEmail,
    currentInPool: Boolean(curEmail && st.accounts[curEmail]),
    accounts: list,
  }));
}

const cmd = process.argv[2];
try {
  if (cmd === 'current') cmdCurrent();
  else if (cmd === 'list') cmdList();
  else if (cmd === 'add') cmdAdd();
  else if (cmd === 'use') cmdUse(process.argv[3]);
  else if (cmd === 'quota') cmdQuota();
  else if (cmd === 'usage') cmdUsage();
  else if (cmd === 'turns') cmdTurns();
  else if (cmd === 'export-page') cmdExportPage();
  else if (cmd === 'menu-data') cmdMenuData();
  else if (cmd === 'new-account') cmdNewAccount();
  else if (cmd === 'launch-only') launchAppSilently();
  else {
    console.log('agy-accounts <command>');
    console.log('  current                 show the account Antigravity is using now');
    console.log('  list                    list saved accounts');
    console.log('  add [--label X]         save the current credential into the pool');
    console.log('  use <email|#n> [--no-restart]   switch account (restarts the client by default)');
    console.log('  quota [--all]           fetch quota and reset times');
    console.log('  usage [--days N]        local token usage from Antigravity conversation DBs');
    console.log('  turns [--list] [--conv ID] [--last N|--all] [--json]   per-turn endpoint / TPS / TTFT');
    console.log('  export-page [--quota]   write the snapshot the magpie page renders');
    console.log('  menu-data [--refresh]   JSON snapshot for desktop menu UI');
  }
} catch (e) {
  console.error('error: ' + e.message);
  process.exitCode = 1;
}
