# 插件脚手架

通过 `pnpm create:plugin <模板> <类别> <短名>` 生成；不要把 templates 加入 workspace。生成器替换 slug/category，并将 Skill 目录改为插件短名。

模板使用仓库的精确开发基线 `0.2.2-rc.5`。新插件以此作为初始宿主声明，后续按宿主契约与验证结果调整发布范围。基线迁移和兼容测试见 [宿主兼容](../docs/compatibility.md)。

- host-tool：注册最小 echo 工具。
- client-ui：无副作用 Host 载体，加全局导航与静态页面。
- full-stack：组合 echo 工具和独立静态页面；未建立后端数据到页面的桥接，实际产品按官方 Remote API 另行设计。
- skill-bundle：注册随包交付的 Skill。

构建脚本自包含；客户端外部化 React，经 DSH 模块工厂加载。模板中的占位符仅用于生成，业务插件不得残留。所有示例默认 private、支持状态 unverified。验证见 docs/testing.md（相对路径 ../docs/testing.md）。
