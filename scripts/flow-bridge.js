#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/flow/bridge.ts
var bridge_exports = {};
__export(bridge_exports, {
  startBridge: () => startBridge
});
module.exports = __toCommonJS(bridge_exports);
var import_node_http = require("http");
var import_promises3 = require("fs/promises");
var import_node_path4 = require("path");
var import_node_timers = require("timers");

// src/flow/mailbox.ts
var import_promises = require("fs/promises");
var import_node_path = require("path");
async function readMailbox(inboxPath) {
  try {
    const raw = await (0, import_promises.readFile)(inboxPath, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
var MailboxQueue = class {
  pending = /* @__PURE__ */ new Map();
  async run(inboxPath, fn) {
    const prev = this.pending.get(inboxPath) ?? Promise.resolve();
    const next = prev.then(fn, fn).finally(() => {
      if (this.pending.get(inboxPath) === next) {
        this.pending.delete(inboxPath);
      }
    });
    this.pending.set(inboxPath, next);
    return next;
  }
};
var queue = new MailboxQueue();
async function appendToMailbox(inboxPath, message) {
  await queue.run(inboxPath, async () => {
    await (0, import_promises.mkdir)((0, import_node_path.dirname)(inboxPath), { recursive: true });
    const existing = await readMailbox(inboxPath);
    const next = { ...message, read: false };
    await writeMailbox(inboxPath, [...existing, next]);
  });
}
async function writeMailbox(inboxPath, messages) {
  const tmp = `${inboxPath}.tmp`;
  await (0, import_promises.writeFile)(tmp, JSON.stringify(messages, null, 2) + "\n", "utf-8");
  await (0, import_promises.rename)(tmp, inboxPath);
}

// src/flow/paths.ts
var import_node_os = require("os");
var import_node_path2 = require("path");
function sanitizeTeamName(name) {
  return name.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
}
function getTeamsDir() {
  return process.env.CC_FLOW_TEAMS_DIR ?? (0, import_node_path2.join)((0, import_node_os.homedir)(), ".claude", "teams");
}
function getTeamDir(teamName) {
  return (0, import_node_path2.join)(getTeamsDir(), sanitizeTeamName(teamName));
}
function getTeamConfigPath(teamName) {
  return (0, import_node_path2.join)(getTeamDir(teamName), "config.json");
}
function getLeaderInboxPath(teamName) {
  return (0, import_node_path2.join)(getTeamDir(teamName), "inboxes", "team-lead.json");
}

// src/flow/tmp-files.ts
var import_node_crypto = require("crypto");
var import_promises2 = require("fs/promises");
var import_node_path3 = require("path");
var import_sharp = __toESM(require("sharp"));
var TMP_DIR = "/tmp/cc-flow/node-shots";
var tmpFilesDir = TMP_DIR;
var THUMB_TARGET_BYTES = 200 * 1024;
var FULL_MAX_BYTES = 3 * 1024 * 1024;
function parseDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]*)$/);
  if (!match) {
    throw new Error("Invalid image data URL: expected data:image/png;base64,... or data:image/jpeg;base64,...");
  }
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length === 0) {
    throw new Error("Empty image data");
  }
  return buffer;
}
async function getMetadata(buffer) {
  const metadata = await (0, import_sharp.default)(buffer).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Failed to read image dimensions");
  }
  return { width: metadata.width, height: metadata.height };
}
async function compressToThumb(buffer) {
  const { width } = await getMetadata(buffer);
  let quality = 80;
  let scale = 1;
  const minQuality = 50;
  const minScale = 0.25;
  const maxIterations = 20;
  let iterations = 0;
  while (iterations < maxIterations) {
    iterations++;
    const targetWidth2 = Math.max(1, Math.round(width * scale));
    const output = await (0, import_sharp.default)(buffer).resize({ width: targetWidth2, withoutEnlargement: true }).webp({ quality, effort: 4 }).toBuffer();
    if (output.length <= THUMB_TARGET_BYTES || quality <= minQuality && scale <= minScale) {
      return output;
    }
    if (quality > minQuality) {
      quality -= 5;
    } else {
      scale *= 0.75;
    }
  }
  const targetWidth = Math.max(1, Math.round(width * scale));
  return (0, import_sharp.default)(buffer).resize({ width: targetWidth, withoutEnlargement: true }).webp({ quality, effort: 4 }).toBuffer();
}
async function compressToFull(buffer) {
  const { width } = await getMetadata(buffer);
  let quality = 90;
  let scale = 1;
  const minQuality = 70;
  const minScale = 0.5;
  const maxIterations = 20;
  let iterations = 0;
  while (iterations < maxIterations) {
    iterations++;
    const targetWidth2 = Math.max(1, Math.round(width * scale));
    const output = await (0, import_sharp.default)(buffer).resize({ width: targetWidth2, withoutEnlargement: true }).webp({ quality, effort: 4 }).toBuffer();
    if (output.length <= FULL_MAX_BYTES || quality <= minQuality && scale <= minScale) {
      return output;
    }
    if (quality > minQuality) {
      quality -= 5;
    } else {
      scale *= 0.9;
    }
  }
  const targetWidth = Math.max(1, Math.round(width * scale));
  return (0, import_sharp.default)(buffer).resize({ width: targetWidth, withoutEnlargement: true }).webp({ quality, effort: 4 }).toBuffer();
}
async function saveScreenshot(dataUrl) {
  const buffer = parseDataUrl(dataUrl);
  const id = (0, import_node_crypto.randomUUID)();
  const dir = (0, import_node_path3.join)(TMP_DIR, id);
  await (0, import_promises2.mkdir)(dir, { recursive: true });
  const fullBuffer = await compressToFull(buffer);
  const fullPath = (0, import_node_path3.join)(dir, "full.webp");
  if (fullBuffer.length <= THUMB_TARGET_BYTES) {
    await (0, import_promises2.writeFile)(fullPath, fullBuffer);
    return { thumb: "", full: fullPath };
  }
  const thumbBuffer = await compressToThumb(buffer);
  const thumbPath = (0, import_node_path3.join)(dir, "thumb.webp");
  await Promise.all([(0, import_promises2.writeFile)(thumbPath, thumbBuffer), (0, import_promises2.writeFile)(fullPath, fullBuffer)]);
  return { thumb: thumbPath, full: fullPath };
}
function safeExt(ext) {
  const cleaned = ext.replace(/[^a-zA-Z0-9]/g, "");
  return cleaned || "txt";
}
async function saveTextFile(content, ext = "txt") {
  const id = (0, import_node_crypto.randomUUID)();
  const dir = (0, import_node_path3.join)(TMP_DIR, id);
  await (0, import_promises2.mkdir)(dir, { recursive: true });
  const path = (0, import_node_path3.join)(dir, `content.${safeExt(ext)}`);
  await (0, import_promises2.writeFile)(path, content, "utf-8");
  return path;
}

// src/flow/token.ts
var import_node_crypto2 = require("crypto");
function safeCompare(provided, expected) {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && (0, import_node_crypto2.timingSafeEqual)(a, b);
}

// src/flow/bridge.ts
var import_promises4 = require("fs/promises");
var MAX_TEXT_BYTES = 100 * 1024;
var MAX_BODY_BYTES = 110 * 1024;
var MAX_TMP_BODY_BYTES = 8 * 1024 * 1024;
var PayloadTooLargeError = class extends Error {
  constructor() {
    super("Payload too large");
  }
};
function parseArgs(argv) {
  let teamName;
  let port;
  let teamDir;
  let teamConfigPath;
  let readyFile;
  let registryPath;
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case "--team":
        teamName = argv[++i];
        break;
      case "--port":
        port = Number(argv[++i]);
        break;
      case "--team-dir":
        teamDir = argv[++i];
        break;
      case "--team-config-path":
        teamConfigPath = argv[++i];
        break;
      case "--ready-file":
        readyFile = argv[++i];
        break;
      case "--registry":
        registryPath = argv[++i];
        break;
    }
  }
  const token = process.env.CC_FLOW_TOKEN;
  delete process.env.CC_FLOW_TOKEN;
  if (!teamName) throw new Error("--team is required");
  if (!token) throw new Error("CC_FLOW_TOKEN env is required");
  if (port == null || Number.isNaN(port)) throw new Error("--port is required");
  return { teamName, port, token, teamDir, teamConfigPath, readyFile, registryPath };
}
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}
function collectBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      received += chunk.length;
      if (received > maxBytes) {
        reject(new PayloadTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
function startBridge(config) {
  const inboxPath = config.teamDir ? (0, import_node_path4.join)(config.teamDir, "inboxes", "team-lead.json") : getLeaderInboxPath(config.teamName);
  const teamConfigPath = config.teamConfigPath ?? (config.teamDir ? (0, import_node_path4.join)(config.teamDir, "config.json") : getTeamConfigPath(config.teamName));
  const server = (0, import_node_http.createServer)(async (req, res) => {
    const remote = req.socket.remoteAddress;
    if (!remote || remote !== "127.0.0.1" && remote !== "::1" && remote !== "::ffff:127.0.0.1") {
      sendJson(res, 403, { ok: false, error: "Forbidden: localhost only" });
      return;
    }
    const auth = req.headers["authorization"] ?? "";
    const credential = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!credential || !safeCompare(credential, config.token)) {
      sendJson(res, 401, { ok: false, error: "Unauthorized" });
      return;
    }
    const url = req.url ?? "";
    const method = req.method ?? "GET";
    try {
      if (method === "POST" && url === "/inject") {
        const raw = await collectBody(req, MAX_BODY_BYTES);
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
          return;
        }
        if (!body || typeof body !== "object") {
          sendJson(res, 400, { ok: false, error: "Body must be an object" });
          return;
        }
        const { text, summary, color, from } = body;
        if (typeof text !== "string" || text.length === 0) {
          sendJson(res, 400, { ok: false, error: "text is required and must be a non-empty string" });
          return;
        }
        if (Buffer.byteLength(text, "utf-8") > MAX_TEXT_BYTES) {
          sendJson(res, 413, { ok: false, error: "text exceeds 100KB limit" });
          return;
        }
        const message = {
          from: typeof from === "string" && from.length > 0 ? from : "flow",
          text,
          summary: typeof summary === "string" ? summary : void 0,
          color: typeof color === "string" ? color : void 0,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        };
        await appendToMailbox(inboxPath, message);
        sendJson(res, 200, { ok: true, timestamp: message.timestamp });
        return;
      }
      if (method === "POST" && url === "/files/tmp") {
        const raw = await collectBody(req, MAX_TMP_BODY_BYTES);
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
          return;
        }
        if (!body || typeof body !== "object") {
          sendJson(res, 400, { ok: false, error: "Body must be an object" });
          return;
        }
        const { dataUrl, content, ext } = body;
        try {
          if (typeof dataUrl === "string" && dataUrl.length > 0) {
            const paths = await saveScreenshot(dataUrl);
            sendJson(res, 200, { ok: true, paths });
            return;
          }
          if (typeof content === "string") {
            const path = await saveTextFile(content, typeof ext === "string" ? ext : "txt");
            sendJson(res, 200, { ok: true, path });
            return;
          }
          sendJson(res, 400, { ok: false, error: "dataUrl or content is required" });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          sendJson(res, 400, { ok: false, error: message });
        }
        return;
      }
      if (method === "GET" && url === "/status") {
        const messages = await readMailbox(inboxPath);
        const unread = messages.filter((m) => !m.read).length;
        sendJson(res, 200, {
          ok: true,
          teamName: config.teamName,
          port: server.address().port,
          queueLength: unread
        });
        return;
      }
      sendJson(res, 404, { ok: false, error: "Not found" });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(res, 413, { ok: false, error: "Payload too large" });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[flow-bridge] request error: ${message}`);
      sendJson(res, 500, { ok: false, error: "Internal error" });
    }
  });
  server.on("error", (err) => {
    console.error(`[flow-bridge] server error: ${err.message}`);
    process.exit(1);
  });
  const lifecycle = (0, import_node_timers.setInterval)(() => {
    void (async () => {
      try {
        await (0, import_promises3.access)(teamConfigPath, import_promises3.constants.F_OK);
      } catch {
        console.error("[flow-bridge] team config gone, exiting");
        (0, import_node_timers.clearInterval)(lifecycle);
        try {
          await (0, import_promises4.rm)(tmpFilesDir, { recursive: true, force: true });
        } catch (err) {
          console.error(`[flow-bridge] failed to remove tmp files: ${err.message}`);
        }
        if (config.registryPath) {
          try {
            await (0, import_promises3.rm)(config.registryPath, { force: true });
          } catch (err) {
            console.error(`[flow-bridge] failed to remove registry: ${err.message}`);
          }
        }
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 2e3).unref();
      }
    })().catch((err) => {
      console.error(`[flow-bridge] lifecycle error: ${err.message}`);
      (0, import_node_timers.clearInterval)(lifecycle);
      process.exit(1);
    });
  }, 2e3);
  server.listen(config.port, "127.0.0.1", async () => {
    const address = server.address();
    console.error(`FLOW_BRIDGE_LISTENING port=${address.port}`);
    if (config.readyFile) {
      try {
        await (0, import_promises3.writeFile)(config.readyFile, String(address.port), "utf-8");
      } catch (err) {
        console.error(`[flow-bridge] failed to write ready file: ${err.message}`);
      }
    }
  });
  return server;
}
if (process.argv[1]?.endsWith("flow-bridge.js") || process.argv[1]?.endsWith("flow-bridge")) {
  const config = parseArgs(process.argv);
  startBridge(config);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  startBridge
});
//# sourceMappingURL=flow-bridge.js.map