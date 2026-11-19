# 发布指南

当前无发布账号、scope 和仓库许可证决议；插件生成时 private=true。初始化不发布、不自动打 tag，不配置发布令牌。

## 插件独立发布

1. 确认包名可用、发布归属和许可证，在包中填写 license 并将 private 设为 false。
2. 更新该插件版本与 CHANGELOG，核实 DSH 兼容与运行环境证据。
3. 运行目标包 check、相关测试及宿主验证，更新插件目录。
4. 在插件目录执行 `pnpm pack --pack-destination <临时目录>`，检查 tarball；用它安装到隔离 profile 验证，不能只验证工作区链接。
5. 按明确发布授权发布审核过的同一个 tarball。发布后核对注册表版本与安装结果。

发布文件须包含入口、Bundle patch、Client 产物（如有）、locale、Skill 资源（如有）及用户文档。禁止包含凭据、用户会话、测试 home 和本机路径。共享包若被产物依赖，必须先有可获取版本。

npm tarball 应已预构建。Git 源码安装可能涉及 prepare 与 pnpm 构建许可，不保证等同于 tarball 安装；当前模板推荐预构建 tarball 或 npm 分发。
