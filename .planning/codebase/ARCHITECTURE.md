# ARCHITECTURE

> cc-flow 的运行时架构、数据流、关键不变量（invariants）。决策依据见 ADR `docs/adr/2026-06-20-flow-mailbox-injection.md`。

## 一句话定位

零 patch 的 Claude Code 上下文注入通道——外部长期运行进程（Flow）通过本地 HTTP bridge 写入 CC Leader 的 Team Mailbox，CC 每秒轮询后作为新 turn 注入主会话。

## 三层架构

```
┌─────────────────────────────────────────────────────────────────┐
│  ① CC 主会话（用户终端 REPL）                                     │
│     ├─ Leader 角色（创建 Team 后自动成为）                         │
│     ├─ useInboxPoller：每 1s 读 team-lead.json                    │
│     │    → 新消息作为 teammate_message turn 提交给主代理           │
│     ├─ cc-flow-bridge：占位 teammate（haiku model，不工作）        │
│     │    仅用于维持 team 存在；由 CC Agent 工具创建                 │
│     └─ 用户随时按 ESC 接管，QueryGuard 保证不乱序                  │
└─────────────────────────────────────────────────────────────────┘
                            ▲
                            │ fs read (polling)
                            │
┌─────────────────────────────────────────────────────────────────┐
│  ~/.claude/teams/<sanitized>/inboxes/team-lead.json              │
│  （CC 自身管理的 mailbox 文件，cc-flow 直接追加）                  │
└─────────────────────────────────────────────────────────────────┘
                            ▲
                            │ atomic rename write
                            │
┌─────────────────────────────────────────────────────────────────┐
│  ② Node.js bridge 进程（spawn 起来的 detached 子进程）             │
│     ├─ http.createServer 绑定 127.0.0.1:0                         │
│     │    routes: POST /inject, GET /status                       │
│     ├─ 每 2s access(teamConfigPath)，消失则 process.exit(0)        │
│     └─ 启动后写 readyFile（含实际 port）给 bootstrap 探测          │
└─────────────────────────────────────────────────────────────────┘
                            ▲
                            │ HTTP POST /inject
                            │   Authorization: Bearer <token>
                            │
┌─────────────────────────────────────────────────────────────────┐
│  ③ 第三方 Flow 进程（任意语言）                                    │
│     例：src/flow/examples/flow-hourly.mjs（整点报时）              │
└─────────────────────────────────────────────────────────────────┘
```

## 关键设计决策（来自 ADR）

ADR 明确否决了 5 个备选方案，最终选择 Team Mailbox：

1. ~~Patch CC 二进制~~：Bun release build 会 fuse feature flags，patch 脆弱。
2. ~~CC Channel~~：需 first-party provider，用户用第三方模型。
3. ~~CC Bridge~~：需 Anthropic 云 OAuth。
4. ~~操作 messageQueueManager~~：CC 进程内部模块，外部进程不可访问。
5. ~~tmux 模拟按键~~：不可靠、破坏用户交互状态。

## 关键不变量（Invariants）

### I1: mailbox 写入对 CC 读取永远不会出现"半写状态"

`mailbox.ts#writeMailbox` 使用 tmp + rename 原子替换：

```ts
async function writeMailbox(inboxPath, messages) {
  const tmp = `${inboxPath}.tmp`
  await writeFile(tmp, JSON.stringify(messages, null, 2) + '\n', 'utf-8')
  await rename(tmp, inboxPath)
}
```

CC 的 `useInboxPoller` 每秒读 `team-lead.json`，rename 是 POSIX 原子操作，所以 CC 永远看到完整的旧数组或完整的新数组，不会读到部分写入。

### I2: 同一 inbox 的并发写入串行执行

`mailbox.ts#MailboxQueue` 维护 `Map<inboxPath, Promise>`，每次 `appendToMailbox` 都 `queue.run(inboxPath, fn)`，前一个未完成时下一个必须等待。防止 read-modify-write 竞态（多 Flow 并发 POST）。

注释明确：Flow 架构下只有 bridge 进程写 inbox，所以**进程内队列就足够**——不需要跨进程锁。

### I3: bridge 进程不依赖 `--team` 推导目录

这是核心脆弱点的缓解措施。Agent 工具创建 team 时**自己命名目录**（观察为 `session-<shortId>`），与 `--team cc-flow-<shortId>` 推导出的 `cc-flow-<shortId>` 不一致。直接推导会导致写错目录（原始注入丢失 bug）。

解决方案：
- `bootstrap.ts#start` 调用 `resolveTeamDirBySession(sessionId)` 反向探测：扫描 `~/.claude/teams/*/config.json`，匹配 `leadSessionId === sessionId` 的目录。
- 找不到则**立即 fail-fast**，绝不写 guessed 目录。
- 找到后把真实 `teamDir` 显式传给 bridge（`--team-dir`），bridge 优先用它而非 teamName 推导。
- registry 持久化 `teamDir`，`--off` 删除该目录而非推导目录。

### I4: bridge 生命周期与 team config 文件存在性强绑定

`bridge.ts#lifecycle`：每 2s `access(teamConfigPath, F_OK)`，ENOENT 则 `server.close(() => process.exit(0))`，2s 兜底强退。

依赖 CC 自身行为：CC 正常退出会调用 `cleanupSessionTeams()` 删除 team 目录，bridge 因此自动退出。无需心跳或外部监督。

### I5: 同一 session 的 bridge 幂等启动

`bootstrap.ts#start`：写新注册表前先 `readRegistry(sessionShortId)`，若 `isPidAlive(existing.pid)` 则输出 `FLOW_BRIDGE_ALREADY_RUNNING` 并返回，不重复 spawn。

### I6: `--off` 只清理可信 entry，防止路径遍历/任意目录删除

`bootstrap.ts#isTrustedRegistryEntry`：
- `teamName` 必须以 `cc-flow-` 开头
- `sanitizeTeamName(teamName) === teamName`（无 `../` 等特殊字符）
- `sessionShortId === sessionId.slice(0, 8)`

不满足则在 `--off` 流程中跳过并 log，不删除任何目录。

## 数据流：一次成功的注入

```
Flow: HTTP POST /inject { text, summary, color, from }
  │
  ▼
bridge: createServer handler
  ├─ socket.remoteAddress 必须 ∈ {127.0.0.1, ::1, ::ffff:127.0.0.1}   # defense-in-depth
  ├─ Authorization: Bearer <token> 校验                                # 401 失败
  ├─ collectBody(req, MAX_BODY_BYTES=110KB)                            # 413 超限
  ├─ JSON.parse                                                        # 400 失败
  ├─ text: 非空 string, ≤100KB                                         # 400/413
  ├─ 构造 Omit<FlowMessage,'read'> { from||'flow', text, summary?, color?, timestamp }
  └─ appendToMailbox(inboxPath, msg)
        ├─ MailboxQueue.run(inboxPath, ...)                            # 串行化
        ├─ mkdir(dirname, recursive)
        ├─ readMailbox (readFile, ENOENT→[])
        ├─ writeMailbox: tmp + rename                                  # 原子
        └─ resolve
  │
  ▼
返回 200 { ok: true, timestamp }

  ─── 异步 ───

CC useInboxPoller (每 1s):
  └─ 读 team-lead.json → 新消息作为 teammate_message turn
        → 主代理按自然语言理解（NOT 命令执行）
```

## 配置注入点（env vars）

所有路径都支持 env 覆盖，主要用于测试：

| Env | 默认 | 用途 |
|---|---|---|
| `CC_FLOW_PROJECT_ROOT` | `process.cwd()` | 显式 opt-in，**不再**决定 registry 位置 |
| `CC_FLOW_REGISTRY_DIR` | `~/.claude/cc-flow` | registry 目录 |
| `CC_FLOW_TEAMS_DIR` | `~/.claude/teams` | teams 目录（覆盖 CC 默认） |

设计要点（`paths.ts` 注释）：早期版本从 project root 推导 registry，但当 cwd 是用户 home（`~/.tmp` 是文件而非目录）时 mkdir 静默失败，bootstrap 无法持久化任何东西。修复后 registry 是 CC 全局状态，与 project 解耦。

## 进程模型

| 进程 | 启动者 | 退出条件 |
|---|---|---|
| CC 主会话 | 用户 | 用户退出 / ESC |
| 占位 teammate `cc-flow-bridge` | CC Agent 工具（in-process） | 随主会话 |
| bridge（Node.js） | bootstrap spawn (detached, unref) | (a) team config 消失 (b) SIGTERM/SIGKILL from `--off` (c) `server.on('error')` |
| Flow 进程 | 用户自行启动 | 用户自行停止（`--off` 不动它） |

bridge `spawn({ detached: true, stdio: 'ignore' })` + `child.unref()`：bootstrap 进程退出后 bridge 继续运行，与 CC 主会话生命周期解耦。

## 信任边界

```
不可信（外部进程）         可信（本机 cc-flow）
─────────────────────    ──────────────────────
Flow ──HTTP──> bridge  →  mailbox (file)  →  CC (内部)
        │                                          │
        └─ 唯一入口：Bearer token + localhost       └─ 文件系统，无网络
```

- bridge 是唯一网络入口，强制 127.0.0.1 + Bearer token + body size 限制。
- mailbox 是文件系统写入，无网络暴露。
- CC 读 mailbox 走自己的内部代码，Flow 无法直接触达 CC 进程内存。
