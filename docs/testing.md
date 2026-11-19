# 测试策略

## 证据层次

| 变化 | 最小检查 | 不能替代的证据 |
| --- | --- | --- |
| 普通文档 | 内容、链接、git diff --check | 业务运行 |
| 目录与 manifest | check:plugins、catalog:check | 可安装产物 |
| 治理脚本 | test:infra，覆盖拒绝非法输入等行为 | 宿主运行 |
| Desktop 基线同步 | check:dsh-version、check、check:templates、test:host | 目标 Desktop 交互 |
| 插件实现 | 目标包 check、直接相关测试 | 真实服务接入 |
| 脚手架或构建工具 | check:templates | DSH 安装与加载 |
| Bundle、宿主接口 | test:host 和受影响功能 | Desktop 交互 |
| Client 行为 | 工厂注册、实际渲染/交互与卸载 | 仅类型检查 |

check:templates 在临时目录生成四类插件，执行类型检查、构建、打包、入口 import、Client 工厂注册与组件渲染，检查产物文件和卸载清理。test:host 在此基础上通过真实 DSH CLI 安装 tarball，检查配置树、Web 启动与 Client 资源交付。网络、安装、启动失败都应如实报告。

没有业务插件时，pnpm check 的 workspace 部分为空是正常状态，不能把它宣称为业务测试通过。脚手架验证单独运行，避免每次文档改动启动完整宿主。


业务插件的跨版本验证先用 `pnpm pack --pack-destination <产物目录>` 打包。Codex 与 Workbench 的 `test:host` 可通过 `DSH_TEST_ARTIFACT_DIR` 指向各自的产物目录。逐个使用 `DSH_TEST_CLI` 指向单独安装的目标版本 `@deepseek-ai/dsh/lib/bin.js`，将同一份 tarball 安装到各自隔离的测试 home。用宿主输出的具体版本记录测试结果。

## 场景

Host 工具覆盖有效/无效输入、失败与取消；资源型插件覆盖重复加载、卸载和资源释放；Client 覆盖入口、交互、重载和清理；Skill 覆盖发布内容、provider 发现和加载。新增外部集成使用边界替身和合成数据，需要真实账户的验证单独说明。

选能证明验收的最低检查层。已有成功证据未因改动失效时可复用；失败先定位，不盲目重跑到绿、不放宽断言掩盖问题。
