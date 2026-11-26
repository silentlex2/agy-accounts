const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const PS = path.join(__dirname, '..', 'tools', 'cred.ps1');
const TARGET = 'gemini:antigravity';
const USER = 'antigravity';

function ps(args) {
  return execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS, ...args],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
}

function readRaw() { return ps(['-Action', 'read', '-Target', TARGET]); }
function read() {
  const raw = readRaw().replace(/^\uFEFF/, '');
  if (!raw.trim()) throw new Error('credential blob is empty');
  const j = JSON.parse(raw);
  const tok = typeof j.token === 'string' ? JSON.parse(j.token) : j.token;
  return { raw, email: j.id_token_email, authMethod: j.auth_method, token: tok };
}
function writeRaw(text) {
  const tmp = path.join(os.tmpdir(), 'agy-cred-' + process.pid + '.json');
  fs.writeFileSync(tmp, text, { encoding: 'utf8' });
  try { return ps(['-Action', 'write', '-Target', TARGET, '-UserName', USER, '-BlobPath', tmp]).trim(); }
  finally { try { fs.unlinkSync(tmp); } catch (e) {} }
}
function write(blobText) { return writeRaw(blobText); }
function user() { return ps(['-Action', 'user', '-Target', TARGET]).trim(); }
function remove() { return ps(['-Action', 'delete', '-Target', TARGET]).trim(); }

module.exports = { read, write, user, remove, readRaw, TARGET };
