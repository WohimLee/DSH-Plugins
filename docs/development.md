# 开发指南

## 环境与安装

使用 Node.js >=24.9.0、pnpm 11.7.0（packageManager 已固定）。

```sh
pnpm install --frozen-lockfile
pnpm check:dsh-version
pnpm check
pnpm check:templates
```

安装依赖需要联网；允许 esbuild 的平台二进制准备，以及测试宿主所需的 node-pty 与 dsh-subprocess-local 辅助程序准备。其余已知安装脚本显式禁用；新增脚本先核实必要性和平台条件。OTel 上游 peer 当前不接受 API 1.10，workspace 将其覆盖为兼容的 1.9.0；升级时复核此限制。

开发前运行 `pnpm check:dsh-version` 核对仓库与模板基线。选定新 Desktop 作为开发基线后，用 `pnpm check:dsh-version --require-desktop` 核对本机版本。macOS 的自定义应用路径通过 `DSH_DESKTOP_APP` 指定，其他平台可用 `--desktop-version <实际版本>`。Desktop 更新和插件兼容验证见 [升级流程](compatibility.md#升级)。

## 创建插件

每次开发新插件前，先按 [源码组织评估](architecture.md#新插件源码组织评估) 比较 workspace 与 Git submodule，说明结论与主要理由，再创建源码目录或运行生成器。采用 workspace 时使用下面的命令；采用 submodule 时先明确子仓库来源及固定提交，并安排克隆、CI 和 workspace 工具的适配。

```sh
pnpm create:plugin host-tool development my-tool
pnpm install
pnpm --filter dsh-my-tool check
pnpm catalog:generate
```

模板可选 host-tool、client-ui、full-stack、skill-bundle；类别见 [分类规则](plugin-categories.md)。生成器拒绝非法名称、未知类别、重名和已有目标，默认 private。模板包构建脚本使用自身 devDependencies，打包产物不依赖仓库工具脚本。

创建后在插件 README 的“源码组织评估”中简要记录选择、事实依据和重新评估条件。例如：采用 workspace，由本仓库统一维护且需要同步修改公共工具，暂无独立权限或上游同步需求；维护团队或源码来源变化时重新评估。评估 submodule 不代表必须采用，也不自动授权创建远端仓库或迁移已有插件。

修改 README、描述和示例，添加业务行为与必要测试。安装新插件或依赖后提交更新的锁文件。普通包的 build 产出 lib；有界面时同时产出 lib/client.js。

## 最小检查

```sh
pnpm --filter dsh-my-tool check
pnpm check:plugins
pnpm catalog:check
```

check:plugins 校验源码契约与声明文件；check:templates 额外构建和打包。pnpm check 运行基建、目录、治理脚本测试及所有 workspace 包的 check。当前不单独配置 lint，不能声称 lint 已通过。

## 隔离宿主验证

```sh
pnpm test:host
```

脚本在临时目录中构建四种模板、生成 tarball 并安装到隔离 DSH profile，执行配置预览和有超时的真实 Web 启动，不调用模型。Host 插件的工具/Skill 与 Client 插件的工厂及渲染另外检查。它不是桌面端交互验收。

手工调试真实插件时先 build 与 pack，在单独的 DSH_HOME 内通过 `pnpm exec dsh plugin --profile web add <tarball绝对路径>` 安装；如需依赖下载须联网。随后 `pnpm exec dsh web --no-open`。该 shell 必须设置隔离 DSH_HOME，不能把测试安装落入个人默认 home。临时测试通常由 test:host 自动完成，无需手工准备。

## 提交与推送

当前集成分支为 `main`。实现任务完成后默认随任务交付提交和推送。讨论、审查、试验性改动以及用户指定留在本地的任务按相应范围处理。

1. 查看工作区、暂存区和当前分支相对上游的提交。仅暂存本次交付范围内的改动，包括同一文件中可以单独暂存的改动。确保推送范围内的既有提交也属于本次交付。
2. 按 [测试说明](testing.md) 和 [推送前检查](../.agents/skills/dshp-pre-push-checks/SKILL.md) 验证实际交付内容，检查暂存差异。若关键检查失败，先修复。仍有阻塞时保留本地改动并说明原因。
3. 提交后将当前分支推送到其上游。`main` 对应 `origin/main`；首次推送 `codex/` 任务分支时设置 `origin` 的同名上游。只有分支可快进且待推送范围已确认时才推送。若有远端分歧、推送被拒绝，或无法分离任务之外的改动，保留本地工作并报告具体阻塞。
4. 核对远端提交和适用的 GitHub Actions 状态，在交付说明中列出分支、提交、实际验证和待完成项。

## 生成文件与清理

pnpm-lock.yaml 与 docs/plugins.md 提交；node_modules、lib、tarball 与测试 home 不提交。生成目录用 catalog:generate 更新，不手改。只清理由本任务创建且确认无用户数据的临时目录。
