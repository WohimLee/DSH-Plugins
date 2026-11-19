# 项目上下文

DSH-Plugins 是维护 DeepSeek Harness 扩展插件的多包仓库，面向插件作者及维护者。支持 Host 工具、Client 界面、两者组合与 Skill Bundle；不维护 DSH 桌面应用 fork。

## 已确认事实

- 初始化前仅有 README 和 main 分支；当时尚无业务插件、历史发布或既有测试约定。
- 技术栈：Node.js >=24.9.0、pnpm 11.7.0、TypeScript、ESM；界面示例使用 React 18。
- 根依赖和四类脚手架的开发基线为 0.2.2-rc.5。Desktop 更新后用现有插件产物验证兼容性，开发基线单独迁移。
- dsh-codex 0.1.3、dsh-workbench 0.4.1 和 dsh-agent-sync 0.1.1 曾用同一组 tarball 在 rc.4 和 rc.5 隔离 Web 验证。rc.4 安装的插件可直接在 rc.5 启动。2026-11-19 在本机 rc.5 同名更新前两个插件并复验桌面加载。
- 插件位于 plugins/<category>/<slug>，共享包按需进入 packages；templates 不属于 workspace。
- 本地工具只操作工作区和临时测试目录，默认不接触日常 DSH home、账户或真实模型。
- dsh-workbench 位于 plugins/ui/workbench，使用公开插槽增加常驻功能栏和分区、嵌套项目、会话列表，保留原生项目会话、对话和扩展入口。采用 workspace，未使用 Git submodule。
- dsh-model-picker 位于 plugins/ui/model-picker，通过原生模型菜单的选项插槽提供厂商级联、账号切换和使用额度显示，复用宿主的会话模型目录。它与 Workbench 独立安装。
- `dsh-agent-sync` 0.1.1 于 2026-11-19 从本机 Desktop 卸载并移入[插件归档](../archived/integrations/agent-sync/README.md)。工作台的常规宿主测试独立运行。

## 导航

[架构](architecture.md)、[开发](development.md)、[测试](testing.md)、[兼容](compatibility.md)、[分类](plugin-categories.md)、[目录](plugins.md)、[发布](releasing.md)、[安全](security.md)。Agent 维护入口见 [基建说明](../.agents/README.md)。

## 待确认及影响

- 首个业务插件 dsh-codex 位于 plugins/runtime/codex，提供 Codex 模型适配；合成协议与宿主验证不等于真实账号推理验收。
- dsh-qoder 位于 plugins/runtime/qoder，使用官方 Qoder Agent SDK 和本机 CLI 注册账号实际可用的模型，设置中支持按需绑定账号及编辑备注，工具申请交回 DSH。真实账户推理与 Desktop 交互待验收。
- dsh-workbench 0.5.0 固定 DSH 0.2.2-rc.5，增加行内命名、侧栏菜单、无项目会话和工作目录编辑。隔离 Web 已验收目录重启恢复。本机 Desktop 已升级至 0.5.0，实测会话行右键和省略号菜单。
- dsh-workbench 0.3.0 已在隔离 Web 验证导航去重、右栏文件预览及项目会话行为，在 macOS Desktop 0.2.2-rc.3 实测顶部新建分区入口、独立折叠、右栏原生标签、实际文件搜索和整体缩放。Share 和 Changes 依赖宿主提供方。
- 2026-11-18 从本机应用元数据确认 macOS DSH Desktop 0.2.2-rc.3，runtime/versions.json 声明内置 Node 24.21.0；脚手架与 dsh-codex 跟随该桌面版，真实账号推理仍待验收。
- npm 账号/scope、许可证、发布渠道：插件默认 private，不执行公开发布。
- 新插件初始支持精确开发基线。已有插件按宿主契约和跨版本验证声明支持范围。
