# ADR 2026-06-29: Fork 1 信任边界与 token 角色重定义

## Status

Accepted

## Context

Flow Bridge 用 `Authorization: Bearer <token>` 鉴权，token 明文落盘到 Flow Registry（`~/.claude/cc-flow/<sessionShortId>.json`）。用户提出安全担忧：本地恶意进程读取 token 后可伪造请求向主会话注入上下文。

经审问厘清两层事实：

1. **威胁分层**：bridge 只 bind `127.0.0.1`，已挡死远程与局域网其他机器（L1/L2）。token 在当前架构下唯一作用是防御**本机其他进程**（L3）。而本机其他进程几乎都以**同一 uid** 运行（npm 包、浏览器渲染进程、IDE 插件、shell 脚本）。
2. **共享秘密在共享信任域内的局限**：对称 token 是共享秘密；同 uid 进程能读你所有文件、读进程 argv、甚至 attach 进程内存，因此纯靠 token 这种对称秘密**防不住 L3**。注意这是**工程取舍而非数学必然**——OS keychain（同 uid 仍需解锁）、Unix Domain Socket + 0700、短时效 token/配对码都能抬高 L3 攻击成本；本 ADR 选择不引入这些机制（UX 与实现成本），而非它们不可能。强行用 chmod/hash/不落盘等"同形态"手段加固对 L3 无效或仅治标。

同时发现 token 当前携带多处**不必要的明文泄漏把柄**：进程 argv（`ps`/`/proc/cmdline` 全局可读）、skill 执行链路的 shell history 与 CC transcript、32bit 低熵、非恒定时间比较。这些把柄不提供真实安全价值，却会误导 reviewer 并留下低级攻击面。

## Decision

在“同 uid 进程集合 = 当前范围接受的信任边界”这一工程取舍下，重新定义 token 的角色并消除技术把柄（不引入 keychain/UDS 等更强机制的成本）：

1. **信任域定义**：同 uid 进程集合 = 信任域。token 不对该域提供防御，仅提供（a）**防呆**——防止本机其他 localhost 服务无意识地误连 bridge 端口注入垃圾；（b）**defense in depth**——作为 bind `127.0.0.1` 之外的第二道墙，防未来 bind 被误改成 `0.0.0.0` 或路由器误配端口转发时不至于瞬间裸奔。

2. **token 生成上移**：token 由 bootstrap 自行生成（256bit 随机），不再由 open-bridge skill 生成并通过命令行传入。消除 skill 执行链路的命令参数、shell history、CC transcript 泄漏。

3. **进程间传递改环境变量**：bootstrap 向 bridge 子进程传递 token 改用环境变量，消除进程 argv 泄漏（`/proc/<pid>/cmdline` 全局可读是比读文件更廉价的攻击面）。

4. **强度与权限卫生**：token 熵提升至 256bit；比较使用恒定时间算法；Flow Registry 文件 0600、目录 0700（挡其他 uid，单用户机器边际收益小但成本为零）。

5. **接受明文落盘**：token 以明文存于 Flow Registry（不 hash、不加密）。理由：**在当前架构下**（Browser Extension 与 curl 客户端直接从 registry JSON 读 token 构造 Authorization 头），hash 存储或不持久化都会断链。这是"当前架构锁死"而非物理约束——改用 Native Messaging 让扩展不持久化 token、或 curl 端从 OS keyring 取 token、或 bridge 对 loopback 用 UDS 免 token，都可打破；这些属 Fork 2 / 未来加固范围，本 ADR 不引入。

## Alternatives Considered

### 1. Fork 2：跨机器动态设备身份系统

- **Deferred**：局域网多智能体协作（任意机器当 leader、动态加入、扩展跨机器）需要配对码/mTLS/设备信任列表等子系统，工作量按月计。当前无真实多机器协作场景驱动，留作未来独立 ADR。本 ADR 只是**线格式上未排除** Fork 2（保留了 Authorization 头位置与 bridge 验签钩子），并非为其"预留骨架"——Fork 2 应从第一性原则设计设备身份，不要假设能继承当前对称 token 机制。

### 2. token hash 存储（bridge 端比 hash）

- **Rejected**：Browser Extension 与 curl 客户端需原始 token 放入 Authorization 头。注册表存 hash 则客户端拿不到原始 token，断链。除非重新设计扩展鉴权（见备选 4），否则不可行。

### 3. token 不持久化（每次重启重新生成）

- **Rejected**：Browser Extension 跨重启从 Flow Registry 读 token；不持久化则扩展断链。同样受"扩展需原始 token"约束。

### 4. 去掉 token，loopback 免鉴权 + 随机端口防呆

- **Rejected**：逻辑上自洽（同 uid = 信任域则 loopback 即充分鉴权），但（a）失去 defense in depth 的第二道墙；（b）需改扩展协议；（c）"随机端口防呆"是 security through obscurity，不构成鉴权替代——随机端口只降低误连概率，不提供身份验证。保留 token 提供真实（虽弱）的鉴权语义。

### 5. obscurity token（端口/sessionShortId 的确定性派生）

- **Rejected**：确定性 token 既失去保密性（等于无 token），又没简化多少复杂度，两头不讨好。

## Consequences

### Positive

- **诚实可辩护**：明确 token 防不住 L3（且这是工程取舍、列出了被否决的更强手段），比假装能防更稳健；未来 contributor 不会误把“明文落盘”当疏忽去“修复”它，也不会误以为 L3 风险被“数学上”接受而停止质疑。
- **消除低级把柄**：进程 argv / shell history / 低熵 / timing 等不必要的泄漏面被清除；注册表权限收紧。（CC transcript 泄漏被**减少而非消除**——skill 仍需读 registry 把 token 交给 curl 调用方，见 Negative。）

### Negative

- **不防同 uid 恶意进程**：信任域内的攻击（被攻陷的 npm 包、恶意 IDE 扩展等）仍可读注册表拿 token 伪造注入。
- **注入危害上界不容乐观**：“注入的是上下文非命令”这一说法**具有误导性**——在 CC 的交互模型里上下文即指令源，精心构造的注入可诱导主代理执行危险操作（删文件、推代码）或泄露本地 secrets（`~/.env`、`~/.ssh/`）。ESC 只能在用户**发现异常后**止损，消息可能已被消费并产生动作。缓释靠：注入消息带明显外部来源标记（`from: 'flow'`）、用户保持警觉、未来可加速率限制与审计日志。
- **CC transcript 泄漏仅被减少，未消除**：token 生成上移消除了 skill 命令行与 shell history 泄漏，但 skill 仍需把 token 交给 curl 调用方，token 会出现在 CC transcript 里。本 ADR 不宣称“消除”transcript 泄漏，仅声称“减少”；skill 输出规范应避免把真实 token 代入命令文本。
- **扩展存储是另一条信任边界**：Browser Extension 把 token 存入 `browser.storage.local`，离开了 0600 文件系统的保护。其他扩展（借权限）、浏览器 profile 备份/同步、扩展 XSS 都可能触及。本 ADR 范围内未对此加固（属扩展协议），仅记录。
- **明文落盘对备份/同步路径暴露**：0600/0700 只防其他 uid，挡不住 Time Machine、iCloud Drive、home 目录打包分享等以同 uid 运行的备份/同步——token 会随文件迁移、旧备份复活已撤销 token。长期解法是迁出明文落盘（keychain / Native Messaging）。
- **token 明文落盘在当前架构下不可消除**：受“扩展/curl 直读 registry”约束，只能靠权限收紧与本 ADR 记录。
- **Fork 2 需从零设计**：跨机器协作不能在本架构上简单“加 token + bind 0.0.0.0”，需要独立的设备身份系统。

## Related

- 上游 ADR：`docs/adr/2026-06-20-flow-mailbox-injection.md`（Team Mailbox 零 patch 注入通道）
- PRD：`docs/plans/2026-06-29-fork1-token-hardening.md`
- 术语表：`CONTEXT.md`（Flow Bridge、Flow Registry）
- 技术债务：`.planning/codebase/CONCERNS.md` C1（已据此 ADR 降级为"已接受"）
