# STRUCTURE

> cc-flow 的目录与文件组织。源码极薄（8 个 TS 文件 + 1 个示例 mjs + plugin 元数据），测试镜像源码结构。

## 顶层目录树

```
cc-flow/
├── .claude-plugin/
│   └── marketplace.json            # marketplace 入口
├── plugin/
│   ├── .claude-plugin/
│   │   └── plugin.json             # plugin 元数据 + mcpServers
│   ├── hooks/
│   │   └── hooks.json              # SessionEnd cleanup
│   ├── skills/
│   │   └── open-bridge/
│   │       └── SKILL.md            # /cc-flow:open-bridge skill
│   └── scripts/                    # tsup 产物（gitignore map，pnpm build 生成）
│       ├── flow-bridge.js
│       ├── flow-bootstrap.js
│       ├── flow-cleanup.js
│       └── cc-flow-mcp.js
├── src/flow/                       # 核心源码
│   ├── bootstrap.ts                # skill 调用入口：spawn bridge、--off 清理
│   ├── bridge.ts                   # HTTP bridge 进程：接收 /inject、写 mailbox、生命周期绑定
│   ├── cleanup.ts                  # SessionEnd hook 清理脚本
│   ├── mailbox.ts                  # leader mailbox 的原子读写
│   ├── project-info.ts             # 从 cwd 推断项目信息
│   ├── registry.ts                 # per-session 注册表读写、幂等检查、PID 清理
│   ├── paths.ts                    # 路径约定（镜像 CC 的 team/mailbox 布局）
│   ├── team-resolve.ts             # 按 session 反向探测真实 team 目录
│   ├── types.ts                    # FlowMessage / FlowRegistryEntry / ProjectInfo
│   └── examples/
│       └── flow-hourly.mjs         # MVP 示例：整点报时 Flow
├── src/mcp/
│   └── server.ts                   # cc-flow MCP server（list / send）
├── tests/flow/                     # 测试（1:1 对应源码 + 集成）
│   ├── bootstrap.test.ts
│   ├── bridge.test.ts
│   ├── cleanup.test.ts
│   ├── integration.test.ts         # e2e：enable → inject → status → off
│   ├── mailbox.test.ts
│   ├── paths.test.ts
│   ├── project-info.test.ts
│   ├── registry.test.ts
│   └── team-resolve.test.ts
├── tests/mcp/
│   └── server.test.ts              # MCP server 测试
├── docs/
│   ├── adr/
│   │   └── 2026-06-20-flow-mailbox-injection.md
│   ├── plans/
│   │   ├── 2026-06-20-claude-code-flow.md   # gitignore 本地查阅
│   │   └── 2026-06-25-cc-flow-mcp-plugin.md
│   ├── tdd/
│   │   └── 2026-06-25-cc-flow-mcp-plugin.md
│   └── ultrathoughts/
│       └── 2026-06-25-cc-flow-mcp-plugin.md
├── .planning/codebase/             # 本目录（gsd 产物）
├── CONTEXT.md                      # 领域术语表
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── .gitignore
├── .npmrc
├── README.md
├── LICENSE                         # PolyForm-Noncommercial-1.0.0
└── pnpm-lock.yaml
```

## 源码模块清单（src/）

### src/flow/

| 文件 | 职责 | 导出 |
|---|---|---|
| `types.ts` | 共享类型 | `FlowMessage`, `FlowRegistryEntry`, `ProjectInfo` |
| `paths.ts` | 所有路径约定 + env 覆盖 | `getProjectRoot`, `getFlowRegistryDir/Path`, `sanitizeTeamName`, `getTeamsDir`, `getTeamDir`, `getTeamConfigPath`, `getLeaderInboxPath` |
| `team-resolve.ts` | 反向定位真实 team 目录 | `TeamConfig`, `readTeamConfig`, `resolveTeamDirBySession` |
| `mailbox.ts` | mailbox 原子读写 + 进程内串行队列 | `readMailbox`, `appendToMailbox`, `clearMailbox` |
| `registry.ts` | 注册表 CRUD + PID 管理 | `ensureRegistryDir`, `readRegistry`, `writeRegistry`, `listRegistries`, `isPidAlive`, `killBridge`, `cleanupByRegistry` |
| `project-info.ts` | 从 cwd 推断项目名/路径/根目录 | `ProjectInfo`, `inferProjectInfo` |
| `bridge.ts` | HTTP bridge 全部逻辑 | `startBridge` |
| `bootstrap.ts` | CLI 入口（start / --off） | `main` |
| `cleanup.ts` | SessionEnd hook 清理入口 | `main` |

### src/mcp/

| 文件 | 职责 | 导出 |
|---|---|---|
| `server.ts` | MCP server：注册 list / send 工具 | `createMcpServer`, `main` |

## 模块依赖图（源码层面）

```
bootstrap.ts
  ├─ registry.ts
  │    └─ paths.ts
  ├─ team-resolve.ts
  │    └─ paths.ts
  ├─ project-info.ts
  ├─ paths.ts
  └─ types.ts

cleanup.ts
  ├─ registry.ts
  ├─ paths.ts
  └─ types.ts

bridge.ts
  ├─ mailbox.ts
  ├─ paths.ts
  └─ types.ts

mcp/server.ts
  ├─ registry.ts
  ├─ paths.ts
  └─ types.ts
```

## 文件长度健康度

所有源码文件 ≤ 350 行。`server.ts` 接近阈值，但因工具注册逻辑集中，保持单文件可读。

## 发布载荷

Claude Code plugin 从 GitHub 直接加载，不依赖 npm 发布。`package.json` 的 `files` 字段包含：

- `plugin/`：skill、hooks、plugin 元数据、构建产物
- `.claude-plugin/`：marketplace 入口
- `src/`、README、LICENSE

构建产物 `plugin/scripts/*.js` 需要提交到 Git（plugin 安装时不执行构建）。`*.map` 仍由 `.gitignore` 忽略。

## gitignore 关键项

- `node_modules/`、`dist/`、`*.tsbuildinfo`、`coverage/`、`.DS_Store`、`.env`、`*.map`
- 注意：`plugin/scripts/*.js` **不忽略**，因为 plugin 从 GitHub 安装后直接运行这些文件。

## 测试目录结构

| 测试文件 | 被测对象 |
|---|---|
| `tests/flow/paths.test.ts` | `paths.ts` |
| `tests/flow/team-resolve.test.ts` | `team-resolve.ts` |
| `tests/flow/mailbox.test.ts` | `mailbox.ts` |
| `tests/flow/registry.test.ts` | `registry.ts` |
| `tests/flow/project-info.test.ts` | `project-info.ts` |
| `tests/flow/bridge.test.ts` | `bridge.ts` |
| `tests/flow/bootstrap.test.ts` | `bootstrap.ts` |
| `tests/flow/cleanup.test.ts` | `cleanup.ts` |
| `tests/flow/integration.test.ts` | 全链路 |
| `tests/mcp/server.test.ts` | MCP server |
