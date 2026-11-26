const { DatabaseSync } = require('node:sqlite');
const fs = require('fs'); const path = require('path'); const os = require('os');

function readVarint(b, i) { let v = 0, s = 0, x; while (i < b.length) { x = b[i++]; v += (x & 0x7f) * Math.pow(2, s); if (!(x & 0x80)) return [v, i]; s += 7; if (s > 63) return [null, i]; } return [null, i]; }
function eachField(b, cb) {
  let i = 0;
  while (i < b.length) {
    let t; [t, i] = readVarint(b, i); if (t === null) return;
    const n = Math.floor(t / 8), wt = t % 8;
    if (wt === 0) { let v; [v, i] = readVarint(b, i); if (v === null) return; cb(n, wt, v, null); }
    else if (wt === 2) { let len; [len, i] = readVarint(b, i); if (len === null || len > b.length - i) return; const sub = b.subarray(i, i + len); i += len; cb(n, wt, null, sub); }
    else if (wt === 5) i += 4;
    else if (wt === 1) i += 8;
    else return;
  }
}
function bytesField(n, b) { let out = null; eachField(b, (fn, wt, v, sub) => { if (!out && fn === n && wt === 2) out = sub; }); return out; }
function varintField(n, b) { let out = null; eachField(b, (fn, wt, v, sub) => { if (out === null && fn === n && wt === 0) out = v; }); return out; }
function stringField(n, b) { const s = bytesField(n, b); if (!s) return null; const t = s.toString('utf8').trim(); return t.length ? t : null; }
function tsSeconds(msg) { const v = varintField(1, msg); return v && v > 0 ? Number(v) : null; }

function decodeEvent(blob, stepTs) {
  const wrapped = bytesField(1, blob); if (!wrapped) return null;
  const modelId = stringField(19, wrapped), label = stringField(21, wrapped);
  const usage = bytesField(4, wrapped); if (!usage) return null;
  const sys = Number(varintField(1, usage) || 0), rawIn = Number(varintField(2, usage) || 0);
  const outTok = Number(varintField(3, usage) || 0), cached = Number(varintField(5, usage) || 0);
  const input = sys + rawIn;
  const generated = rawIn !== 0 || outTok !== 0 || cached !== 0;
  if ((!modelId && !label && !generated) || (!generated && input === 0)) return null;
  let ts = null;
  const timing = bytesField(9, wrapped);
  if (timing) { const t4 = bytesField(4, timing); if (t4) ts = tsSeconds(t4); }
  if (!ts) ts = stepTs;
  if (!ts) return null;
  return { model: label || modelId || 'unknown', input, output: outTok, cached, total: input + cached + outTok, ts };
}

function scanDb(file) {
  const events = [];
  let db;
  try { db = new DatabaseSync(file, { readOnly: true }); } catch (e) { return events; }
  let steps = [];
  try {
    const cols = db.prepare("SELECT name FROM pragma_table_info('steps')").all().map(c => c.name);
    if (cols.includes('metadata') && cols.includes('step_type')) {
      steps = db.prepare('SELECT CASE WHEN length(metadata) <= 65536 THEN metadata ELSE NULL END AS m FROM steps WHERE step_type = 15 ORDER BY idx').all();
    }
  } catch (e) {}
  let gens = [];
  try { gens = db.prepare('SELECT idx, data FROM gen_metadata WHERE data IS NOT NULL ORDER BY idx').all(); } catch (e) {}
  db.close();
  gens.forEach((g, i) => {
    const stepTs = steps[i] && steps[i].m ? (function () { const t = bytesField(1, Buffer.from(steps[i].m)); return t ? tsSeconds(t) : null; })() : null;
    const ev = decodeEvent(Buffer.from(g.data), stepTs);
    if (ev) events.push(ev);
  });
  return events;
}

function collect() {
  const dir = path.join(os.homedir(), '.gemini');
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.startsWith('antigravity')) continue;
    const conv = path.join(dir, entry, 'conversations');
    if (!fs.existsSync(conv)) continue;
    for (const f of fs.readdirSync(conv)) {
      if (!f.endsWith('.db')) continue;
      for (const ev of scanDb(path.join(conv, f))) out.push(ev);
    }
  }
  return out;
}

function durationField(msg) {
  let sec = 0, nano = 0;
  eachField(msg, (n, wt, v) => {
    if (wt !== 0) return;
    if (n === 1) sec = v; else if (n === 2) nano = v;
  });
  return Math.round((sec + nano / 1e9) * 1000) / 1000;
}

// field 20 is repeated: each entry is { 1: key, 2: value }
function metaEntry(msg) {
  const e = {};
  eachField(msg, (n, wt, v, sub) => { if (wt === 2) e[n] = sub.toString('utf8'); });
  return (e[1] && e[2] !== undefined) ? [e[1], e[2]] : null;
}

// One gen_metadata row: what the UI asked for vs what the backend actually served,
// plus the timing that separates queue/prefill from generation speed.
function decodeTurn(data) {
  const t = { client: null, endpoint: null, enum: null, meta: {}, sys: 0, input: 0, output: 0, cached: 0, think: 0, content: 0, dur: 0, ttft: 0, tps: 0 };
  eachField(data, (fn, wt, v, sub) => {
    if (fn === 3 && wt === 2) {
      eachField(sub, (sfn, swt, sv, ssub) => { if (sfn === 28 && swt === 2) t.client = ssub.toString('utf8'); });
    } else if (fn === 1 && wt === 2) {
      eachField(sub, (sfn, swt, sv, ssub) => {
        if (sfn === 19 && swt === 2) t.endpoint = ssub.toString('utf8');
        else if (sfn === 11 && swt === 2) t.dur = durationField(ssub);
        else if (sfn === 12 && swt === 2) t.ttft = durationField(ssub);
        else if (sfn === 20 && swt === 2) { const kv = metaEntry(ssub); if (kv) { t.meta[kv[0]] = kv[1]; if (kv[0] === 'model_enum') t.enum = kv[1]; } }
        else if (sfn === 4 && swt === 2) {
          eachField(ssub, (tfn, twt, tv) => {
            if (twt !== 0) return;
            if (tfn === 1) t.sys = tv;
            else if (tfn === 2) t.input = tv;
            else if (tfn === 3) t.output = tv;
            else if (tfn === 5) t.cached = tv;
            else if (tfn === 9) t.think = tv;
            else if (tfn === 10) t.content = tv;
          });
        }
      });
    }
  });
  if (t.output && t.dur > 0) t.tps = Math.round((t.output / t.dur) * 100) / 100;
  return t;
}

function listConvs() {
  const dirs = [
    ['App', path.join(os.homedir(), '.gemini', 'antigravity', 'conversations')],
    ['CLI', path.join(os.homedir(), '.gemini', 'antigravity-cli', 'conversations')],
  ];
  const out = [];
  for (const pair of dirs) {
    const src = pair[0], dir = pair[1];
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.db')) continue;
      const p = path.join(dir, f);
      try { out.push({ src: src, path: p, id: f.replace(/\.db$/, ''), mtime: fs.statSync(p).mtimeMs }); } catch (e) {}
    }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

function readTurns(dbPath) {
  let db;
  try { db = new DatabaseSync(dbPath, { readOnly: true }); } catch (e) { return []; }
  let rows = [];
  try { rows = db.prepare('SELECT idx, data FROM gen_metadata WHERE data IS NOT NULL ORDER BY idx ASC').all(); } catch (e) { rows = []; }
  db.close();
  const out = [];
  for (const r of rows) {
    const t = decodeTurn(Buffer.from(r.data));
    t.idx = r.idx;
    out.push(t);
  }
  return out;
}
module.exports = { collect, decodeTurn, listConvs, readTurns };

if (require.main === module) {
  const evs = collect();
  console.log('events: ' + evs.length);
  const byModel = {}; const byDay = {};
  for (const e of evs) {
    const d = new Date(e.ts * 1000); const day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const m = byModel[e.model] || (byModel[e.model] = { input: 0, output: 0, cached: 0, total: 0, n: 0 });
    m.input += e.input; m.output += e.output; m.cached += e.cached; m.total += e.total; m.n++;
    const dd = byDay[day] || (byDay[day] = { input: 0, output: 0, cached: 0, total: 0, n: 0 });
    dd.input += e.input; dd.output += e.output; dd.cached += e.cached; dd.total += e.total; dd.n++;
  }
  console.log('\n== by model ==');
  for (const [k, v] of Object.entries(byModel).sort((a, b) => b[1].total - a[1].total)) console.log(k.padEnd(34) + ' calls=' + String(v.n).padStart(3) + '  in=' + v.input + ' out=' + v.output + ' cached=' + v.cached + ' total=' + v.total);
  console.log('\n== by day ==');
  for (const [k, v] of Object.entries(byDay).sort()) console.log(k + '  calls=' + String(v.n).padStart(3) + '  total=' + v.total);
}
