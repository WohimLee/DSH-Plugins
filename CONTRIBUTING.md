# 贡献指南

1. 阅读 [开发指南](docs/development.md)，选定 [主类别](docs/plugin-categories.md)。
2. 用 `pnpm create:plugin <模板> <类别> <短名>` 创建独立包，再运行 `pnpm install` 同步工作区锁文件。
3. 填写真实用途、配置、限制和支持状态；用业务行为替换示例。不要将脚手架当作功能交付。
4. 运行目标插件的 check 和相关测试；改共享工具时运行 `pnpm check` 与 `pnpm check:templates`。
5. 更新 `pnpm catalog:generate`；PR 说明行为、影响、实际证据及未验证项。

仓库当前使用 `main`。开发交付按 [提交与推送](docs/development.md#提交与推送) 执行。插件各自按 [发布指南](docs/releasing.md) 发布，仓库根包保持 private。

当前尚未选定仓库许可证和 npm 发布账号。新增插件默认 private；确定许可证与发布归属后再解除，不能擅自沿用上游许可证覆盖原创代码。
