# DSH Plugins

用于开发 DeepSeek Harness（DSH）插件的多包仓库。插件按用途分类，每个插件独立安装、版本化和发布；仓库共享开发工具与 agent 约定。

首个业务插件 [dsh-codex](plugins/runtime/codex/README.md) 已实现本地 Codex 模型接入，真实账号推理与桌面交互待验收。脚手架不计入插件目录。

[dsh-workbench](plugins/ui/workbench/README.md) 提供常驻功能栏、分区与嵌套项目、原生会话和右栏标签。0.3.0 已在隔离 Web 验证项目会话行为，并在 macOS Desktop 实测右栏与整体缩放。

## 开始开发

需要 Node.js >=24.9.0 与 pnpm 11.7.0。

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm create:plugin host-tool development my-tool
pnpm install
pnpm --filter dsh-my-tool check
```

`create:plugin` 的参数依次是模板、类别和插件短名。其他模板为 `client-ui`、`full-stack`、`skill-bundle`。创建后先填写真实用途与支持状态，再更新目录：

```sh
pnpm catalog:generate
pnpm check
```

## 导航

- [插件目录](docs/plugins.md)、[分类规则](docs/plugin-categories.md)与[插件归档](archived/README.md)
- [贡献指南](CONTRIBUTING.md)、[开发与本地加载](docs/development.md)
- [架构](docs/architecture.md)、[测试](docs/testing.md)、[宿主兼容](docs/compatibility.md)
- [发布](docs/releasing.md)、[安全边界](docs/security.md)
- Agent 从 [AGENTS.md](AGENTS.md) 开始。

## 目录

`plugins/<category>/<name>/` 保存独立插件，`packages/` 按需保存共享包，`templates/` 保存四类脚手架，`scripts/` 保存仓库工具，`docs/` 保存当前事实，`.agents/` 保存专项流程与长期决定。

九类为 development、knowledge、research、integrations、automation、ui、media、runtime、security；有插件时才创建对应类别目录。
