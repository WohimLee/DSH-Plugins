# 架构

## 包边界

plugins/<category>/<slug> 是独立的安装与版本边界。类别目录只作容器，不持有 package.json。packages/<name> 仅在多个消费者确需共享代码时新增；禁止跨插件相对路径 import。

workspace 包路径是 plugins/*/* 与 packages/*。templates 是可复制的独立脚手架；生成器补齐构建配置与包元数据，生成的包不依赖仓库外的个人路径。共享依赖使用 workspace 协议时，发布前用 pnpm pack 检查其转换与可获取性。

模板的 TypeScript 配置保持自包含，check:infra 核对它们与 tsconfig.base.json 的公共选项一致；已生成插件需要特殊配置时在自身包内维护，并在升级公共默认值时复核实际影响。

## 新插件源码组织评估

每次开发新插件前，都要评估是否适合使用 Git submodule，不能因为已有插件使用 workspace 就省略评估。当前默认沿用 workspace；根据实际需求选择，不因插件可独立发布、内部模块较多或可能被复用就拆成子仓库。

评估至少覆盖以下方面：

| 方面 | 需要判断的问题 |
| --- | --- |
| 维护与权限 | 是否已有独立维护团队、仓库权限或独立 Issue/PR 流程需求？ |
| 源码来源 | 是否需要保留外部上游历史并持续同步？若只消费第三方库，包依赖是否已足够？ |
| 变更耦合 | 是否经常与其它插件、公共工具和配置同步修改？多仓库是否会增加提交与版本协调成本？ |
| 工具与交付 | 是否能维护子仓库提交及主仓库引用，处理递归克隆、仓库访问、固定提交、CI 初始化、锁文件和目录校验，并独立构建、打包与安装？ |

统一维护且频繁联动的自研插件通常适合 workspace。已有独立仓库边界，且主仓库确需组合其特定源码提交时，可选择 submodule；独立仓库也可以通过发布包消费，不必挂载为 submodule。采用 submodule 前须验证现有生成、扫描、构建和 CI 流程是否兼容，不能将当前 workspace 检查视为已支持 submodule 的证据。

结论与事实依据在创建前说明，创建后连同重新评估条件写入插件 README。跨插件的长期取舍进入 [设计记录](../.agents/notes/README.md)，普通插件无需额外笔记。使用 submodule 仍须遵守分类路径、独立包与宿主兼容契约。

## DSH 扩展边界

Cordis 插件注册服务、工具和效果，Bundle 的 cordis.patch.yml 负责安装后的组合。一个产品可以包含多个插件行。Host 与 Client 各自有入口；Client 产物通过 window.__ModuleLoader__.load 注册工厂，框架与 React 使用宿主模块实例。

工具模板注册 echo 工具；界面模板注册全局导航与页面；full-stack 同包组合这两项；skill-bundle 注册包内 Skill provider。示例刻意无真实外部副作用。

扩展优先依赖服务定义，不依赖具体模型、执行后端或可替换 loop。复杂能力在角色确需独立演进时才分为 definition/provider/consumer。

## 事实所有权

package.json 保存可执行发布契约；plugin.meta.json 保存分类、标签和表面验证状态。scripts/generate-catalog.mjs 从两者生成 docs/plugins.md。docs/plugin-categories.json 是类别 ID 与中文说明的唯一数据来源。

根 package.json 为 private，统一开发工具与精确宿主基线；根依赖和模板随选定的开发基线迁移。各插件拥有独立发布版本，不捆绑发布或自动发布。
