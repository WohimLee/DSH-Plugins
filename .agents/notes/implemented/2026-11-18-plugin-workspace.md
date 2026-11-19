# 分类式多插件仓库

状态：implemented

## 问题

仓库起初只有 README，维护者计划开发多个 DSH 插件，需要统一 agent 入口、分类、独立包和可重复验证。

## 决定

采用 pnpm workspace，插件位于 plugins/<category>/<slug>；一个产品一个主类别和独立版本。共享包按实际消费者新增。以 dev-template/dsh 的精简分层为基础，裁剪固定 dev 分支、强制双语、目录矩阵及无关专项流程；未整套引入 nexa 或 samso 阶段状态。

选择精确的 npm DSH 0.2.2-rc.1 开发基线，而非调查时 master 的 0.2.2-rc.4。提供四种脚手架，默认 private；包归属和许可证尚未确定。发布不属于初始化动作。

## 影响与验证

插件可独立构建、打包与安装；分类和运行环境状态集中生成目录。宿主升级需要联动验证依赖与模块协议。

初始化验证覆盖治理脚本拒绝非法路径/重名/越界 patch/无证据 verified，四种模板的类型构建、行为、Client 工厂与渲染、tarball，以及真实 DSH CLI 安装、组合、Web 启动、Client 资源 HTTP 交付和移除。未调用模型。Desktop 实际交互和跨版本支持未验证；CI 配置尚未在 GitHub 上执行。
