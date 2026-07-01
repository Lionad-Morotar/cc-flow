# cc-flow 领域术语表

本文件记录 cc-flow 项目中的核心领域术语。不包含实现细节，仅用于统一语言。

## 术语

**cc-flow**

Claude Code plugin，用于让外部长期运行进程向一个已经打开的 CC 主会话注入上下文。包含 `/cc-flow:open-bridge` skill、`cc-flow` MCP server 和 SessionEnd cleanup hook。

**Flow**

外部长期运行进程。它可以通过 HTTP POST 或 MCP `send` 工具向 Flow Bridge 推送消息。

**Flow Bridge**

本地 Node.js HTTP server，监听 `127.0.0.1`。它接收 Flow 推送的消息，追加到 Leader Mailbox。

**Flow Registry**

按 CC session 保存的 JSON 文件，位于 `~/.claude/cc-flow/<sessionShortId>.json`。记录 bridge 的端口、token、team 目录、会话描述和项目信息，供 MCP server 发现与会话清理使用。

**Leader Mailbox**

CC Team Leader 的收件箱文件，路径形如 `~/.claude/teams/<team>/inboxes/team-lead.json`。Flow Bridge 写入，CC Leader 每秒轮询读取。

**Placeholder Teammate**

名为 `cc-flow-bridge` 的后台 teammate，仅用于维持 Team 存在，不参与实际对话。

**Open Bridge**

`/cc-flow:open-bridge` skill 的简称。调用后会在当前 CC 会话创建 Placeholder Teammate 并启动 Flow Bridge。

**SessionEnd Cleanup**

CC 会话结束时触发的 plugin hook，负责 kill 当前会话的 Flow Bridge 并删除对应 Flow Registry。

**cc-flow MCP Server**

plugin 提供的 MCP server，暴露 `list` 和 `send` 工具，让其他 CC 会话通过 MCP 协议发现并发送上下文到 Flow Bridge。
