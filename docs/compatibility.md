# 宿主兼容

## 开发基线

根依赖和四类脚手架固定到选定的 DSH 版本，当前为 `0.2.2-rc.5`。此版本来自本机 macOS Desktop 元数据，内置 Node 为 `24.21.0`。项目要求 Node >=24.9.0，Cordis 固定为 4.1.0。

`pnpm check:dsh-version` 校验根声明、已安装直接 DSH 依赖和四类模板的一致性。选择新 Desktop 作为开发基线时，再用 `--require-desktop` 对比实际版本。非默认 macOS 安装路径通过 `DSH_DESKTOP_APP` 指定，其他平台读取实际版本后传 `--desktop-version <实际版本>`。编译和验证以选定版本的已安装包为准。

## 发布兼容范围

`engines.dsh` 是发布包支持的宿主 SemVer 范围。新插件先声明精确基线。已有插件依据使用的 Host 服务、Client 接口及跨版本同包验证选择范围。共享宿主实例的依赖通过 peer 声明，开发依赖固定到选定版本。安装和启动验证须覆盖真实 tarball 和预发布版本的匹配规则。

当同一发行线已通过跨版本验证，并核对了依赖的宿主契约，可以声明有上界的发行线范围。范围可能接受尚未发布的版本，支持声明和逐版实测记录分别维护。每次有新宿主时，用已有产物复验实际加载和使用路径。跨出范围或出现不兼容变化时，更新受影响插件的声明或代码并重新打包。版本豁免不作为兼容证据。

plugin.meta.json 的 surfaces 包含 web、desktop、headless。状态只能为 unverified、verified、unsupported。verified 必须给出同一条目的 evidence，记录 DSH 版本、系统、命令或操作及结果。templates 的生成初值都是 unverified；纯界面模板的 headless 为 unsupported；full-stack 的 Host 能力可另行验证 headless。

## Web 与 Desktop

官方 Desktop 使用独立 desktop profile；web profile 的安装不影响 Desktop。桌面插件优先在应用插件页安装。使用桌面自带 CLI 时按该版本官方说明操作；npm dsh 不能替代它管理 desktop profile。

共享界面意味着具备复用路径，不等于桌面已实测。Electron Node、原生模块、外部程序、平台权限和 Client 模块协议都可能限制兼容性。

## 升级

1. 读取实际 Desktop 版本，检查每个已装插件的发布范围。范围内用原 tarball 复验关键功能并记录结果，验证通过后继续使用原包。
2. 需要支持范围外版本或适配不兼容变化时，核对目标版本包和实际宿主契约，更新受影响的插件并验证候选 tarball。
3. 选定新的开发基线时，同步根 package.json、四类模板、说明和 pnpm-lock.yaml，再运行 `pnpm check:dsh-version --require-desktop`、`pnpm check`、`pnpm check:templates` 和 `pnpm test:host`。开发基线变化本身不触发业务插件发版。
4. 复用同一份候选 tarball，在明确指定版本的隔离宿主验证。目标 Desktop 的验证记录以实际桌面交互为准，保留旧版本证据原有版本。

权威资料：[打包与版本声明](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.zh.md)、[Desktop](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md)、[Client 模块](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/modules/README.md)。
