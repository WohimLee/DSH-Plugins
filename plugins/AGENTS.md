# 插件开发契约

本文件叠加根 AGENTS。先查 [分类](../docs/plugin-categories.md)、[兼容](../docs/compatibility.md)和[测试](../docs/testing.md)。

- 开发每个新插件前，先完成 [源码组织评估](../docs/architecture.md#新插件源码组织评估)；创建后在插件 README 记录 workspace 或 Git submodule 的选择、事实依据和重新评估条件，不要求每个插件单建设计笔记。
- 开发前运行 `pnpm check:dsh-version` 核对仓库基线；采用新 Desktop 作为开发基线时，通过 `--require-desktop` 或 `--desktop-version <实际版本>` 核对。发布包的 `engines.dsh` 根据宿主契约和跨版本验证声明。Desktop 落在该范围内且原产物验证通过时，继续使用原包。
- 插件路径固定为 `<category>/<slug>`，包名为 `dsh-<slug>`；一个插件只放一个类别。
- 一个可安装产品可同时包含 Host、Client 和 Skill；不按技术层拆成多个类别副本。
- `package.json` 拥有包名、版本、依赖、导出、发布文件和 `engines.dsh`；`plugin.meta.json` 拥有目录标签与各运行环境的验证状态。
- `src/index.ts` 为 Host 入口。Client 在 `src/client/`，通过 `dsh.client` 和模块加载器注册；不捆绑第二份 React 或 Cordis。
- 声明实际需要的 inject 与 peerDependencies。服务实现通过依赖注入交互；不要 import 其他插件内部文件。
- 用框架注册可回收效果；手工创建的连接、进程、监听器通过 effect 释放。必要测试覆盖卸载、重载和取消。
- 外部输入在边界验证；日志不输出凭据。默认使用合成数据与隔离测试 home。
- 新插件从模板生成后必须重写用途、行为与验收；示例 echo/面板不是业务实现。
- 修改一个插件先运行其 check 与直接相关测试；共享包变化再扩大到真实消费者。
- 发布前检查 tarball 的入口、patch、Client、locale、Skill 与文档，不能依赖 monorepo 相邻文件。
- 子目录 AGENTS 只用于确有特殊约束的插件，不逐包复制共同规则。
