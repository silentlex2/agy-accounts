// Antigravity accounts / quota / usage, exposed to every agent through magpie's MCP tools.
// Backed by the local CLI at ../cli.js — no network of its own, no extra dependency.
import { execFileSync } from "node:child_process";

const CLI = new URL("../cli.js", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1").replace(/\//g, "\\");

function run(args, timeout = 120000) {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8", windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 });
    return out.replace(/(?:\(node:\d+\) ExperimentalWarning[\s\S]*?\n)/g, "").trim() || "(no output)";
  } catch (e) {
    return "command failed: " + (e.stderr || e.message || String(e)).toString().slice(0, 2000);
  }
}

// Keep the page's snapshot fresh while magpie is running: rewrite page/data.js
// every minute so the page (which cannot fetch) always shows recent numbers.
let exporting = false;
function refreshPage() {
  if (exporting) return;
  exporting = true;
  try {
    execFileSync(process.execPath, [CLI, "export-page", "--quota"], { windowsHide: true, timeout: 180000, stdio: "ignore" });
  } catch (e) {
    // a failing snapshot must never take the plugin host down
  } finally {
    exporting = false;
  }
}
setTimeout(refreshPage, 2000);
const pageTimer = setInterval(refreshPage, 60000);
if (pageTimer && typeof pageTimer.unref === "function") pageTimer.unref();

export const AgyAccountsTools = async () => ({
  tool: {
    agy_accounts: {
      description:
        "Lists the Antigravity accounts saved on this machine and marks the one Antigravity is signed in as. " +
        "Antigravity keeps exactly one active account in the Windows credential store (gemini:antigravity); " +
        "this pool keeps copies of the others so they can be switched back instantly.",
      args: { type: "object", properties: {} },
      async execute() { return run(["list"]); },
    },
    agy_current: {
      description: "Shows which Antigravity account is active right now, its auth method and how long the access token still lasts.",
      args: { type: "object", properties: {} },
      async execute() { return run(["current"]); },
    },
    agy_switch: {
      description:
        "Switches the Antigravity desktop account. Writes the saved credential for the target account, verifies the email read back, " +
        "and (unless restart=false) restarts the client through the proxy-aware launcher. Refuses and rolls back on a mismatch.",
      args: {
        type: "object",
        properties: {
          account: { type: "string", description: "email address, or #1 / #2 as shown by agy_accounts" },
          restart: { type: "boolean", description: "restart the Antigravity client after switching (default true)" },
        },
        required: ["account"],
      },
      async execute(args) {
        const acc = String(args.account || "").trim();
        if (!acc) throw new Error("account is required");
        const flags = args.restart === false ? ["--no-restart"] : [];
        return run(["use", acc, ...flags], 180000);
      },
    },
    agy_quota: {
      description:
        "Fetches Antigravity quota for the active account (or every saved account with all=true): remaining fraction per window " +
        "(5h and weekly) and when each window resets. Uses the account's own token; refreshes it when expired.",
      args: {
        type: "object",
        properties: { all: { type: "boolean", description: "query every saved account, not just the active one" } },
      },
      async execute(args) { return run(args && args.all ? ["quota", "--all"] : ["quota"], 180000); },
    },
    agy_usage: {
      description:
        "Reads Antigravity's own local conversation databases (read-only) and reports token usage per model and per day: " +
        "input, output, cached and total tokens. No conversation text is returned.",
      args: {
        type: "object",
        properties: { days: { type: "number", description: "how many days back to include (default 30)" } },
      },
      async execute(args) { return run(["usage", "--days", String(args && args.days ? args.days : 30)]); },
    },
  },
});
