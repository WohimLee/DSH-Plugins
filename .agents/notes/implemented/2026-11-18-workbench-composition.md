# 工作台首版保留原生界面声明者

状态：implemented

## 问题

维护者希望采用类似 Codex 的功能栏、项目会话栏和对话布局，同时使用 DSH 原生 harness 并保留其它插件的扩展能力。

DSH 0.2.2-rc.3 的 single slot 可以按 priority 遮蔽，但子插槽只允许一个声明者，渲染授权归声明者所有。直接覆盖 sidebar 或 root 后重新声明原子插槽会冲突；不声明则无法合法渲染这些子插槽。

## 决定

[dsh-workbench](../../../plugins/ui/workbench/README.md) 作为 workspace 中的单一独立包，内部按实际职责分模块。当前没有独立团队、权限或上游源码同步需求，不采用 Git submodule；这些条件变化时重新评估。

首版在 shell.overlay 添加常驻功能栏，通过宿主提供的稳定 data-slot 样式锚点为原 AppFrame 留出空间。保留原 layout/sidebar/workspace/conversation 的声明和业务状态，用原生 toggleSidebar 控制项目栏，通过 sidebar.panel.icon Factory 复用第三方面板图标。品牌使用 sidebar.brand.name 的 priority 覆盖，卸载恢复原占位者。

不采用复制内部组件、修改宿主源码、重新声明原子插槽或 DOM 重挂载。原侧栏菜单暂时保留，以免遗漏更多菜单、设置和第三方操作；中央与右侧的视觉细节另行演进。窄于 824px 时隐藏额外功能栏，回退原生窄屏布局。

## 影响与验证

首版存在重复导航入口，但原有子插槽和菜单继续有效；布局样式依赖已验证版本的稳定 data-slot 锚点，升级 Desktop 后须重新验证几何与交互。

2026-11-18，DSH 0.2.2-rc.3、macOS、Chrome 157.0.8103.79：7 项单元/注册契约测试通过；隔离宿主中的真实会话切换、新建、独立折叠、第三方面板、窄屏回退、插件管理页不刷新热停用/再启用及 CLI 移除后重启恢复通过。测试使用合成取消历史，未发送模型请求。独立只读审查未发现 P1/P2 缺陷；Web 热停用移除文档标记、样式和功能栏，再启用不产生重复功能栏且原会话与第三方面板继续可用；Desktop 原生交互尚未由这些证据证明。
