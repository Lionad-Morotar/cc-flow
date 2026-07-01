---
name: cc-flow:open-bridge
description: 在当前 CC 会话启动 cc-flow bridge，让外部进程可以通过 HTTP 或 MCP 工具向本会话注入上下文
argument-hint: "[description]"
---

## 上下文

- Flow：指 cc-flow 或新队员“flow”
- skill 目录：`${CLAUDE_SKILL_DIR}`
- Flow Bridge：`${CLAUDE_PLUGIN_ROOT}/scripts/flow-bridge.js` 与 `flow-bootstrap.js`
- Cleanup Hook：`${CLAUDE_PLUGIN_ROOT}/scripts/flow-cleanup.js`

- 当前会话 ID：`${CLAUDE_SESSION_ID}`（取前 8 位即为 `sessionShortId`）
- Flow 注册表：`~/.claude/cc-flow/<sessionShortId>.json`

## Workflow

0. 执行当前技能的项目可能曾经打开过 bridge，但注意：/Users/lionad/Github/Lionad-Morotar/cc-flow/skills/open-bridge/SKILL.md
  0.1 项目内曾经打开的 bridge 或创建的 registry 和当前会话执行的 Workflow 可能没有关联
  0.2 一般用户不会在同一个会话打开两次 bridge，但如果碰到错误需要排查这种情况
1. 计算必须的值：
  1.1 `sessionShortId` = `${CLAUDE_SESSION_ID}` 的前 8 位。
  1.2 基于当前会话上下文，生成一段**不超过 100 个字符**的描述，说明这个会话在做什么、当前状态。若用户提供了位置参数，优先使用用户输入；否则由你生成。
2. 用 Agent 工具创建 teammate “flow”（placeholder，用于保持子会话活跃）：
   ```json
   {
     "description": "cc-flow teammate flow",
     "prompt": "You are cc-flow flow, a teammate for keep communicate bridge alive. Do not perform any tasks, do not call tools, do not send messages. Stay idle and wait. Acknowledge once with a single 'OK' and then remain silent.",
     "name": "cc-flow-bridge",
     "model": "haiku",
     "run_in_background": true
   }
   ```
   记下 Agent 返回结果中的 `agent_id`，例如 `cc-flow-bridge@session-<subSessionShortId>`。bridge 必须指向这个**子会话 team 目录** `~/.claude/teams/session-<subSessionShortId>`，因为当前 CC 版本主会话轮询的是该目录下的 `inboxes/team-lead.json`。
3. 启动 Flow Bridge。端口用 `0` 由系统分配。token 由 bootstrap 自动生成并通过环境变量传给 bridge —— **不要**在命令行传入 token（命令行参数会进 shell history 与进程 argv）：
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/flow-bootstrap.js \
     --team cc-flow-<sessionShortId> \
     --team-dir ~/.claude/teams/session-<subSessionShortId> \
     --port 0 \
     --session-id ${CLAUDE_SESSION_ID} \
     --registry ~/.claude/cc-flow/<sessionShortId>.json \
     --description "<生成的描述>"
   ```
   - 必须显式传入 `--team-dir`：当前 Claude Code 版本中，Agent 工具创建的 teammate 运行在子会话；主会话实际轮询的是子会话 team 的 leader inbox，因此 `--team-dir` 必须指向 Agent 结果中的 `session-<subSessionShortId>`。
   - 若未传 `--team-dir`，bootstrap 会自动查找包含 `cc-flow-bridge` 成员的 team 目录；找不到时再按主会话 `leadSessionId` 回退（旧行为）。
   - 幂等：若注册表已有存活进程，输出 `FLOW_BRIDGE_ALREADY_RUNNING port=... pid=...`，直接复用其 port/pid。
   - 否则输出 `FLOW_BRIDGE_STARTED port=... pid=...`。
4. 告知调用方如何取 token（curl 调用需要）。**不要**用 Read 工具读取完整 registry 内容（会让 token 进入 CC transcript）；只把取 token 的命令交给调用方在其自己的 shell 里执行：`jq -r .authToken ~/.claude/cc-flow/<sessionShortId>.json`。注册表文件权限 0600，仅当前用户可读。
5. 返回调用示例：
   - curl（`<port>` 取自 `FLOW_BRIDGE_STARTED` 输出，`<token>` 取自第 4 步读到的 `authToken`）：
     ```bash
     curl -X POST http://127.0.0.1:<port>/inject \
       -H "Authorization: Bearer <token>" \
       -H "Content-Type: application/json" \
       -d '{"text": "your message here"}'
     ```
   - MCP（在另一个 CC 会话中）：
     ```
     使用 cc-flow MCP server 的 send 工具，sessionShortId=<sessionShortId>，text=...
     ```

## 已知限制

- 消息投递依赖 Claude Code 主会话轮询 leader inbox。当前观察到的行为是：主会话轮询的是 Agent 工具创建的子会话 team 的 `team-lead.json`，因此 `--team-dir` 必须指向该子会话目录；指向其他目录时消息不会进入主会话。
