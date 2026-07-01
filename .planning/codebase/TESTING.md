# TESTING

> cc-flow 的测试策略、覆盖范围与运行方式。

## 配置（`vitest.config.ts`）

```ts
export default defineConfig({
  test: {
    globals: true,           // describe/it/expect 全局可用（实际仍显式 import）
    environment: 'node',     // 纯 Node API，无 DOM
    pool: 'forks',           // 因测试 spawn 子进程，forks 比 threads 稳定
  },
})
```

## 命令

| 命令 | 行为 |
|---|---|
| `pnpm test` | `vitest run`（一次性运行全部） |
| `pnpm test:watch` | `vitest`（watch 模式） |
| `pnpm prepublishOnly` | `pnpm build && pnpm test`（发布前双保险） |

## 测试文件清单（`tests/flow/`）

7 个文件，覆盖完整：

| 文件 | 测试数 | 性质 | 关键用例 |
|---|---|---|---|
| `paths.test.ts` | 4 | 单元（纯函数） | registry 独立于 cwd/project root、env 覆盖、`getProjectRoot` 行为 |
| `team-resolve.test.ts` | 5 | 单元（fs stub） | 按 `leadSessionId` 匹配、无 team 返回 null、orphan dir 容忍 |
| `mailbox.test.ts` | 5 | 单元（真实 fs） | ENOENT→[]、append 加 `read:false`、保留 summary/color、并发串行化（Promise.all 3 条 → 全部持久） |
| `registry.test.ts` | 6 | 单元 + 子进程 | round-trip、list、PID alive 检测、`cleanupByRegistry` 完整链路 |
| `bridge.test.ts` | 8 | 进程级（spawn） | 401（无/错 token）、400（坏 JSON）、413（>110KB）、注入落盘、status queueLength、team config 删除自动退出、`--team-dir` 覆盖 |
| `bootstrap.test.ts` | 5 | 进程级（spawn） | start 写 registry、`--registry` 覆盖默认 dir、幂等复用、`--off` 跳过不可信 entry、bridge bundle 缺失时的错误 |
| `integration.test.ts` | 2 | e2e | 完整 enable→inject→status→off、真实 team dir 与 `--team` 名字发散时的全链路 |

**总计约 35 个测试用例**。

## 测试结构约定

### beforeEach/afterEach 模式

每个文件都遵循：

```ts
let registryDir: string
let teamsDir: string
const originalRegistryDir = process.env.CC_FLOW_REGISTRY_DIR
const originalTeamsDir = process.env.CC_FLOW_TEAMS_DIR

beforeEach(async () => {
  registryDir = await mkdtemp(join(tmpdir(), 'cc-flow-reg-'))
  teamsDir = await mkdtemp(join(tmpdir(), 'ccx-teams-'))
  process.env.CC_FLOW_REGISTRY_DIR = registryDir
  process.env.CC_FLOW_TEAMS_DIR = teamsDir
})

afterEach(async () => {
  // 恢复 env，删除临时目录
  if (originalRegistryDir === undefined) delete process.env.CC_FLOW_REGISTRY_DIR
  else process.env.CC_FLOW_REGISTRY_DIR = originalRegistryDir
  // ...
  await rm(registryDir, { recursive: true, force: true })
  await rm(teamsDir, { recursive: true, force: true })
})
```

关键点：
- 用 `mkdtemp` 在 OS 临时目录隔离，**绝不触碰真实 `~/.claude/teams/`**。
- env var 保存/恢复成原值（含 undefined），不污染其他测试。
- 通过 env 覆盖而非注入参数来重定向路径（`CC_FLOW_TEAMS_DIR`、`CC_FLOW_REGISTRY_DIR`）。

### 子进程测试模式（bridge/bootstrap/integration）

```ts
const child = spawn(process.execPath, ['packages/skills/cc-flow/scripts/flow-bridge.js', ...], {
  cwd: process.cwd(),
  env: { ...process.env, CC_FLOW_TEAMS_DIR: teamsDir },
  stdio: ['ignore', 'ignore', 'pipe'],
})

const port = await new Promise<number>((resolve, reject) => {
  let output = ''
  child.stderr!.on('data', chunk => {
    output += chunk.toString()
    const match = output.match(/FLOW_BRIDGE_LISTENING port=(\d+)/)
    if (match) resolve(Number(match[1]))
  })
  child.on('error', reject)
  child.on('exit', code => {
    if (code !== 0) reject(new Error(`bridge exited early with code ${code}: ${output}`))
  })
  setTimeout(() => reject(new Error(`bridge start timeout: ${output}`)), 5000)
})
```

特点：
- **测试 spawn 真实构建产物** `packages/skills/cc-flow/scripts/flow-{bridge,bootstrap}.js`，因此 `pnpm test` 前必须 `pnpm build`（prepublishOnly 链路保证）。
- 通过 stderr 解析 `FLOW_BRIDGE_LISTENING` 信号握手。
- 用 `child.kill('SIGTERM')` + `await sleep(500)` 兜底清理，try/finally 保证回收。

### HTTP helper

`bridge.test.ts` 与 `integration.test.ts` 各自定义轻量 `httpRequest`/`httpPost`/`httpGet`，用 `node:http.request` 包装成 Promise。无依赖、无 supertest。

### 集成测试

`integration.test.ts` 跑完整 e2e：bootstrap 子进程 → HTTP /inject → 读 mailbox 文件 → HTTP /status → bootstrap --off → 验证清理。**不调任何 API 绕过测试**——直接 spawn 真实 CLI 产物、走真实 HTTP、写真实文件。

## 覆盖范围评估

**强覆盖**：
- 所有公共函数（paths/mailbox/registry/team-resolve）
- bridge HTTP 全部分支（401/400/413/200/404/500）
- bootstrap 两个模式（start/off）
- 核心不变量 I3（team-dir 与 teamName 发散）有专门测试（`bridge.test.ts` 最后一个 + `integration.test.ts` 第二个）
- 并发串行化（`mailbox.test.ts` "atomically appends multiple messages"）

**未覆盖/弱覆盖**（见 CONCERNS）：
- `MAX_TEXT_BYTES = 100KB` 边界（413 测试用了 body >110KB，但 text 字段本身 ≤100KB 的边界未单测）
- bridge 的 `server.on('error')` → `process.exit(1)` 分支（端口冲突等）
- 强制退出兜底 `setTimeout(() => process.exit(0), 2000).unref()` 是否真的触发
- bridge handler 的 500 路径（appendToMailbox 抛错）
- `clearMailbox` 函数无单元测试（只在内部使用）
- 跨平台：未在 Windows 验证（POSIX 假设）

## 测试运行前置条件

`pnpm test` 要求：

1. 已 `pnpm install`（提供 vitest、@types/node）
2. 已 `pnpm build`（生成 `packages/skills/cc-flow/scripts/flow-{bridge,bootstrap}.js`）

若跳过 build，bridge/bootstrap/integration 三个测试文件会全部 fail（spawn 找不到产物）。

## CI 提示

无 CI 配置（无 `.github/workflows/`）。本地开发依赖 `prepublishOnly` 双保险。
