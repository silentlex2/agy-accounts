const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'accounts.json');
const BACKUPS = path.join(ROOT, 'backups');

function load() {
  if (!fs.existsSync(FILE)) return { accounts: {}, order: [], current: null };
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) { throw new Error('accounts.json is not valid JSON: ' + e.message); }
}
function save(state) {
  fs.mkdirSync(ROOT, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}
function backup(email, raw) {
  fs.mkdirSync(BACKUPS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safe = String(email || 'unknown').replace(/[^a-z0-9@._-]/gi, '_');
  const p = path.join(BACKUPS, 'cred-' + safe + '-' + stamp + '.json');
  fs.writeFileSync(p, raw, 'utf8');
  return p;
}
function upsert(state, acct) {
  if (!state.accounts[acct.email]) state.order.push(acct.email);
  state.accounts[acct.email] = Object.assign({}, state.accounts[acct.email], acct);
  return state;
}

module.exports = { load, save, backup, upsert, FILE, BACKUPS, ROOT };
