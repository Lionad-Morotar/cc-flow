# CONCERNS

> cc-flow 当前实现的技术债务、风险与改进机会。按严重度排序，每条含证据 + 建议处理。

## 高严重度（影响安全或正确性）

### C1: authToken 明文落盘到注册表（已接受）

**状态**：已由 `docs/adr/2026-06-29-fork1-trust-boundary.md` 接受为信任域内可接受暴露，原“高危”定性撤回。

**结论**：在“同 uid = 信任域”前提下，token 无法防御同 uid 恶意进程（共享秘密在共享信任域内失效）。明文落盘不可消除——Browser Extension 与 curl 客户端需原始 token 构造 Authorization 头，hash 存储 / 不持久化均会断链。

**已落地的缓解**：
- 注册表文件 0600、目录 0700（挡其他 uid，单用户机器边际收益小但成本为零）。
- token 由 bootstrap 自动生成、经环境变量传递，消除进程 argv / shell history / CC transcript 泄漏。
- token 熵 256bit、比较恒定时间（`timingSafeEqual`）。
- token 角色降级为防呆 + defense in depth，详见 ADR。

**残留风险**：同 uid 恶意进程仍可读注册表拿 token 伪造注入；注入的"上下文"在 CC 里即指令源，可被 prompt injection 利用诱导危险操作/泄露 secrets（详见 ADR）。

**开放项（未来加固，非本轮范围）**：

- 评估 OS keychain / Unix Domain Socket / 短时效 token 对 L3 的缓释（当前 ADR 因 UX 与实现成本未引入）。
- bridge 重启会生成新 token，扩展 `browser.storage.local` 仍持旧 token 导致 401、无自愈——扩展需加 token 刷新逻辑（属扩展协议范围，F6）。
- 扩展 `storage.local` 与备份/同步路径（Time Machine/iCloud）的 token 暴露（详见 ADR Negative）。

### C2: bootstrap 注释/函数命名遗留 cc-expand 误称

**证据**：
- `registry.ts#cleanupByRegistry` 注释：`Clean up everything cc-expand manages for a single Flow session.`——`cc-expand` 是更早的项目名，当前项目叫 `cc-flow`。
- `SKILL.md` 末尾："注意：`--off` 只清理 cc-expand 管理的资源"——同样笔误。
- ADR 文档中也保留 `<del>cc-expand 需要从纯"上下文窗口 patch"扩展为...` 的删除痕迹。

**风险**：误导新 contributor，让其对项目边界产生错误认知；维护时混用两个名字会让搜索/替换出错。

**建议**：全文替换 `cc-expand` → `cc-flow`（注释、文档）。代码标识符 `cleanupByRegistry` 不需改名。

### C3: `registry.ts#writeRegistry` 多余的 read-then-write

**证据**：

```ts
export async function writeRegistry(entry, registryPath?): Promise<void> {
  const path = registryPath ?? getFlowRegistryPath(entry.sessionShortId)
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(entry, null, 2) + '\n', 'utf-8')
  await writeFile(path, await readFile(tmp, 'utf-8'), 'utf-8')   // ★ 多余
  await rm(tmp, { force: true })
}
```

**问题**：
1. 既然有 tmp 文件，应该直接 `rename(tmp, path)` 做原子替换（如 `mailbox.ts#writeMailbox` 那样）。
2. 当前实现是"写 tmp → 读 tmp → 写 path → 删 tmp"四步，非原子——读 tmp 和写 path 之间若进程被杀，path 可能是旧值或空。
3. 注释明确说"原子"，但实现并不是。

**对比**：`mailbox.ts#writeMailbox` 用 `rename` 是正确做法。

**建议**：

```ts
await writeFile(tmp, JSON.stringify(entry, null, 2) + '\n', 'utf-8')
await rename(tmp, path)  // 原子
```

### C4: `MAX_TEXT_BYTES` 边界无单测

**证据**：
- `bridge.ts`：`if (Buffer.byteLength(text, 'utf-8') > MAX_TEXT_BYTES)` 用 `>`，等于边界（恰好 100KB）应通过。
- `bridge.test.ts` 只测了 body > 110KB（413）和正常注入，没有"恰好等于/略小于/略大于 100KB text"的边界用例。

**风险**：边界条件容易在重构时回归（`>` vs `>=`）。

**建议**：补 3 个测试：text 字节数 = 100KB（200）、100KB+1（413）、100KB-1（200）。

## 中严重度（影响可维护性或扩展性）

### C5: 重复的 spawn+握手样板（bridge/bootstrap/integration 测试）

**证据**：`bridge.test.ts#startBridge`、`integration.test.ts#runBootstrap`、`bootstrap.test.ts#runBootstrap` 各自复制了一份 spawn + stderr 监听 + 正则握手 + timeout 拒绝的逻辑。`httpRequest`、`httpPost`、`httpGet` 也分散定义。

**风险**：测试改动需要 3 处同步；任何一个超时/握手错误处理不一致都会让 debug 困难。

**建议**：抽到 `tests/flow/helpers.ts`（或 `tests/_support/`），导出 `startBridge`、`runBootstrap`、`httpRequest`、`httpPost`、`httpGet`。

### C6: bootstrap.ts 的 import 风格断裂

**证据**：

```ts
import { spawn } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'   // 第一组
import { basename, dirname, join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'         // ★ 又 import 一次 fs/promises
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
```

`fs/promises` 被分两行 import。

**建议**：合并为 `import { readFile, rm, mkdtemp } from 'node:fs/promises'`。

### C7: PRD 文档 `docs/plans/2026-06-20-claude-code-flow.md` 入库但 README 称"本地查阅"

**证据**：
- README.md：`设计 PRD (docs/plans/2026-06-20-claude-code-flow.md，本地查阅)`
- `.gitignore` 未排除该文件，`git ls-files` 显示已入库。

**风险**：README 表述暗示该文件不应公开（含未完成计划/品牌讨论），但实际仓库会推送。PolyForm-Noncommercial 已禁止商业使用，但 PRD 中"品牌扩展到 Claude Code 增强平台"等表述可能不适合公开。

**建议**：
- 若该文件可公开，README 改为正常链接。
- 若不可公开，加入 `.gitignore` 并 `git rm --cached`。

### C8: 无 CI 配置

**证据**：仓库根无 `.github/workflows/`、无 `.gitlab-ci.yml`、无 `circleci/`。`prepublishOnly` 仅在 npm publish 前触发，普通 push/PR 不跑测试。

**风险**：分支/PR 可能引入未构建或测试失败的状态。

**建议**：加最小 GitHub Actions：`pnpm install`、`pnpm build`、`pnpm test`（matrix 至少 macos-latest + ubuntu-latest）。

### C9: bridge.ts 的 500 错误路径未测试

**证据**：
- `bridge.ts` handler 末尾 `catch` 走 500：

  ```ts
  } catch (error) {
    if (error instanceof PayloadTooLargeError) { ... }
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[flow-bridge] request error: ${message}`)
    sendJson(res, 500, { ok: false, error: 'Internal error' })
  }
  ```

- `bridge.test.ts` 无"注入触发 appendToMailbox 抛错"的用例（需 mock fs 故障）。

**建议**：用注入坏 inbox 路径或 mock `appendToMailbox` 的方式覆盖 500 路径，保证日志和响应都正确。

### C10: bridge.ts `setTimeout(() => process.exit(0), 2000).unref()` 兜底未测试

**证据**：bridge 在 team config 消失时：

```ts
server.close(() => process.exit(0))
setTimeout(() => process.exit(0), 2000).unref()   // 若 close 卡住，2s 后强退
```

测试只验证"删除 config → 进程 exit code 0"，未验证 close 长时间不返回时的 2s 强退路径。

**风险**：若 `server.close()` 因 pending 连接卡住，进程实际可能挂在 close 回调里（unref 的 timer 仅在 event loop 空时才生效）。

**建议**：构造一个 keep-alive 长连接场景，验证 timer 真的能 fire。

## 低严重度（清理项）

### C11: ADR 中的 `<del>` HTML 标签混入 markdown

**证据**：`docs/adr/2026-06-20-flow-mailbox-injection.md` 第 9 行：

```
<del>cc-expand 需要从纯"上下文窗口 patch"扩展为"Claude Code 增强平台"。其中第二大能力 **Flow** 要求：</del>
```

markdown 渲染器对 `<del>` 处理不一致，且这段删除痕迹无意义。

**建议**：直接删除该行，或改为正常陈述（如果"cc-flow 是 cc-expand 的继任者"这层关系值得保留）。

### C12: vitest `globals: true` 与显式 import 并存

**证据**：`vitest.config.ts` 开了 `globals: true`，但所有测试文件都显式 `import { describe, expect, it, beforeEach, afterEach } from 'vitest'`。

**问题**：globals 选项让 TypeScript 不报错（即使不 import），但当前测试文件都 import 了，所以 globals 实际上是多余的、可能误导新测试（以为可以不 import）。

**建议**：二选一——要么关掉 globals 强制显式 import（更安全），要么删掉测试文件里的 import（更简洁）。当前混合状态是 code smell。

### C13: 无 `CONTRIBUTING.md` 或 `AGENTS.md`

**证据**：仓库根无 `CONTRIBUTING.md`、`AGENTS.md`、`CLAUDE.md`。

**风险**：新 contributor（人或 AI agent）无法快速了解代码风格、注释 Why-not-What 规则、命名约定等。CONVENTIONS.md 中描述的规则全部散落在代码注释和 ADR 里。

**建议**：补一个简短的 `AGENTS.md` 或 `CONTRIBUTING.md`，把 CONVENTIONS.md 中的核心规则（Why 注释、命名、输出协议）显式化。

### C14: tsconfig `outDir: ./dist` 与 tsup 实际产物路径不一致

**证据**：`tsconfig.json` 有 `"outDir": "./dist"`，但 `noEmit: true`，所以 outDir 实际无效。tsup 产物在 `packages/skills/cc-flow/scripts/`。

**风险**：低，但配置不一致让人困惑。

**建议**：删除 `outDir`（既然 noEmit）。

### C15: 示例 Flow 文件 `flow-hourly.mjs` 用 `.mjs`，源码用 `.ts`

**证据**：
- `src/flow/examples/flow-hourly.mjs` 是纯 JS（ESM）。
- 其他源码是 TypeScript。

**原因推测**：示例要展示"任意语言任意形式都能写 Flow"，所以刻意不用 TS。但放在 `src/flow/` 下又会被 tsconfig 的 `include: ["src/**/*"]` 扫描（虽然 `.mjs` 默认不会被 tsc 处理）。

**建议**：保持现状即可（合理），但可考虑挪到 `examples/` 顶层目录与源码区分。或在 README 中明确说明示例的 ESM + 零依赖是刻意设计。

### C16: `registry.ts#listRegistries` 静默吞掉坏 JSON

**证据**：

```ts
for (const name of names) {
  if (!name.endsWith('.json')) continue
  try {
    const raw = await readFile(fullPath, 'utf-8')
    results.push({ path: fullPath, entry: JSON.parse(raw) as FlowRegistryEntry })
  } catch {
    // Ignore malformed registry files during listing.
  }
}
```

**风险**：注册表文件损坏（磁盘错误、半写）会被静默忽略，用户 `--off` 可能漏清理某些 session，且无任何日志。

**建议**：catch 中 `console.warn` 记录路径与原因，至少让用户知道有孤儿。

## 架构层面的观察

### A1: 单 session 单 Flow 限制

ADR Consequences 明确："MVP 阶段一个 CC 主会话对应一个 Flow Bridge；多 Flow 路由需要后续设计。"

当前 mailbox 文件单一，若要支持多 Flow 路由（如不同 Flow 写到不同字段或会话），需要扩展 `FlowMessage` 或引入路由层。这不是 bug，是已知 scope 限制。

### A2: 完全单机，无远程能力

ADR Consequences："本地-only：Flow 进程与 CC 必须运行在同一台机器上。"

若要做远程 Flow（如服务器跑 CI 通知桌面 CC），需要 SSH tunnel 或额外的网络层。当前架构明确不支持。

### A3: bridge 是单进程，无并发横向扩展

同一 inbox 串行写入保证正确性，但若 Flow 推送速率超过 mailbox 写入速率（罕见），会累积 backpressure。当前无 rate limit、无拒绝策略。MVP 阶段可接受。
