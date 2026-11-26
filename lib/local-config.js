const fs = require('node:fs');
const path = require('node:path');

const CFG_PATH = path.join(__dirname, '..', 'local.config.json');

/**
 * 读取可选的本机配置文件（local.config.json），不存在时返回空对象。
 */
function loadLocalConfig() {
  if (!fs.existsSync(CFG_PATH)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

/**
 * 读取代理配置，优先使用环境变量，其次回退到本机配置。
 */
function getProxy() {
  const cfg = loadLocalConfig();
  return process.env.AGY_PROXY || cfg.proxy || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
}

module.exports = { loadLocalConfig, getProxy, CFG_PATH };
