#!/usr/bin/env node
'use strict';

/**
 * Antigravity 桌面端左上角「账号」菜单补丁管理器
 * 支持 status / install [--dry-run] / uninstall [--asar <path>]
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { execFileSync, execSync } = require('node:child_process');

const MARKER_START = '// --- AGY-ACCOUNTS-MENU-START ---';
const MARKER_END = '// --- AGY-ACCOUNTS-MENU-END ---';

const ROOT = __dirname;
const CLI_PATH = path.join(ROOT, 'cli.js');
const MENU_UI_PATH = path.join(ROOT, 'menu-ui.js');
const BACKUP_DIR = path.join(ROOT, 'backups');

function findExistingPath(candidates) {
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function loadAsar() {
  const localMod = path.join(ROOT, 'node_modules', '@electron', 'asar');
  if (fs.existsSync(localMod)) return require(localMod);
  try {
    return require('@electron/asar');
  } catch (e) {
    throw new Error('缺少依赖 @electron/asar，请先在项目目录执行: npm install');
  }
}

function loadUnpackHelper() {
  const helperPath = path.join(ROOT, 'lib', 'asar-unpack.js');
  return fs.existsSync(helperPath) ? require(helperPath) : null;
}

function findAsarBin() {
  const binName = process.platform === 'win32' ? 'asar.cmd' : 'asar';
  const localBin = path.join(ROOT, 'node_modules', '.bin', binName);
  return fs.existsSync(localBin) ? localBin : null;
}

function findAppAsar() {
  const customIdx = process.argv.indexOf('--asar');
  if (customIdx !== -1 && process.argv[customIdx + 1]) {
    return path.resolve(process.argv[customIdx + 1]);
  }
  const found = findExistingPath([
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'antigravity', 'resources', 'app.asar'),
    path.join(process.env.ProgramFiles || '', 'antigravity', 'resources', 'app.asar'),
    path.join(process.env.ProgramFiles || '', 'Google Antigravity', 'resources', 'app.asar'),
  ]);
  if (!found) throw new Error('未找到 Antigravity 的 app.asar，请通过 --asar <path> 指定');
  return found;
}

function stripPatch(code) {
  const re = new RegExp(
    '\\r?\\n?' +
    MARKER_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
    '[\\s\\S]*?' +
    MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
    '\\r?\\n?',
    'g'
  );
  return code.replace(re, '\n');
}

function hasPatch(code) {
  return code.includes(MARKER_START) && code.includes(MARKER_END);
}

function buildIpcInjection() {
  const nodeBin = JSON.stringify(process.execPath);
  const cliPath = JSON.stringify(CLI_PATH);
  return `
${MARKER_START}
    ;(() => {
      const _cp = require('node:child_process');
      const _nodeBin = ${nodeBin};
      const _cliPath = ${cliPath};
      const _runMenu = (extraArgs) => new Promise((resolve) => {
        _cp.execFile(_nodeBin, [_cliPath, ...extraArgs], { encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            resolve({ error: (stderr || err.message || String(err)).slice(0, 500) });
            return;
          }
          if (extraArgs[0] === 'add') {
            resolve({ ok: true, output: String(stdout || '').trim() });
            return;
          }
          try {
            resolve(JSON.parse(String(stdout || '').trim()));
          } catch (pe) {
            resolve({ error: 'JSON 解析失败: ' + pe.message });
          }
        });
      });
      localOnly('agy-accounts:list', async () => _runMenu(['menu-data']));
      localOnly('agy-accounts:add-current', async () => _runMenu(['add']));
      localOnly('agy-accounts:switch', async (_event, req) => {
        const email = req && typeof req.email === 'string' ? req.email.trim() : '';
        if (!email) return { error: '缺少目标账号邮箱' };
        try {
          const child = _cp.spawn(_nodeBin, [_cliPath, 'use', email, '--fast'], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
          });
          child.unref();
          return { ok: true };
        } catch (err) {
          return { error: err && err.message ? err.message : String(err) };
        }
      });
      localOnly('agy-accounts:new-account', async () => {
        try {
          const child = _cp.spawn(_nodeBin, [_cliPath, 'new-account'], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
          });
          child.unref();
          return { ok: true };
        } catch (err) {
          return { error: err && err.message ? err.message : String(err) };
        }
      });
    })();
${MARKER_END}
`;
}

function buildPreloadInjection() {
  const uiCode = fs.readFileSync(MENU_UI_PATH, 'utf8');
  return `
${MARKER_START}
;(function () {
  try {
    if (typeof isRemoteWindow !== 'undefined' && isRemoteWindow) return;
    var _el = typeof electron_1 !== 'undefined' ? electron_1 : require('electron');
    if (_el && _el.ipcRenderer) {
      var _bridge = {
        list: function () { return _el.ipcRenderer.invoke('agy-accounts:list'); },
        addCurrent: function () { return _el.ipcRenderer.invoke('agy-accounts:add-current'); },
        switchAccount: function (email) { return _el.ipcRenderer.invoke('agy-accounts:switch', { email: email }); },
        newAccount: function () { return _el.ipcRenderer.invoke('agy-accounts:new-account'); },
      };
      globalThis.__AGY_ACCOUNTS_BRIDGE__ = _bridge;
      if (_el.contextBridge) {
        _el.contextBridge.exposeInMainWorld('agyAccountsBridge', _bridge);
      }
    }
  } catch (e) {
    console.error('[agy-accounts] bridge error:', e);
  }
})();
${uiCode}
${MARKER_END}
`;
}

function injectIpcHandlers(code) {
  const clean = stripPatch(code);
  const anchor = '(0, wcvIpcHandlers_1.registerWcvIpcHandlers)(undefined, undefined, storageManager);';
  const idx = clean.indexOf(anchor);
  if (idx === -1) {
    throw new Error('在 dist/ipcHandlers.js 中未找到注入锚点 (registerWcvIpcHandlers)');
  }
  return clean.slice(0, idx) + buildIpcInjection() + '    ' + clean.slice(idx);
}

function injectPreload(code) {
  const clean = stripPatch(code).trimEnd();
  return clean + '\n' + buildPreloadInjection();
}

function assertJsSyntax(code, filename) {
  new vm.Script(code, { filename });
}

function isClientRunning() {
  if (process.platform !== 'win32') return false;
  try {
    const out = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', "(Get-Process Antigravity -ErrorAction SilentlyContinue | Measure-Object).Count"],
      { encoding: 'utf8', windowsHide: true }
    );
    return Number(out.trim()) > 0;
  } catch {
    return false;
  }
}

function sleepSync(ms) {
  const buf = new SharedArrayBuffer(4);
  const view = new Int32Array(buf);
  Atomics.wait(view, 0, 0, ms);
}

function killAndWaitClient() {
  if (process.platform !== 'win32') return;
  try { execFileSync('taskkill', ['/IM', 'Antigravity.exe', '/F'], { stdio: 'ignore', windowsHide: true }); } catch {}
  try { execFileSync('taskkill', ['/IM', 'language_server.exe', '/F'], { stdio: 'ignore', windowsHide: true }); } catch {}
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (!isClientRunning()) {
      sleepSync(800);
      return;
    }
    sleepSync(400);
  }
  throw new Error('等待 Antigravity.exe 退出超时，请手动在任务管理器结束进程后重试');
}

function isCustomAsarTarget() {
  return process.argv.includes('--asar');
}

function cmdStatus(asarMod, asarPath) {
  const preload = asarMod.extractFile(asarPath, 'dist/preload.js').toString('utf8');
  const ipc = asarMod.extractFile(asarPath, 'dist/ipcHandlers.js').toString('utf8');
  const i18nInstalled = preload.includes('Antigravity Chinese Localization Injection');
  console.log('app.asar       :', asarPath);
  console.log('中文汉化补丁   :', i18nInstalled ? '已安装' : '未安装');
  console.log('菜单栏切号补丁 :', (hasPatch(preload) && hasPatch(ipc)) ? '已安装 (preload + ipcHandlers)' : '未安装');
}

/**
 * 保留原始 app.asar.unpacked 布局打包并校验一致性，然后原子替换目标 app.asar。
 */
async function packVerifyAndSwap(asarMod, asarPath, extractDir, outAsar, dryRun) {
  const unpackHelper = loadUnpackHelper();
  const asarBin = findAsarBin();
  const hasUnpacked = fs.existsSync(asarPath + '.unpacked');

  if (hasUnpacked && unpackHelper && asarBin) {
    const unpackArgs = unpackHelper.getUnpackArgs(asarPath).map((a) => `"${a}"`).join(' ');
    execSync(`"${asarBin}" pack "${extractDir}" "${outAsar}" ${unpackArgs}`, { stdio: 'pipe' });
    const count = unpackHelper.verifyUnpackedOutput(asarPath, outAsar);
    console.log(`    已保留并校验 ${count} 个外置 unpacked 文件`);
  } else {
    await asarMod.createPackage(extractDir, outAsar);
  }

  if (dryRun) return;

  const swapTmp = asarPath + '.tmp-' + process.pid;
  fs.copyFileSync(outAsar, swapTmp);
  fs.renameSync(swapTmp, asarPath);
}

async function applyPatchTransform(asarMod, asarPath, mode, dryRun) {
  const isInstall = mode === 'install';
  const killFirst = process.argv.includes('--kill');
  if (!dryRun && !isCustomAsarTarget() && isClientRunning()) {
    if (killFirst) {
      console.log('0/4 正在关闭运行中的 Antigravity 进程...');
      killAndWaitClient();
    } else {
      throw new Error(`检测到 Antigravity.exe 正在运行，请先彻底关闭客户端后再执行 ${mode}（或加 --kill）`);
    }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `agy-menu-${mode}-`));
  const extractDir = path.join(tmpDir, 'extracted');
  const outAsar = path.join(tmpDir, 'out.asar');

  try {
    console.log(`1/4 解包 app.asar 到临时目录...`);
    asarMod.extractAll(asarPath, extractDir);

    const preloadPath = path.join(extractDir, 'dist', 'preload.js');
    const ipcPath = path.join(extractDir, 'dist', 'ipcHandlers.js');
    if (!fs.existsSync(preloadPath) || !fs.existsSync(ipcPath)) {
      throw new Error('app.asar 缺少 dist/preload.js 或 dist/ipcHandlers.js');
    }

    const prevPreload = fs.readFileSync(preloadPath, 'utf8');
    const prevIpc = fs.readFileSync(ipcPath, 'utf8');

    if (!isInstall && !hasPatch(prevPreload) && !hasPatch(prevIpc)) {
      console.log('当前 app.asar 未安装菜单栏切号补丁，无需卸载。');
      return;
    }

    console.log(isInstall ? '2/4 注入菜单栏切号模块并做语法校验...' : '2/4 移除菜单栏切号补丁并做语法校验...');
    const nextPreload = isInstall ? injectPreload(prevPreload) : stripPatch(prevPreload);
    const nextIpc = isInstall ? injectIpcHandlers(prevIpc) : stripPatch(prevIpc);
    assertJsSyntax(nextPreload, 'dist/preload.js');
    assertJsSyntax(nextIpc, 'dist/ipcHandlers.js');

    fs.writeFileSync(preloadPath, nextPreload, 'utf8');
    fs.writeFileSync(ipcPath, nextIpc, 'utf8');

    if (isInstall && !dryRun) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const preBak = path.join(BACKUP_DIR, 'app.asar.pre-menu.bak');
      if (!fs.existsSync(preBak)) {
        fs.copyFileSync(asarPath, preBak);
        console.log('    已备份安装前 app.asar -> ' + preBak);
      }
    }

    console.log('3/4 重新打包并校验外置布局...');
    await packVerifyAndSwap(asarMod, asarPath, extractDir, outAsar, dryRun);

    if (dryRun) {
      const checkP = asarMod.extractFile(outAsar, 'dist/preload.js').toString('utf8');
      const checkI = asarMod.extractFile(outAsar, 'dist/ipcHandlers.js').toString('utf8');
      const ok = isInstall ? (hasPatch(checkP) && hasPatch(checkI)) : (!hasPatch(checkP) && !hasPatch(checkI));
      if (!ok) throw new Error('dry-run 打包校验失败');
      console.log('✅ --dry-run 校验通过！原 app.asar 未做任何修改。');
      return;
    }

    console.log('4/4 已应用到 ' + asarPath);
    console.log(isInstall ? '✅ 安装成功！请重新启动 Antigravity 客户端生效。' : '✅ 已干净卸载菜单栏切号补丁（原汉化与官方备份均完好）。');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

(async () => {
  const cmd = process.argv[2] || 'status';
  const dryRun = process.argv.includes('--dry-run');
  const asarMod = loadAsar();
  const asarPath = findAppAsar();

  if (cmd === 'status') cmdStatus(asarMod, asarPath);
  else if (cmd === 'install') await applyPatchTransform(asarMod, asarPath, 'install', dryRun);
  else if (cmd === 'uninstall') await applyPatchTransform(asarMod, asarPath, 'uninstall', dryRun);
  else {
    console.log('用法: node patch-menu.js <status|install [--dry-run]|uninstall> [--asar <path>]');
  }
})().catch((err) => {
  console.error('❌', err.message || err);
  process.exit(1);
});
