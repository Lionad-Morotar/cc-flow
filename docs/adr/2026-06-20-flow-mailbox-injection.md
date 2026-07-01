# ADR 2026-06-20: Flow 使用 CC Team Mailbox 作为零 patch 注入通道

## Status

Accepted

## Context

<del>cc-expand 需要从纯"上下文窗口 patch"扩展为"Claude Code 增强平台"。其中第二大能力 **Flow** 要求：</del>

- 外部长期运行进程（Flow）能向一个**已经打开**的 Claude Code 主会话注入上下文。
- 用户保留"随时接管"能力：可以在任意时刻回到 REPL，不应被 Flow 独占。
- 实现必须**零 patch** CC 二进制，且不由外部进程启动新的 CC 实例。
- 用户使用的模型不是 Anthropic first-party provider，因此无法使用 CC 官方 Channel/Bridge。

需要选择一条可靠、可维护、与 CC 生命周期兼容的注入通道。

## Decision

Flow 采用 Claude Code 内置的 **Team Mailbox** 机制：

- CC 主会话创建一个 Team 并成为 Leader。
- 同时创建一个名为 `cc-flow-bridge` 的 in-process placeholder teammate，仅用于维持 team 存在。
- skill 启动一个本地 Node.js bridge 进程，该进程按 `teamName` 推导出 leader mailbox 路径（`~/.claude/teams/<team>/inboxes/team-lead.json`）。
- Flow 进程通过本地 HTTP POST 把消息推送给 bridge，bridge 将消息追加到 leader mailbox。
- CC Leader 的 `useInboxPoller` 每秒轮询一次 mailbox，读取到消息后作为新 turn 提交给主代理。

Node.js bridge 的生命周期通过检测 team config 文件是否存在来绑定：CC 正常退出时会调用 `cleanupSessionTeams()` 删除 team 目录，bridge 检测到后自动退出。`--off` 模式由 skill 清理残留注册表文件、停止孤儿 bridge 进程、删除残留 team 目录。

## Alternatives Considered

### 1. Patch CC 二进制以暴露队列控制面

- **Rejected**：Bun 在 release build 中会 fuse feature flags 并消除 dead require 分支，无法通过简单字符串替换激活隐藏代码。patch 方案脆弱、版本相关、维护成本高，违背零 patch 原则。

### 2. 使用 CC Channel 功能

- **Rejected**：Channel 需要 first-party provider 支持，用户使用的第三方模型无法开启。

### 3. 使用 CC Bridge 功能

- **Rejected**：Bridge 需要 Anthropic 云 OAuth，不适合本地第三方模型场景。

### 4. 直接操作 `messageQueueManager`

- **Rejected**：`messageQueueManager` 是 CC 进程内部模块，外部进程无法访问其内存。需要 patch 或注入才能使用，与零 patch 目标冲突。

### 5. 外部进程通过 tmux/pane 发送按键

- **Rejected**：tmux 模拟按键不可靠，会破坏用户交互状态，且无法在用户已接管时安全暂停注入。mailbox 是 CC 明确支持的异步通道，更安全。

## Consequences

### Positive

- **零 patch**：不修改 CC 二进制，版本兼容性完全交给 CC 自身的 team/mailbox 机制。
- **生命周期自然绑定**：CC 退出时删除 team，bridge 自动退出；用户 `--off` 可清理残留。
- **用户接管无冲突**：mailbox 消息作为普通 turn 进入主代理，用户仍可在 REPL 输入；两者通过 CC 自身的 QueryGuard 排队，不会乱序。
- **跨语言友好**：Flow 进程只需要能发 HTTP POST，可用 Python、Go、Rust、shell 等任意语言编写。

### Negative

- **无法强制命令执行**：注入的消息会被主代理按自然语言理解，LLM 不会自动执行"关闭 team"、"杀掉 teammate"等破坏性指令。Flow 只能是"建议/上下文注入"，不能是"远程命令执行"。
- **依赖 team 机制**：CC 的 team/swarm 功能必须可用；如果 CC 未来改变 team file 路径或 mailbox 格式，需要同步调整。
- **单会话单 Flow**：MVP 阶段一个 CC 主会话对应一个 Flow Bridge；多 Flow 路由需要后续设计。
- **本地-only**：Flow 进程与 CC 必须运行在同一台机器上，共享 `~/.claude` 与项目目录。

## Related

- PRD: `docs/plans/2026-06-20-claude-code-flow.md`
- Glossary: `CONTEXT.md`（Flow、cc-flow-bridge、Flow Bridge、Flow Registry）
