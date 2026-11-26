# agy-accounts

Google Antigravity 桌面端（Windows）多账号管理、**顶栏「账号」悬浮切号菜单**、Gemini 配额监控与本地用量统计工具。

## 核心特性

1. **客户端内嵌顶栏「账号」菜单（非独立软件）**
   - 直接挂载在 Antigravity 桌面端左上角「窗口」按钮旁，随系统明暗主题自动适配。
   - **悬浮「账号」**：显示已保存账号列表（展示账号前 4 位与激活标识），自动将当前新登录的号收录进列表。
   - **悬浮具体账号**：右侧弹出 **Gemini 剩余配额卡片**（剩余百分比、进度条与重置倒计时）。
   - **点击切号 + 二次确认防误触**：确认后自动备份当前凭据、写入目标凭据、校验并静默重启客户端。
   - **一键「+ 添加新账号」**：安全保留当前账号后退出并重启至登录页，用新号登录后打开菜单自动录入。
2. **完整 CLI 工具**
   - `current` / `list` / `add` / `use` / `quota` / `usage` / `turns` / `new-account`
3. **可选 Magpie MCP 工具与只读侧栏页**（位于 `magpie-plugin/`）

---

## 快速安装（顶栏「账号」菜单）

需要 **Node.js >= 18**（Windows 平台）。

1. 安装依赖（仅需 `@electron/asar` 用于增量修改 `app.asar`）：
   ```bat
   npm install
   ```
2. 写入菜单补丁并重启 Antigravity 客户端：
   - **方式 A（推荐）**：直接双击运行 `install-menu.cmd`（会自动结束旧进程 → 写入补丁 → 静默重开客户端）。
   - **方式 B**：手动先退出 Antigravity，再运行：
     ```bat
     node patch-menu.js install
     ```

### 状态检查与卸载还原
* 查看状态：`node patch-menu.js status`
* 预演校验（不修改文件）：`node patch-menu.js install --dry-run`
* 干净卸载还原（退出客户端后运行）：`node patch-menu.js uninstall`

> 补丁仅在 `app.asar` 的 `dist/preload.js` 与 `dist/ipcHandlers.js` 末尾追加带标记的增量代码块，不破坏已有汉化，也不会覆盖官方原版备份。

---

## CLI 用法

```bat
agy-accounts.cmd current                  :: 当前登录账号与 token 有效期
agy-accounts.cmd list                     :: 查看已保存账号列表
agy-accounts.cmd add --label work         :: 将当前账号存入账号池
agy-accounts.cmd use  someone@gmail.com   :: 切换账号并静默重启客户端
agy-accounts.cmd use  #2 --no-restart     :: 仅写入凭据不重启
agy-accounts.cmd quota                    :: 当前账号配额与重置时间
agy-accounts.cmd quota --all              :: 所有账号配额
agy-accounts.cmd usage --days 7           :: 扫描本地会话统计 token 用量
```

---

## 可选本机配置（`local.config.json`）

如需走本地代理、指定自定义启动脚本，或配置过期 token 自动刷新所需的桌面端 OAuth 参数，可复制示例文件：

```bat
copy local.config.example.json local.config.json
```

支持字段（也可通过环境变量 `AGY_PROXY`、`AGY_LAUNCHER`、`AGY_OAUTH_CLIENT_ID`、`AGY_OAUTH_CLIENT_SECRET` 覆盖）：
* `proxy`：HTTP 代理地址（例如 `http://127.0.0.1:7890`；留空则直连或读系统 `HTTPS_PROXY`）
* `launcher`：自定义客户端启动脚本路径（留空则直接拉起 `Antigravity.exe`）
* `oauthClientId` / `oauthClientSecret`：当缓存的 `access_token` 过期且需要独立刷新配额时使用

---

## 工作原理与安全说明

* **凭据存储**：读写 Windows 凭据管理器中的 `gemini:antigravity`（user `antigravity`）。切号前会自动备份到 `backups/`，写入后读回校验邮箱一致性，不匹配时立即回滚。
* **隐私隔离**：`.gitignore` 已默认排除 `accounts.json`、`local.config.json`、`backups/`、`*.log` 与快照文件，**切勿手动提交这些文件到公开仓库**。
