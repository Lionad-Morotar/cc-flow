# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-06-30

### Added

- Claude Code plugin 形态：支持通过 `claude plugin marketplace add` 或本地 `--plugin-dir` 加载。
- `/cc-flow:open-bridge` skill：在当前 CC 会话启动 Flow Bridge。
- cc-flow MCP server：提供 `list` 与 `send` 工具，支持跨会话上下文注入。
- SessionEnd hook：会话结束时自动清理 bridge、registry 与 team 目录。
- Flow Registry：记录会话元数据（description、project、port、pid、authToken）。
- 项目信息推断：基于 cwd 自动识别项目名与路径。
- 本地 HTTP bridge：监听 `127.0.0.1`，支持 `POST /inject` 与 `GET /status`。
- `/files/tmp` 接口：支持临时文件与截图上传。
- 完整测试套件：vitest 覆盖核心模块与 MCP server。

### Security

- bridge 仅接受 localhost 请求，并要求 Bearer token 鉴权。
- token 由 bootstrap 自动生成、经环境变量传递（不进进程 argv / shell history），落盘到权限 0600 的注册表文件。
- MCP `send` 工具在连接失败时脱敏错误，避免泄露 authToken。
- Flow Registry 文件权限 0600、目录 0700。
