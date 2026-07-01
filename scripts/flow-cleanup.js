#!/usr/bin/env node
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/flow/paths.ts
var paths_exports = {};
__export(paths_exports, {
  getFlowRegistryDir: () => getFlowRegistryDir,
  getFlowRegistryPath: () => getFlowRegistryPath,
  getLeaderInboxPath: () => getLeaderInboxPath,
  getProjectRoot: () => getProjectRoot,
  getTeamConfigPath: () => getTeamConfigPath,
  getTeamDir: () => getTeamDir,
  getTeamsDir: () => getTeamsDir,
  sanitizeTeamName: () => sanitizeTeamName
});
function getProjectRoot() {
  return process.env.CC_FLOW_PROJECT_ROOT ?? process.cwd();
}
function getFlowRegistryDir() {
  return process.env.CC_FLOW_REGISTRY_DIR ?? (0, import_node_path.join)((0, import_node_os.homedir)(), ".claude", "cc-flow");
}
function getFlowRegistryPath(sessionShortId) {
  return (0, import_node_path.join)(getFlowRegistryDir(), `${sessionShortId}.json`);
}
function sanitizeTeamName(name) {
  return name.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
}
function getTeamsDir() {
  return process.env.CC_FLOW_TEAMS_DIR ?? (0, import_node_path.join)((0, import_node_os.homedir)(), ".claude", "teams");
}
function getTeamDir(teamName) {
  return (0, import_node_path.join)(getTeamsDir(), sanitizeTeamName(teamName));
}
function getTeamConfigPath(teamName) {
  return (0, import_node_path.join)(getTeamDir(teamName), "config.json");
}
function getLeaderInboxPath(teamName) {
  return (0, import_node_path.join)(getTeamDir(teamName), "inboxes", "team-lead.json");
}
var import_node_os, import_node_path;
var init_paths = __esm({
  "src/flow/paths.ts"() {
    "use strict";
    import_node_os = require("os");
    import_node_path = require("path");
  }
});

// src/flow/cleanup.ts
var import_promises3 = require("fs/promises");
init_paths();

// src/flow/registry.ts
var import_promises = require("fs/promises");
var import_node_path2 = require("path");
var import_promises2 = require("timers/promises");
init_paths();
async function readRegistry(sessionShortId, registryPath) {
  const path = registryPath ?? getFlowRegistryPath(sessionShortId);
  try {
    const raw = await (0, import_promises.readFile)(path, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function killBridge(pid) {
  if (!isPidAlive(pid)) return true;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return !isPidAlive(pid);
  }
  for (let i = 0; i < 20; i++) {
    await (0, import_promises2.setTimeout)(100);
    if (!isPidAlive(pid)) return true;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
  }
  return !isPidAlive(pid);
}

// src/flow/cleanup.ts
var MAX_STDIN_BYTES = 64 * 1024;
async function readStdin() {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks = [];
    process.stdin.on("data", (chunk) => {
      received += chunk.length;
      if (received > MAX_STDIN_BYTES) {
        reject(new Error("stdin too large"));
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch (err) {
        reject(new Error(`failed to parse hook input JSON: ${err.message}`));
      }
    });
    process.stdin.on("error", reject);
  });
}
async function main() {
  const input = await readStdin();
  const sessionId = input.session_id;
  if (!sessionId) {
    console.error("[flow-cleanup] no session_id in hook input, exiting");
    process.exit(0);
  }
  const { getFlowRegistryPath: getFlowRegistryPath2 } = await Promise.resolve().then(() => (init_paths(), paths_exports));
  const sessionShortId = sessionId.slice(0, 8);
  const registryPath = getFlowRegistryPath2(sessionShortId);
  const entry = await readRegistry(sessionShortId, registryPath);
  if (!entry) {
    process.exit(0);
  }
  await killBridge(entry.pid);
  await (0, import_promises3.rm)(entry.teamDir ?? getTeamDir(entry.teamName), { recursive: true, force: true });
  await (0, import_promises3.rm)(registryPath, { force: true });
  console.error(`[flow-cleanup] cleaned session ${sessionShortId}`);
}
main().catch((err) => {
  console.error(`[flow-cleanup] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
//# sourceMappingURL=flow-cleanup.js.map