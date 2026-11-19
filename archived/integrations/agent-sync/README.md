# Codex 连接器

`dsh-agent-sync` 0.1.1 于 2026-11-19 归档。此目录保留原插件源码、测试和验证记录。归档包已移出常规 workspace 和插件目录。

## 原使用方式

在 DSH 打开「连接器 → Codex」，点击「连接并同步」。成功后，安装了 `dsh-workbench` 的用户可在项目侧栏顶部选择 DSH 或 Codex。选中 Codex 时，侧栏按原项目、工作目录和会话显示同步结果。未归入项目的会话按工作目录显示。点击会话会在 Host 所在的 macOS 上打开原 Codex 会话。

## 同步设置

- 工作目录可留空，填写时按 Host 上的绝对路径精确匹配。默认同步未归档会话，可以选择包含已归档会话。
- 「立即同步」更新项目和会话列表。同步状态保存在 Host 内存中，断开连接、停用连接器或重启 Host 后需要重新连接。
- 连接器使用 Host 已登录的 Codex，通过 App Server 读取项目和会话元数据。读取 `thread/list` 时启用当前账户过滤和状态数据库模式。项目接口不可用且返回方法不存在时，按工作目录展示会话。
- Host 通过 PATH 查找 Codex CLI，macOS 还支持默认安装位置的 ChatGPT 桌面应用。桌面跳转使用 `codex://threads/<id>`。

[Codex App Server](https://learn.chatgpt.com/docs/app-server) · [Codex 桌面链接](https://learn.chatgpt.com/docs/reference/commands)

## 源码组织评估

采用 workspace，由本仓库统一维护，连接器和工作台需要同步验证。维护权限独立或出现需持续同步的外部源码时再评估 Git submodule。

## 归档前的验证

组合测试在隔离 DSH Web Host 安装连接器和工作台的 tarball，使用合成 Codex 记录验证同步、切换和回退。本机 DSH Desktop `0.2.2-rc.5` 曾打开连接器面板。真实账户会话读取和打开原会话未验收。详见 [插件验证记录](plugin.meta.json)和[工作台集成设计](../../../.agents/notes/implemented/2026-11-18-codex-session-source.md)。
