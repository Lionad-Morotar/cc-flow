# INTEGRATIONS

> cc-flow 与外部系统/进程的集成点、接口契约与脆弱性。

## 集成全景

```
                          ┌───────────────────────────┐
                          │  Claude Code（外部进程）    │
                          │  黑盒，我们只通过文件契约   │
                          └───────────────────────────┘
                              ▲              ▲
              fs read         │              │  fs write (原子 rename)
              (polling 1s)    │              │
                              │              │
        ┌─────────────────────┴──────────────┴─────────────────┐
        │  ~/.claude/teams/<dir>/                               │
        │    ├─ config.json    (CC 写, bridge 读检测存在性)      │
        │    └─ inboxes/team-lead.json  (bridge 写, CC 读)      │
        └───────────────────────────────────────────────────────┘
                              ▲
                              │  fs (registry)
                              │
        ┌─────────────────────┴────────────────────────────────┐
        │  ~/.claude/cc-flow/<shortId>.json  (cc-flow 私有)     │
        └───────────────────────────────────────────────────────┘

  ┌──────────────────────┐  HTTP 127.0.0.1   ┌──────────────────┐
  │  第三方 Flow 进程     │ ────────────────> │  cc-flow bridge  │
  │  (任意语言, 示例: mjs) │   POST /inject     │  (Node 进程)     │
  └──────────────────────┘                    └──────────────────┘

  ┌──────────────────────┐  MCP tool call     ┌──────────────────┐
  │  另一个 CC 会话       │ ────────────────> │  cc-flow MCP     │
  │  (cc-flow MCP server) │  list / send       │  server          │
  └──────────────────────┘                    └──────────────────┘
                                                       │
                                                       ▼ HTTP 127.0.0.1
                                               ┌──────────────────┐
                                               │  cc-flow bridge  │
                                               └──────────────────┘
```

## 1. Claude Code Team Mailbox（核心集成）

**性质**：文件系统契约，非 API 调用。

### 文件路径契约

| 文件 | 路径 | 谁写 | 谁读 |
|---|---|---|---|
| Team 目录 | `~/.claude/teams/<dir>/` | CC Agent 工具创建 | bridge/bootstrap 枚举 |
| Team config | `<dir>/config.json` | CC | bridge 每 2s `access` 检测存在性；bootstrap/team-resolve 读 `leadSessionId` |
| Leader inbox | `<dir>/inboxes/team-lead.json` | cc-flow bridge 追加 | CC useInboxPoller 每 1s 读 |

### 数据形状契约

**`config.json`**（cc-flow 只关心一个字段）：

```ts
type TeamConfig = {
  name?: string
  leadSessionId?: string  // ★ bootstrap 用此字段反向定位真实目录
  leadAgentId?: string
}
```

**`team-lead.json`**（cc-flow 写、CC 读；JSON 数组）：

```ts
type FlowMessage = {
  from: string       // 标识来源，默认 'flow'
  text: string       // ★ 必填，非空，≤100KB
  summary?: string   // 摘要
  color?: string     // 颜色提示（如 'cyan'）
  timestamp: string  // ISO 8601，bridge 用 new Date().toISOString()
  read: boolean      // ★ 必须 false；CC 消费后会改
}
```

`FlowMessage` 是 CC `TeammateMessage` 的**子集镜像**（注释明示），让 CC `useInboxPoller` 无需改动即可消费。

### 脆弱性分析

| 假设 | 风险等级 | 缓解 |
|---|---|---|
| CC 不变 team 目录布局 | 中 | paths.ts 集中管理，改一处即可 |
| CC `config.json` 含 `leadSessionId` 字段 | 中 | 注释明确说明是反向工程，见 `team-resolve.ts` |
| CC `useInboxPoller` 频率/格式不变 | 低 | 消费侧，cc-flow 不依赖实现 |
| Agent 工具创建目录命名规则不变（`session-<shortId>`） | **N/A** | 已规避：cc-flow 不依赖具体命名，用 `leadSessionId` 反向查 |
| `TeammateMessage` JSON 字段不变 | 低 | FlowMessage 是子集，CC 加字段不影响 |

## 2. 第三方 Flow 进程（HTTP 契约）

**性质**：本地 HTTP，localhost only。

### Endpoint: `POST /inject`

**请求**：

```http
POST /inject HTTP/1.1
Host: 127.0.0.1:<port>
Authorization: Bearer <token>
Content-Type: application/json

{
  "text": "Current hour: 14:00",     // 必填，非空 string，≤100KB
  "summary": "整点报时",              // 可选 string
  "color": "cyan",                    // 可选 string
  "from": "hourly-flow"               // 可选 string，缺省 'flow'
}
```

**响应**：

| 状态码 | 触发条件 | 响应体 |
|---|---|---|
| 200 | 成功 | `{ ok: true, timestamp: "<ISO>" }` |
| 400 | body 非对象 / text 缺失或空 | `{ ok: false, error: "..." }` |
| 400 | JSON 解析失败 | `{ ok: false, error: "Invalid JSON body" }` |
| 401 | 缺/错 Authorization | `{ ok: false, error: "Unauthorized" }` |
| 403 | remote 不是 localhost（防御层） | `{ ok: false, error: "Forbidden: localhost only" }` |
| 404 | 其他 path/method | `{ ok: false, error: "Not found" }` |
| 413 | body > 110KB 或 text > 100KB | `{ ok: false, error: "..." }` |
| 500 | 未预期错误 | `{ ok: false, error: "Internal error" }` |

**硬限制**：
- `MAX_BODY_BYTES = 110KB`（collectBody 边收边判断，超限立即拒绝）
- `MAX_TEXT_BYTES = 100KB`（解析后再校验）

### Endpoint: `GET /status`

**响应 200**：

```json
{
  "ok": true,
  "teamName": "cc-flow-<shortId>",
  "port": 12345,
  "queueLength": 2    // 未读消息数
}
```

同样要求 Bearer token。

### 示例客户端

`src/flow/examples/flow-hourly.mjs`（93 行）：用 `node:http.request` 直接 POST，无任何依赖。展示了 Flow 进程的最小契约：拿到 `port` 和 `token` 即可工作。

## 3. Claude Code Plugin 系统（运行时入口）

**性质**：声明式 plugin 定义 + 约定的文件布局。

### Plugin 定义文件

`.claude-plugin/marketplace.json`：marketplace 入口，指向 `./plugin`。

`plugin/.claude-plugin/plugin.json`：plugin 元数据 + MCP server 配置。

```json
{
  "name": "cc-flow",
  "version": "0.2.0",
  "mcpServers": {
    "cc-flow": {
      "type": "stdio",
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/cc-flow-mcp.js"]
    }
  }
}
```

### Plugin 文件布局约定

```
~/.claude/plugins/cache/{marketplace}/cc-flow/{version}/
├── .claude-plugin/plugin.json
├── hooks/hooks.json
├── skills/open-bridge/SKILL.md
└── scripts/
    ├── flow-bootstrap.js
    ├── flow-bridge.js
    ├── flow-cleanup.js
    └── cc-flow-mcp.js
```

### Skill 命令

`plugin/skills/open-bridge/SKILL.md`，YAML frontmatter：

```yaml
---
name: cc-flow:open-bridge
description: 在当前 CC 会话启动 cc-flow bridge，让外部进程可以通过 HTTP 或 MCP 工具向本会话注入上下文
argument-hint: "[--off | description]"
---
```

命令为 `/cc-flow:open-bridge`。

### Skill ↔ bootstrap 输出契约

bootstrap 通过 stdout 输出机器可解析格式，skill 用正则提取：

| 信号 | 正则 |
|---|---|
| `FLOW_BRIDGE_LISTENING port=<p>` | `/FLOW_BRIDGE_LISTENING port=(\d+)/` |
| `FLOW_BRIDGE_STARTED port=<p> token=<t> pid=<p> registry=<r>` | `/FLOW_BRIDGE_STARTED port=(\d+) token=(\S+) pid=(\d+) registry=(\S+)/` |
| `FLOW_BRIDGE_ALREADY_RUNNING port=<p> token=<t> pid=<p> registry=<r>` | （skill 直接复用） |
| `FLOW_OFF: cleaned <n> session(s)` | （skill 汇报用户） |

**修改这些字面量需要同步改 SKILL.md**，否则 skill 解析失败。

### Skill ↔ CC Agent 工具契约

SKILL.md 要求 CC 用 Agent 工具创建占位 teammate：

```json
{
  "description": "cc-flow teammate flow",
  "prompt": "You are cc-flow flow, a teammate for keep communicate bridge alive...",
  "name": "cc-flow-bridge",
  "model": "haiku",
  "run_in_background": true
}
```

**关键时序**：bootstrap `start` 调用 `resolveTeamDirBySession(sessionId)`，要求 team 目录已经存在；若 Agent 工具还没创建 teammate，bootstrap 立即 fail-fast。所以 SKILL.md 中"创建 teammate"必须在"运行 bootstrap"之前。

### SessionEnd Hook

`plugin/hooks/hooks.json` 注册 `SessionEnd` hook，调用 `flow-cleanup.js`。该脚本从 stdin JSON 读取 `session_id`，清理对应 registry、bridge、team 目录。

## 4. MCP Server 集成

**性质**：stdio MCP server，每 CC 会话由 Claude Code 独立 spawn。

### 工具列表

| 工具 | 输入 | 输出 |
|---|---|---|
| `list` | 无 | 有效 cc-flow 会话列表（含 description、project、port、pid） |
| `send` | `{ sessionShortId: string, text: string, from?: string }` | `{ ok: true, timestamp }` 或 `{ ok: false, error }` |

### MCP server ↔ bridge 契约

MCP server 从 registry 读取目标会话的 `port` 和 `authToken`，向 `127.0.0.1:<port>/inject` 发送 HTTP POST。请求/响应与第 2 节 HTTP 契约相同。

`send` 对 `text` 做 20KB 本地校验，超过时直接返回错误，不调用 bridge。

## 5. 注册表（私有状态）

**性质**：cc-flow 自管，不与 CC 共享。

| 路径 | 形状 |
|---|---|
| `~/.claude/cc-flow/<sessionShortId>.json` | `FlowRegistryEntry`（见 types.ts） |

```ts
type ProjectInfo = {
  name: string
  path: string
  rootPath: string
}

type FlowRegistryEntry = {
  sessionId: string
  sessionShortId: string
  teamName: string
  teamDir?: string  // ★ 真实 team 目录，用于 --off 删除
  port: number
  pid: number
  authToken: string
  startedAt: string
  description: string
  project: ProjectInfo
}
```

注意：`authToken` 以**明文**存盘（CONCERNS 中标记）。任何能读 `~/.claude/cc-flow/` 的本机进程都能拿到 token，向对应 bridge 发请求。

## 6. 与 CC 进程退出/Compact 的集成

| CC 事件 | bridge 反应 |
|---|---|
| CC 正常退出（调用 `cleanupSessionTeams()`） | team 目录被删 → bridge 下次 `access(config.json)` 失败 → 2s 内 `process.exit(0)`，并删除 registry |
| 用户按 ESC（保留会话） | 不影响 bridge，继续运行 |
| CC 进程崩溃 | team 目录可能残留 → bridge 继续运行直到用户手动 `--off` 或 SessionEnd hook 触发 |
| CC 执行 Compact | team 目录不变 → bridge 不受影响（ADR 决策之一） |
