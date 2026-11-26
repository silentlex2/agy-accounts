# magpie tools: agy-accounts

Antigravity account switching, quota and local token usage, exposed as magpie tools (MCP) for every agent.

Backed by `../cli.js`:

- `agy_accounts` → `node ../cli.js list`
- `agy_current` → `node ../cli.js current`
- `agy_switch` → `node ../cli.js use <account> [--no-restart]`
- `agy_quota` → `node ../cli.js quota [--all]`
- `agy_usage` → `node ../cli.js usage --days N`

Load it: `magpie plugin add "<path-to-repo>/magpie-plugin"`

Notes: the credential lives in the Windows credential store (`gemini:antigravity`, user `antigravity`).
Switching restarts the client through the configured launcher (or `Antigravity.exe` by default).
