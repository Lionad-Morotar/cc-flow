# cc-flow

![cc-flow cover](./assets/cover-banner.png)

> Claude Code plugin：零 patch 的上下文注入通道——让外部长期运行进程（Flow）通过本地 HTTP 或 MCP 工具向一个**已经打开**的 CC 主会话注入上下文。

## 这是什么

cc-flow 利用 Claude Code 内置的 **Team Mailbox** 机制，构建一条无需 patch CC 二进制、无需启动新 CC 实例的注入通道。外部 Flow 进程把消息推给本地 Node.js bridge，bridge 写入 CC Leader 的 mailbox，CC 每秒轮询后作为新 turn 提交给主代理。

用户随时可以按 `ESC` 回到 REPL 手动接管——自动化不会剥夺控制权。

## 安装

cc-flow 以 Claude Code plugin 形式分发：

```bash
/plugin marketplace add Lionad-Morotar/claude-plugins
/plugin marketplace update lionad-morotar
/plugin install cc-flow@lionad-morotar
```

> 若 `/plugin install cc-flow@lionad-morotar` 提示 `Plugin "cc-flow" not found in marketplace "lionad-morotar"`，通常是 marketplace 缓存未刷新，先执行 `/plugin marketplace update lionad-morotar` 即可。

安装后重启 Claude Code，即可获得：

- `/cc-flow:open-bridge` skill
- `cc-flow` MCP server（工具：`list`、`send`）
- `SessionEnd` hook（自动清理 bridge 和 registry）

## 典型使用场景

* 主会话使用 GLM 作为主程，另外展开一个或多个不同模型的 Side Sessions 作为实时的 Code Reviewer
* 主会话启动 cc-flow，外部长期运行进程（Flow）通过 HTTP/MCP 向主会话实时注入上下文

欢迎补充更多案例

## 使用

### 启用 Flow

在 CC 主会话中调用 skill：

```
/cc-flow:open-bridge
```

skill 会创建占位 teammate、启动 bridge（token 由 bootstrap 自动生成并写入注册表），并返回 `port`、`pid` 以及 `sessionShortId`。需要 token 调用 curl 时，从注册表 `~/.claude/cc-flow/<sessionShortId>.json` 的 `authToken` 字段读取（文件权限 0600）。

### 通过 MCP 注入上下文

在另一个 CC 会话中，使用 `cc-flow` MCP server 的 `send` 工具：

```json
{
  "sessionShortId": "a1b2c3d4",
  "text": "Current hour: 14:00, system load normal.",
  "from": "hourly-flow"
}
```

### 通过 curl 注入上下文

`<port>` 取自 `FLOW_BRIDGE_STARTED` 输出，`<token>` 取自注册表（bootstrap 自动生成，落盘到 `~/.claude/cc-flow/<sessionShortId>.json`）：

```bash
TOKEN=$(jq -r .authToken ~/.claude/cc-flow/<sessionShortId>.json)
curl -X POST http://127.0.0.1:<port>/inject \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "Current hour: 14:00, system load normal."}'
```

### 列出可用会话

使用 `cc-flow` MCP server 的 `list` 工具，可以查看所有当前可注入的 cc-flow 会话：

```json
{
  "sessions": [
    {
      "sessionShortId": "a1b2c3d4",
      "description": "正在调试 cc-flow MCP plugin",
      "project": {
        "name": "cc-flow",
        "path": "/Users/lionad/Github/Lionad-Morotar/cc-flow",
        "rootPath": "/Users/lionad/Github/Lionad-Morotar/cc-flow"
      },
      "startedAt": "2026-06-25T00:00:00.000Z",
      "port": 12345,
      "pid": 12345
    }
  ]
}
```

### 关闭 Flow

当前 session 正常关闭时，`SessionEnd` hook 会自动清理 bridge、team 目录与注册表文件。

旧的 `/cc-flow:open-bridge --off` 方式已废弃，新 skill 不再接收 `--off` 参数。

## 安全边界

- bridge 只监听 `127.0.0.1`，每次请求必须携带 `Authorization: Bearer <token>`。
- token 由 bootstrap 自动生成、经环境变量传递（不进进程 argv / shell history），落盘到权限 0600 的注册表文件。在“同 uid = 信任域”前提下，token 仅作防呆与 defense in depth，不防御同 uid 恶意进程——设计取舍见 `docs/adr/2026-06-29-fork1-trust-boundary.md`。
- 注入的文本以普通 teammate_message 进入主会话，LLM 按自然语言理解——**不会**自动执行 slash command、关闭 team 或 kill teammate。Flow 是“上下文注入”，不是“远程命令执行”。
- MCP server 只与本地 bridge 通信，复用 registry 中的 bearer token，不引入新的暴露面。

## 开发

```bash
pnpm install
pnpm build         # 生成 scripts/*.js
pnpm test          # 运行根项目 tests/flow、tests/mcp
```

## 工作原理

三层架构：

1. **CC 主会话 + cc-flow-bridge 占位 teammate**：用户通过 `/cc-flow:open-bridge` skill 触发，CC 主会话创建 Team 并成为 Leader，同时创建一个名为 `cc-flow-bridge` 的 in-process 占位 teammate，仅用于维持 team 存在。
2. **Node.js bridge 进程**：由 skill 启动，监听 `127.0.0.1`，接收 Flow 推送的消息，写入 Leader mailbox（`~/.claude/teams/<team>/inboxes/team-lead.json`）。
3. **Flow（第三方进程 / MCP server）**：
   - 用户自定义的长期运行进程，通过 HTTP POST 推送消息（任意语言）。
   - `cc-flow` MCP server 通过读取 `~/.claude/cc-flow/*.json` 注册表，提供 `list` 和 `send` 工具。

## 项目结构

```
.claude-plugin/
  marketplace.json                     # marketplace 入口
  plugin.json                          # plugin 元数据 + mcpServers
hooks/hooks.json                       # SessionEnd cleanup
skills/open-bridge/SKILL.md            # /cc-flow:open-bridge
scripts/                               # tsup 构建产物
  flow-bridge.js
  flow-bootstrap.js
  flow-cleanup.js
  cc-flow-mcp.js
src/
  flow/                                # bridge/bootstrap/registry/mailbox 源码
  mcp/server.ts                        # MCP server 源码
tests/                                 # plugin 测试
```

## 设计文档

- [ADR：使用 Team Mailbox 作为零 patch 注入通道](docs/adr/2026-06-20-flow-mailbox-injection.md)
- [PRD：cc-flow MCP Plugin 迁移](docs/plans/2026-06-25-cc-flow-mcp-plugin.md)
- [CONTEXT.md](CONTEXT.md)

## License

PolyForm Noncommercial License 1.0.0 —— 允许个人使用、研究、教育、慈善等非商业目的，**禁止商业使用**。详见 [LICENSE](LICENSE) 与[协议全文](https://polyformproject.org/licenses/noncommercial/1.0.0/)。
