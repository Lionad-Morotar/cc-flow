#!/usr/bin/env node
"use strict";

// src/flow/bootstrap.ts
var import_node_child_process = require("child_process");
var import_promises6 = require("fs/promises");
var import_node_path5 = require("path");
var import_node_os3 = require("os");
var import_promises7 = require("timers/promises");

// src/flow/registry.ts
var import_promises = require("fs/promises");
var import_node_path2 = require("path");
var import_promises2 = require("timers/promises");

// src/flow/paths.ts
var import_node_os = require("os");
var import_node_path = require("path");
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

// src/flow/registry.ts
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
async function writeRegistry(entry, registryPath) {
  const path = registryPath ?? getFlowRegistryPath(entry.sessionShortId);
  await (0, import_promises.mkdir)((0, import_node_path2.dirname)(path), { recursive: true, mode: 448 });
  const tmp = `${path}.tmp`;
  await (0, import_promises.writeFile)(tmp, JSON.stringify(entry, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 384
  });
  await (0, import_promises.rename)(tmp, path);
}
async function listRegistries(registryDir) {
  const dir = registryDir ?? getFlowRegistryDir();
  try {
    const names = await (0, import_promises.readdir)(dir);
    const results = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const fullPath = `${dir}/${name}`;
      try {
        const raw = await (0, import_promises.readFile)(fullPath, "utf-8");
        results.push({ path: fullPath, entry: JSON.parse(raw) });
      } catch {
      }
    }
    return results;
  } catch (error) {
    if (error.code === "ENOENT") return [];
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

// src/flow/token.ts
var import_node_crypto = require("crypto");
function generateToken() {
  return (0, import_node_crypto.randomBytes)(32).toString("hex");
}

// src/flow/team-resolve.ts
var import_promises3 = require("fs/promises");
var import_node_path3 = require("path");
async function readTeamConfig(teamDir) {
  try {
    const raw = await (0, import_promises3.readFile)((0, import_node_path3.join)(teamDir, "config.json"), "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function resolveTeamDirBySession(sessionId) {
  const teamsDir = getTeamsDir();
  let names;
  try {
    names = await (0, import_promises3.readdir)(teamsDir);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  for (const name of names) {
    const teamDir = (0, import_node_path3.join)(teamsDir, name);
    const config = await readTeamConfig(teamDir);
    if (config?.leadSessionId === sessionId) return teamDir;
  }
  return null;
}
async function createTeamForSession(teamDir, sessionId) {
  const name = (0, import_node_path3.basename)(teamDir);
  const config = {
    name,
    createdAt: Date.now(),
    leadAgentId: `team-lead@${name}`,
    leadSessionId: sessionId,
    members: [
      {
        agentId: `team-lead@${name}`,
        name: "team-lead",
        agentType: "team-lead",
        joinedAt: Date.now(),
        tmuxPaneId: "leader",
        cwd: process.cwd(),
        subscriptions: [],
        backendType: "in-process"
      }
    ]
  };
  await (0, import_promises3.mkdir)((0, import_node_path3.join)(teamDir, "inboxes"), { recursive: true });
  await (0, import_promises3.writeFile)((0, import_node_path3.join)(teamDir, "config.json"), JSON.stringify(config, null, 2) + "\n", "utf-8");
  await (0, import_promises3.writeFile)((0, import_node_path3.join)(teamDir, "inboxes", "team-lead.json"), "[]\n", "utf-8");
}

// src/flow/project-info.ts
var import_promises4 = require("fs/promises");
var import_node_path4 = require("path");
var import_promises5 = require("fs/promises");
var import_node_os2 = require("os");
async function findProjectRoot(startDir) {
  let current = startDir;
  while (true) {
    const markers = await Promise.all([
      fileExists((0, import_node_path4.join)(current, "package.json")),
      directoryExists((0, import_node_path4.join)(current, ".git"))
    ]);
    if (markers[0] || markers[1]) return current;
    const parent = (0, import_node_path4.dirname)(current);
    if (parent === current) break;
    current = parent;
  }
  return startDir;
}
async function readPackageName(projectRoot) {
  try {
    const raw = await (0, import_promises4.readFile)((0, import_node_path4.join)(projectRoot, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    return typeof pkg.name === "string" && pkg.name.length > 0 ? pkg.name : void 0;
  } catch {
    return void 0;
  }
}
async function fileExists(path) {
  try {
    const s = await (0, import_promises4.stat)(path);
    return s.isFile();
  } catch {
    return false;
  }
}
async function directoryExists(path) {
  try {
    const s = await (0, import_promises4.stat)(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}
async function inferProjectInfo() {
  const path = await (0, import_promises5.realpath)(process.cwd());
  const rootPath = await findProjectRoot(path);
  const isNodeProject = await fileExists((0, import_node_path4.join)(rootPath, "package.json")) && rootPath !== (0, import_node_os2.homedir)();
  const name = isNodeProject ? await readPackageName(rootPath) ?? rootPath : rootPath;
  return { name, path, rootPath };
}

// src/flow/bootstrap.ts
var BRIDGE_BUNDLE = "flow-bridge.js";
var MAX_DESCRIPTION_CHARS = 100;
function sanitizeDescription(input, projectName, sessionShortId) {
  if (!input || input.trim().length === 0) {
    return `CC session ${sessionShortId} @ ${projectName}`;
  }
  const trimmed = input.trim();
  if (trimmed.length <= MAX_DESCRIPTION_CHARS) return trimmed;
  return trimmed.slice(0, MAX_DESCRIPTION_CHARS);
}
function findBridgeBundle() {
  const bootstrapPath = process.argv[1];
  if (!bootstrapPath) throw new Error("Cannot determine bootstrap path");
  return `${(0, import_node_path5.dirname)(bootstrapPath)}/${BRIDGE_BUNDLE}`;
}
function parseArgs(argv) {
  const mode = argv.includes("--off") ? "off" : "start";
  const get = (flag) => {
    const idx = argv.indexOf(flag);
    if (idx < 0 || idx + 1 >= argv.length) return void 0;
    const val = argv[idx + 1];
    if (val.startsWith("-")) return void 0;
    return val;
  };
  if (mode === "off") {
    return { mode, args: { registryPath: get("--registry") } };
  }
  const team = get("--team");
  const port = Number(get("--port"));
  const sessionId = get("--session-id");
  const registryPath = get("--registry");
  const description = get("--description");
  const teamDir = get("--team-dir");
  if (!team) throw new Error("--team is required");
  if (!Number.isFinite(port)) throw new Error("--port is required");
  if (!sessionId) throw new Error("--session-id is required");
  if (sessionId.length < 8) throw new Error("--session-id must be at least 8 characters");
  if (!registryPath) throw new Error("--registry is required");
  return { mode: "start", args: { team, port, sessionId, registryPath, description, teamDir } };
}
async function waitForReadyFile(path, timeoutMs = 5e3) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const raw = await (0, import_promises6.readFile)(path, "utf-8");
      const port = Number(raw.trim());
      if (Number.isFinite(port)) return port;
    } catch {
    }
    await (0, import_promises7.setTimeout)(50);
  }
  throw new Error("Timed out waiting for bridge ready file");
}
function resolveToken() {
  const override = process.env.CC_FLOW_TOKEN;
  if (override === void 0) return generateToken();
  if (override.length < 32) {
    throw new Error(
      `CC_FLOW_TOKEN override too weak (${override.length} chars, need >= 32). Unset it to let bootstrap generate a 256bit token.`
    );
  }
  return override;
}
async function start(args) {
  const sessionShortId = args.sessionId.slice(0, 8);
  const token = resolveToken();
  let teamDir = args.teamDir ?? await resolveTeamDirBySession(args.sessionId);
  if (!teamDir) {
    teamDir = args.teamDir ?? getTeamDir(`session-${sessionShortId}`);
  }
  const existingConfig = await readTeamConfig(teamDir);
  if (existingConfig) {
    if (existingConfig.leadSessionId !== args.sessionId) {
      throw new Error(
        `Team directory ${teamDir} exists but leadSessionId (${existingConfig.leadSessionId}) does not match session ${args.sessionId}. Refusing to use an alien team directory.`
      );
    }
  } else {
    await createTeamForSession(teamDir, args.sessionId);
  }
  const existing = await readRegistry(sessionShortId, args.registryPath);
  if (existing && isPidAlive(existing.pid)) {
    console.log(
      `FLOW_BRIDGE_ALREADY_RUNNING port=${existing.port} pid=${existing.pid} registry=${args.registryPath}`
    );
    return;
  }
  const project = await inferProjectInfo();
  const description = sanitizeDescription(args.description, project.name, sessionShortId);
  const entry = {
    sessionId: args.sessionId,
    sessionShortId,
    teamName: args.team,
    teamDir,
    port: args.port,
    pid: process.pid,
    // temporary, replaced after spawn
    authToken: token,
    startedAt: (/* @__PURE__ */ new Date()).toISOString(),
    description,
    project
  };
  const readyDir = await (0, import_promises6.mkdtemp)((0, import_node_path5.join)((0, import_node_os3.tmpdir)(), "cc-flow-ready-"));
  const readyFile = `${readyDir}/ready`;
  const stderrLog = `${readyDir}/stderr.log`;
  const bridgePath = findBridgeBundle();
  const stderrFd = await (0, import_promises6.open)(stderrLog, "w");
  const child = (0, import_node_child_process.spawn)(
    process.execPath,
    [
      bridgePath,
      "--team",
      args.team,
      "--team-dir",
      teamDir,
      "--port",
      String(args.port),
      "--ready-file",
      readyFile,
      "--registry",
      args.registryPath
    ],
    {
      detached: true,
      stdio: ["ignore", "ignore", stderrFd.fd],
      // Pass the token via env, not argv, so it never appears in
      // /proc/<pid>/cmdline (which is world-readable on Linux) or ps output.
      env: { ...process.env, CC_FLOW_TOKEN: token }
    }
  );
  child.unref();
  if (child.pid === void 0) {
    await stderrFd.close();
    throw new Error("Failed to spawn Flow Bridge process: no pid assigned");
  }
  entry.pid = child.pid;
  const spawnError = new Promise((_, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) reject(new Error(`Bridge process exited with code ${code}`));
    });
  });
  let actualPort;
  try {
    actualPort = await Promise.race([waitForReadyFile(readyFile), spawnError]);
  } catch (error) {
    let stderr = "";
    try {
      stderr = await (0, import_promises6.readFile)(stderrLog, "utf-8");
    } catch {
    }
    await stderrFd.close();
    if (stderr.trim()) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} (bridge stderr: ${stderr.trim()})`
      );
    }
    throw error;
  }
  await stderrFd.close();
  entry.port = actualPort;
  await (0, import_promises6.rm)(readyDir, { recursive: true, force: true });
  await writeRegistry(entry, args.registryPath);
  console.log(
    `FLOW_BRIDGE_STARTED port=${entry.port} pid=${entry.pid} registry=${args.registryPath}`
  );
}
async function off(args) {
  const targets = [];
  if (args.registryPath) {
    const shortId = (0, import_node_path5.basename)(args.registryPath, ".json");
    const entry = await readRegistry(shortId, args.registryPath);
    if (entry) targets.push({ path: args.registryPath, entry });
  } else {
    targets.push(...await listRegistries());
  }
  if (targets.length === 0) {
    console.log("FLOW_OFF: no active Flow sessions found");
    return;
  }
  const results = [];
  for (const { path, entry } of targets) {
    if (!isTrustedRegistryEntry(entry)) {
      console.error(
        `[flow-bootstrap] skipping untrusted registry entry ${path}: teamName=${entry.teamName}`
      );
      continue;
    }
    const killed = await killBridge(entry.pid);
    await (0, import_promises6.rm)(entry.teamDir ?? getTeamDir(entry.teamName), { recursive: true, force: true });
    await (0, import_promises6.rm)(path, { force: true });
    results.push({ teamName: entry.teamName, killed });
  }
  console.log(`FLOW_OFF: cleaned ${results.length} session(s)`);
  for (const r of results) {
    console.log(`  - ${r.teamName} (killed=${r.killed})`);
  }
}
function isTrustedRegistryEntry(entry) {
  if (!entry.teamName || typeof entry.teamName !== "string") return false;
  if (!entry.teamName.startsWith("cc-flow-")) return false;
  if (sanitizeTeamName(entry.teamName) !== entry.teamName) return false;
  if (entry.sessionShortId !== entry.sessionId.slice(0, 8)) return false;
  return true;
}
async function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.mode === "start") {
    await start(parsed.args);
  } else {
    await off(parsed.args);
  }
}
main(process.argv).catch((err) => {
  console.error(`[flow-bootstrap] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
//# sourceMappingURL=flow-bootstrap.js.map