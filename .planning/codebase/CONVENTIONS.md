# CONVENTIONS

> cc-flow 项目的代码、注释、命名与文档约定。可直接指导新代码的添加。

## 代码风格

### TypeScript 配置（来自 `tsconfig.json`）

- `strict: true`：所有严格类型检查开启
- `target: ES2022`：可用 top-level await、class fields、`?.()` 等
- `module/moduleResolution: NodeNext`：**必须用 `.js` 扩展名 import 源文件**（如 `import './paths.js'`），即便源文件是 `.ts`。这是 NodeNext 解析规则。
- `esModuleInterop: true`、`skipLibCheck: true`、`forceConsistentCasingInFileNames: true`、`resolveJsonModule: true`
- `noEmit: true`：tsc 只做类型检查，不产出（tsup 负责）

### 导入顺序（实际代码观察出的约定）

1. Node 标准库（`node:fs/promises`、`node:http`、`node:child_process` 等，统一带 `node:` 前缀）
2. 项目内模块（相对路径，带 `.js` 扩展名）
3. 类型 import 用 `import type { ... }`

示例（`bootstrap.ts`）：

```ts
import { spawn } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
import { isPidAlive, killBridge, listRegistries, readRegistry, writeRegistry } from './registry.js'
import { getTeamDir, sanitizeTeamName } from './paths.js'
import { resolveTeamDirBySession } from './team-resolve.js'
import type { FlowRegistryEntry } from './types.js'
```

注：导入风格略有混乱——`bootstrap.ts` 把 `fs/promises` 拆成两行 import（`readFile, rm` 与 `mkdtemp` 分开）。新代码应合并。

### 错误处理模式

统一的 ENOENT 容错模式，每个 read 类函数都遵循：

```ts
export async function readX(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
```

出现于：`mailbox.ts#readMailbox`、`registry.ts#readRegistry`、`team-resolve.ts#readTeamConfig`、`registry.ts#listRegistries`（在目录级别）。

非 ENOENT 错误一律 `throw`，不吞错。

### 类型模式

- 公共数据类型集中在 `types.ts`（`FlowMessage`, `FlowRegistryEntry`），各模块 `import type` 引用。
- 函数返回类型显式标注（尤其 async 函数）。
- `Omit<FlowMessage, 'read'>` 表示"构造时尚未设置 read 字段，append 时强制 `read: false`"。
- 模块内部类型（`BridgeConfig`、`TeamConfig`）就近定义、不导出。

### 异步模式

- 全部用 `async/await`，无 `.then().catch()` 链。
- 写操作统一"tmp 文件 + rename"做原子替换（`mailbox.ts#writeMailbox`、`registry.ts#writeRegistry`）。
- 串行化用 Promise 链队列（`MailboxQueue` 模式：`pending: Map<Key, Promise>`，新任务接在 prev.then 之后）。
- 轮询用 `setInterval` + `access`，退出时 `clearInterval` 再 `process.exit`。

### CLI 参数解析

bootstrap 和 bridge 都**手写 `for` 循环解析 argv**（不用 commander/yargs 等库，保持零依赖）：

```ts
function parseArgs(argv: string[]): BridgeConfig {
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i]
    switch (flag) {
      case '--team': teamName = argv[++i]; break
      // ...
    }
  }
  // 必填项检查
  if (!teamName) throw new Error('--team is required')
  // ...
}
```

约定：`--flag value` 形式（空格分隔），不支持 `--flag=value`。

## 注释约定（严格遵守）

来自全局 CLAUDE.md 的强制规则，代码库中已贯彻：

- **注释只解释 Why，不解释 What**：描述功能、意图、隐含假设、折衷、不够稳健之处。
- **禁止**夹带开发阶段标记（如 `TODO`、`FIXME`、`v1`、`v2`、优先级标记）。
- **每个模块文件顶部**有 1-10 行块注释，说明该模块的存在理由（Why this module exists），常包含历史决策或与备选方案对比。

示例（`paths.ts` 顶部）：

```ts
/**
 * Path conventions for CC Flow.
 *
 * These deliberately mirror the directory layout used by Claude Code's own
 * teammate/swarm code so that the external bridge can write to the same
 * mailbox files that CC reads. The env-var fallbacks exist only for tests.
 *
 * Why the registry lives under ~/.claude/cc-flow rather than <project-root>/.tmp:
 * earlier versions derived it from the project root, but when a session runs
 * with cwd at the user's home (where ~/.tmp is a regular file, not a directory),
 * mkdir -p silently fails and bootstrap cannot persist anything. ...
 */
```

注释中大量"反模式对比"（"earlier versions did X, but Y happened"）是项目特色——把踩过的坑固化在注释里，防止回退。

## 命名约定

| 类别 | 约定 | 例 |
|---|---|---|
| 文件 | kebab-case | `team-resolve.ts`, `flow-hourly.mjs` |
| 函数 | camelCase，动词开头 | `appendToMailbox`, `resolveTeamDirBySession` |
| 类型/接口 | PascalCase | `FlowMessage`, `BridgeConfig`, `TeamConfig` |
| 常量 | UPPER_SNAKE | `MAX_TEXT_BYTES`, `MAX_BODY_BYTES`, `BRIDGE_BUNDLE` |
| 环境变量 | `CC_FLOW_*` 前缀 | `CC_FLOW_TEAMS_DIR`, `CC_FLOW_REGISTRY_DIR` |
| CLI flag | `--kebab-case` | `--team-dir`, `--team-config-path`, `--ready-file`, `--session-id` |
| Skill 名 | 短横线 | `cc-flow` |
| 占位 teammate 名 | 短横线 | `cc-flow-bridge` |

### Skill / Flow 命名约定

- Skill 目录：`packages/skills/cc-flow/`
- 构建产物：`scripts/flow-bootstrap.js`、`scripts/flow-bridge.js`（不带 cc- 前缀，因 skill 已命名）
- team 名：`cc-flow-<sessionShortId>`（由 skill 模板硬编码，注册表校验 `startsWith('cc-flow-')`）

## 输出协议（machine-readable）

bootstrap 与 bridge 都通过 `console.log`（stdout）输出**可解析的机器格式**，skill 模板用正则提取：

| 触发点 | 输出 | skill 提取的正则 |
|---|---|---|
| bridge listen 成功 | `FLOW_BRIDGE_LISTENING port=<port>` | `/FLOW_BRIDGE_LISTENING port=(\d+)/` |
| bootstrap 启动成功 | `FLOW_BRIDGE_STARTED port=<p> token=<t> pid=<p> registry=<r>` | `/FLOW_BRIDGE_STARTED port=(\d+) token=(\S+) pid=(\d+) registry=(\S+)/` |
| bootstrap 复用 | `FLOW_BRIDGE_ALREADY_RUNNING port=<p> token=<t> pid=<p> registry=<r>` | — |
| bootstrap --off 完成 | `FLOW_OFF: cleaned <n> session(s)` | — |
| bridge 错误 | `console.error('[flow-bridge] ...')` | — |

约定：skill 侧依赖这些字面量。修改格式会破坏 skill 解析，需同步改 SKILL.md。

## 文档约定（全局规则）

- 语言：中文
- 文件名：若父目录非时间/日期命名，以 `YYYY-MM-DD-` 前缀（如 `docs/adr/2026-06-20-flow-mailbox-injection.md`，`docs/plans/2026-06-20-claude-code-flow.md`）
- 引用：标准 Markdown 脚注 `[^topic]` / `[^topic]: ...`
- 分隔：md 文件用空行而非 `---`
- ADR 结构：Status / Context / Decision / Alternatives Considered / Consequences (Positive/Negative) / Related

## Git 约定

- 分支风格：trunk-based（main 为主线，HEAD 当前 detached）
- commit message：`feat: <高度凝练的spec>\n\n<spec-list>`，vertical sliced
- commit lockfile：是（`pnpm-lock.yaml` 入库）
- 不提交：`.planning/`、`node_modules/`、`dist/`、`packages/skills/cc-flow/scripts/`（构建产物）

## 构建产物约定

- tsup 配置：先构建 `flow-bridge`（`clean: true` 清空 scripts 目录），再构建 `flow-bootstrap`（`clean: false`，不清掉刚生成的 bridge）
- 单文件 CJS bundle（`splitting: false`），加 `#!/usr/bin/env node` shebang
- 与项目其余部分运行时解耦：用户机器上无需 `node_modules`，单文件即可运行
