# 领域文档（Domain Docs）

工程类技能（`improve-codebase-architecture`、`diagnose`、`tdd` 等）在探索本仓库代码时应如何消费领域文档。

cc-flow 是 **single-context** 仓库：领域语言与架构决策集中在仓库根，不按子包拆分上下文。

## 探索前先读

- **`CONTEXT.md`**（仓库根）—— 领域词汇表。当前尚未创建，由 `/grill-with-docs` 在术语/决策实际沉淀时懒创建。
- **`docs/adr/`** —— 阅读与你即将改动的区域相关的 ADR。当前有：
  - `2026-06-20-flow-mailbox-injection.md` —— 为何采用 CC Team Mailbox 作为零 patch 注入通道（及被否决的 patch 二进制、Channel、Bridge 等备选）。

若上述文件尚不存在，**静默继续**，不要标记缺失、不要主动建议创建——`/grill-with-docs` 会在合适的时机产出。

## 文件结构

```
/
├── CONTEXT.md            ← 领域词汇表（待 /grill-with-docs 创建）
├── Agents.md             ← 真相源（Claude.md 为其 symlink）
├── docs/
│   ├── adr/              ← 架构决策记录
│   │   └── 2026-06-20-flow-mailbox-injection.md
│   ├── agents/           ← 本目录：consumer rules
│   │   └── domain.md
│   └── plans/            ← 设计 PRD（gitignore，本地查阅）
└── src/
    └── flow/             ← 源码
```

## 使用词汇表的术语

当你的产出（issue 标题、重构提案、假设、测试名）命名某个领域概念时，使用 `CONTEXT.md` 中定义的术语，不要漂移到词汇表明确规避的同义词。

cc-flow 的核心领域术语（待正式录入 `CONTEXT.md`）：

- **Flow** —— 外部长期运行进程，通过 HTTP 向 bridge 推送消息
- **Team Mailbox** —— Claude Code 内置的 leader 收件箱机制，CC 每秒轮询
- **bridge** —— 本地 Node.js HTTP 服务，接收 Flow 推送并写入 leader mailbox
- **inject / 注入** —— 向主会话递交上下文（区别于命令执行）
- **Leader** —— CC 主会话在 team 中的角色，持有被写入的 mailbox
- **cc-flow-bridge** —— 维持 team 存在的 in-process 占位 teammate

若你需要的概念不在词汇表中，这是一个信号——要么你在发明项目不使用的语言（重新考虑），要么存在真实的术语缺口（记下来交给 `/grill-with-docs`）。

## 标记 ADR 冲突

如果你的产出与某条现有 ADR 矛盾，显式指出而非静默覆盖：

> _与 ADR 2026-06-20（Flow 使用 Team Mailbox 注入通道）冲突——但值得重新讨论，因为……_
