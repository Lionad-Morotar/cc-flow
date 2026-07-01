# STACK

> cc-flow 的技术栈与运行时依赖。项目刻意保持极薄依赖，核心逻辑仅靠 Node 标准库完成；MCP server 产物内部 bundle 了官方 SDK。

## 语言与运行时

| 维度 | 选择 | 说明 |
|---|---|---|
| 语言 | TypeScript 5.5+ (`strict: true`) | target ES2022 / module NodeNext |
| 运行时 | Node.js ≥ 18.0.0 (`engines.node`) | 核心仅用标准库 `node:fs`、`node:http`、`node:child_process`、`node:crypto`、`node:os`、`node:path`、`node:timers`、`node:net` |
| 模块系统（源码） | ESM (`.js` 扩展的 import 路径配 NodeNext) | 见 `tsconfig.json`：`module: NodeNext`, `moduleResolution: NodeNext` |
| 模块系统（产物） | CJS single-file bundle | tsup 产出，加 `#!/usr/bin/env node` banner，让最终用户直接 `node flow-bridge.js` |
| 包管理器 | pnpm（含 pnpm-lock.yaml） | `.npmrc`：`shamefully-hoist=true`, `strict-peer-dependencies=false` |

## 构建工具链

### tsup (`tsup.config.ts`)

四个独立 bundle 配置，均产出到 `scripts/`（repo 根，入库；测试与 plugin 均从此路径加载）：

1. **`flow-bridge`** ← `src/flow/bridge.ts`，`clean: true`（每次构建清空 scripts 目录）。
2. **`flow-bootstrap`** ← `src/flow/bootstrap.ts`，`clean: false`。
3. **`flow-cleanup`** ← `src/flow/cleanup.ts`，`clean: false`。
4. **`cc-flow-mcp`** ← `src/mcp/server.ts`，`clean: false`。

共享配置：`format: ['cjs']`、`splitting: false`（自包含单文件）、`sourcemap: true`、`dts: false`、`banner.js: '#!/usr/bin/env node'`。

设计意图：Claude Code plugin 从 GitHub 安装后直接加载 `plugin/scripts/` 下的 JS，不执行构建。产物需要提交到 Git。

### tsc (`tsconfig.json`)

`noEmit: true`，仅做类型检查（不参与产物输出）。`include: ["src/**/*"]`，新增 `src/mcp/**/*`。

## 测试工具链

### vitest (`vitest.config.ts`)

- `globals: true`
- `environment: 'node'`（无 DOM）
- `pool: 'forks'`（bootstrap/bridge/MCP 测试 spawn 子进程，forks 池更稳定）

测试覆盖：`tests/flow/*.test.ts` + `tests/mcp/*.test.ts`。

## 依赖清单

### `package.json`

```json
{
  "name": "cc-flow",
  "version": "0.2.0",
  "license": "PolyForm-Noncommercial-1.0.0",
  "engines": { "node": ">=18.0.0" },
  "files": ["plugin", ".claude-plugin", "src", "README.md", "LICENSE"],
  "devDependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "@types/node": "^22.19.20",
    "tsup": "^8.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "zod": "^4.4.3"
  }
}
```

### 运行时依赖

**`package.json` 中零运行时依赖**。核心 bridge/bootstrap/cleanup 全部使用 Node 标准库。

**MCP server 产物 `cc-flow-mcp.js` 内部 bundle 了 `@modelcontextprotocol/sdk` 和 `zod`**，因此 plugin 安装后无需再安装这些包。`STACK.md` 需要如实说明这一 nuance：package.json 层面无运行时依赖，但 MCP server 产物内部包含第三方代码。

### 开发依赖（6 个）

| 包 | 版本 | 用途 |
|---|---|---|
| `@modelcontextprotocol/sdk` | ^1.29.0 | MCP server 实现，bundle 进产物 |
| `@types/node` | ^22.19.20 | Node 类型 |
| `tsup` | ^8.0.0 | 构建（esbuild 包装） |
| `typescript` | ^5.5.0 | 类型检查 |
| `vitest` | ^2.0.0 | 测试框架 |
| `zod` | ^4.4.3 | MCP tool 输入校验，bundle 进产物 |

## npm scripts

| 命令 | 行为 |
|---|---|
| `pnpm build` | `tsup`（产出四份 bundle 到 `plugin/scripts/`） |
| `pnpm dev` | `tsup --watch` |
| `pnpm test` | `vitest run` |
| `pnpm test:watch` | `vitest` |
| `pnpm prepublishOnly` | `pnpm build && pnpm test` |

## 平台假设

- 仅在 macOS / Linux 类 Unix 上验证过。
- 假设用户已经安装 Claude Code 且 `~/.claude/teams/` 由 CC 自身管理；cc-flow 只读写该目录下的 mailbox/config 文件。

## 外部运行时耦合

| 耦合点 | 形式 | 脆弱性 |
|---|---|---|
| CC Team 目录布局 | 文件路径约定 | 中 |
| CC `config.json` 的 `leadSessionId` 字段 | 字段名假设 | 中 |
| CC plugin 机制（skill/hooks/mcpServers） | plugin 元数据 + 目录布局 | 中：CC 改变 plugin 加载方式需同步调整 |
| CC `useInboxPoller` 每秒轮询 mailbox | 行为假设 | 低 |
| CC `TeammateMessage` 数组 JSON 格式 | 数据形状假设 | 低 |
