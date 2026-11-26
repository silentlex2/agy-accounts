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

module.exports = { loadLocalConfig, CFG_PATH };
