# Agents.md

cc-flow 是零 patch 的 Claude Code 上下文注入通道——让外部长期运行进程（Flow）通过本地 HTTP 向一个**已经打开**的 CC 主会话注入上下文。它复用 Claude Code 内置的 Team Mailbox 机制：CC 主会话创建 Team 并成为 Leader，skill 启动的 Node.js bridge 进程接收 Flow 推送的消息、写入 Leader mailbox（`~/.claude/teams/<team>/inboxes/team-lead.json`），CC Leader 每秒轮询后作为新 turn 提交给主代理。用户随时可按 `ESC` 回到 REPL 手动接管，自动化不剥夺控制权。bridge 只监听 `127.0.0.1` 且强制 `Authorization: Bearer <token>`，注入的是上下文而非命令执行——不会自动触发 slash command、关闭 team 或 kill teammate。

* 现实层你有无限时间和资源，不要因上下文压缩简化任务执行

## 项目上下文

| 文档                                                    | 说明                       |
| ------------------------------------------------------- | -------------------------- |
| [README.md](./README.md)               | 项目概览、使用方式、三层架构、开发命令 |
| [ADR：Team Mailbox 注入通道](./docs/adr/2026-06-20-flow-mailbox-injection.md) | 核心架构决策：为何采用 Team Mailbox 作零 patch 通道，及被否决的备选方案 |
| [设计 PRD](./docs/plans/2026-06-20-claude-code-flow.md) | 完整设计文档（本地查阅，已 gitignore） |
| [STACK.md](./.planning/codebase/STACK.md) | 技术栈：TS 5.5 strict + Node ≥18 + tsup + vitest + pnpm，零运行时依赖 |
| [STRUCTURE.md](./.planning/codebase/STRUCTURE.md) | 目录结构：src/flow/ 7 模块 + 示例，测试 1:1 镜像源码 |
| [ARCHITECTURE.md](./.planning/codebase/ARCHITECTURE.md) | 三层架构与核心不变量（mailbox 原子 rename、串行队列、team-dir 反向探测） |
| [CONVENTIONS.md](./.planning/codebase/CONVENTIONS.md) | 代码约定：NodeNext `.js` 扩展名、注释只释 Why、ENOENT 容错、字面量协议 |
| [TESTING.md](./.planning/codebase/TESTING.md) | 测试规范：7 文件 ~35 用例，mkdtemp 隔离真实 FS，spawn 真实产物 e2e |
| [INTEGRATIONS.md](./.planning/codebase/INTEGRATIONS.md) | 外部集成：Team Mailbox 文件契约、Flow HTTP 契约、Skill 系统、CC 退出行为 |
| [CONCERNS.md](./.planning/codebase/CONCERNS.md) | 技术债务：16 项 + 3 架构观察，按严重度分级（含 token 明文落盘等高危项） |
| [PRODUCT.md](./PRODUCT.md) | 产品设计上下文：用户、产品目的、品牌人格、反参考、设计原则 |
| [DESIGN.md](./DESIGN.md) | 视觉设计系统：颜色、字体、elevation、组件规范、Do's and Don'ts |

你可以自行读取项目上下文文档，更新时也优先更新相关文档。

## Agent skills

### 领域文档（Domain docs）

Single-context：领域语言见根 `CONTEXT.md`（由 `/grill-with-docs` 懒创建），架构决策见 `docs/adr/`。详见 [docs/agents/domain.md](./docs/agents/domain.md)。
