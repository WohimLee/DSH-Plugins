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

## DSH 原生行为与接入方式

每个在维护的插件在 README 中用一个短节交代三件事。按开发基线核对宿主源码或公开契约，描述当前实现。

1. **原生行为**。描述安装插件前的 DSH 入口或能力。界面有中英文名称时都可用于定位，并按需写出所属包、组件或注册名。纯新增功能说明借用的宿主入口或能力。
2. **接入方式**。说明插件新增、扩展或替换了什么，写明实际使用的公开插槽、服务或工具。若涉及插槽覆盖，记录 `id` 或 `key`、`priority`、数据来源和停用后的变化。
3. **验证证据**。链接已有验证记录或简述实际检查的宿主版本、环境和行为，标明相关待验项。环境支持状态与证据以插件的 `plugin.meta.json` 为准。

### 会话任务面板示例

- **原生行为**。输入框上方的「To-dos / 任务」显示当前会话的清单。组件叫 `TodoPanel`，由 `@deepseek-ai/dsh-client-ui-conversation` 中的 `conversation-todo-dock` 注册。 [宿主注册源码](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/packages/client/ui-conversation/src/client/skeleton/TodoPanel.tsx#L102-L119)
- **接入方式**。在 `conversation.input.dock` 用 `id: 'todo'`、`priority: -1` 注册组件，覆盖优先级为 `0` 的原条目。用 `useProjection('todos')` 读取由 `todo_write` 更新的清单，停用时恢复原条目。
- **验证证据**。用 DSH `0.2.2-rc.5` 的插槽包验证了覆盖和移除贡献后的恢复。Desktop 界面待验。

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

## 自动交付

提交本次审定的改动后，交付负责人在干净的任务 Worktree 运行：

```sh
pnpm deliver start <已确认的任务基线提交>
```

基线为任务开始时确认、且同时在任务 HEAD 和远端 `main` 历史中的提交。先核对待合入提交均属本次交付。脚本从最新 `origin/main` 创建临时检出并合并任务 HEAD，运行检查，按实际改动选出 Desktop 插件。它从同一集成提交构建、检查并打包，传入隔离宿主测试，再以普通快进推送和核对远端。每次交付在 `~/.dsh-plugin-artifacts/delivery.*/` 留存 `receipt.json`、构建日志和每个包的唯一 tarball。记录区分任务提交、集成提交、包版本和 SHA-256。主工作树有其他会话的改动时仍可运行。主工作树所有者按常规流程快进本地 `main`。

1. `start` 给出凭证路径并自动进入安装阶段。没有待安装的插件时，自动核对 CI。安装开始时复查远端及 Desktop 版本，并为该凭证保留独占安装时段。需要恢复安装时运行 `pnpm deliver desktop <凭证路径>`。日常 Desktop 已退出时，脚本用内置 CLI 安装并启动。Desktop 已打开时，负责人立即用电脑操作，在插件页热更新凭证列出的 tarball。若同包的更新已合入，脚本要求重建。合并冲突留在凭证记录的临时工作树，负责人解决后将解决结果整理到任务分支，再从 `start` 运行。
2. 按[本机桌面交付](#本机桌面交付)核对安装来源、开关和运行状态，操作本次需求的实际入口。开启未启用的插件并等到组件运行。需要重启时先确认日常 Desktop 当前任务已结束。依赖另一仓库的宿主改动时，要等包含该修复的宿主构建安装到日常 Desktop，随后走通实际入口。
3. 按下例记录实际操作和观察结果，每个待安装的包留一条。证据文件随凭证保留。无需安装插件的交付自动进入下一步，恢复时可运行 `finish` 并省略证据文件。

```json
{
  "desktop": {
    "dsh-workbench": {
      "enabled": true,
      "running": true,
      "result": "pass",
      "scenario": "Home 侧栏点击 New Section，随后按 Escape",
      "observed": "行内名称框获得焦点，Escape 关闭且侧栏没有新增分区"
    }
  }
}
```

4. 运行 `pnpm deliver finish <凭证路径> [桌面验收证据 JSON]`。脚本重新核对远端、日常 profile 的安装来源和归档内每个文件与安装文件的内容，记录会话取得的启用状态与实际交互证据，并自动查询集成提交触发的 GitHub Actions。CI 仍在运行时等待，超过十分钟可用同一凭证继续。全部通过才写「已交付」并释放 Desktop 安装时段。完成后把凭证、实际结果、集成提交和清理结果记到共享清单。

`pnpm deliver status <凭证路径>` 查看当前阶段。退出码 0 表示 `finish` 交付成功或查询成功，2 表示等待下一阶段，1 表示出错或已记录阻塞。遇到锁屏、无法安装、仍需重启、缺少实际验收条件或 CI 失败，负责人先尝试恢复。确实无法继续时执行 `pnpm deliver block <凭证路径> "<具体原因及恢复条件>"`，留存当前阶段并移交安装时段。恢复时重新走 `desktop` 或 `finish`。合并、检查、构建和推送阶段的任务在修复原因后从 `start` 重试。用户指定暂缓或仅交付代码时，按其要求执行并在回执中写清已完成阶段及剩余项。

## 本机桌面交付

新增桌面插件或修改其运行产物时，由执行实现任务的 Agent 完成本机安装。包括界面、Host 功能、语言资源、依赖和 bundle 配置的变化。仅涉及文档、测试、脚手架或明确仅支持其他宿主的任务可跳过。普通检查、Git 钩子和 CI 继续在工作区或隔离环境运行。

**多个会话交付同一个包时**，各自在独立工作树构建，并用各自的隔离 profile 验证。到集成和日常 Desktop 安装阶段，在[工作清单](work.md)写明该包的先后顺序和当前安装负责人。前一位记录已验收的提交、tarball 和入口后，下一位再接手。安装中断时保留当前进度和恢复条件。

后交付者先同步最新集成基线，确认待构建提交包含前一项已验收的改动（可用 `git merge-base --is-ancestor <前项提交> HEAD` 核对）。从包含两项改动的干净源码重新构建、检查并打包。安装后走通本次入口，再复验前一项受影响的入口。将源码提交、包版本、可区分本次构建的 tarball 路径或摘要、Desktop 版本和两项结果记回清单。

1. 使用交付凭证中的 tarball。Desktop 已打开时依次进入 Plugins → Add plugin → Install a third-party plugin，输入 tarball 的绝对路径，安装后按需点击 Enable now。更新同版本时也使用本次的新包。应用内更新可保留正在使用的窗口。
2. 在插件详情核对实际安装来源、开关和组件运行状态。走一次本次改动的入口。例如项目编辑改动，从项目菜单点 Edit，看到新版弹窗，再点空白处确认关闭。同包接续时复验上一项受影响的入口。
3. 用 `finish` 记录实际结果。安装失败时诊断并重试适用路径。受本机 Desktop 版本、锁屏或外部账号限制时，用 `block` 记录具体阻塞和恢复条件。

## 并行开发与集成

### 每次新需求的统筹与派发

1. **拆解需求。** 接收会话明确目标和验收条件，按可验证的结果拆成小任务，标出受影响插件、组件和任务之间的依赖。关联同一交付的子任务沿用一个条目和负责人。
2. **核对在途工作。** 读取[主工作树的共享清单](work.md)，并用宿主工具核对相关会话和子代理的实际状态。运行 `git branch -vv` 和 `git worktree list` 核对现有分支、Worktree 与基线，有交叉时在相应检出查看 `git status --short`。子代理状态仅在所属会话可见时，从该会话的进度或清单记录核对，并标明仍待确认的交叉。
3. **定归属与顺序。** 同一验收目标由已有负责人接续。独立任务可由接收会话承担，不同插件且接口独立时可并行。跨会话或共享资源的交付在条目里指定本次主理 Agent。涉及同一组件或接口，先约定负责人与交接提交。同一插件改不同组件时可并行实现，由指定负责人统一处理版本、生成目录、共享测试和最终包。
4. **登记并派发。** 按用户授权补充原条目或登记新条目，附上原会话和参考材料。获准推进后，把小任务交给明确的负责会话或获准执行的子代理，交代验收条件、写入范围、基线、依赖和交接顺序，并记回实际派发对象与状态。讨论中用「待澄清」，明确要做但尚未分配时用「待安排」。
5. **落实工作区。** 负责会话从最新确认的 `main` 为独立交付建立任务分支和 Worktree，并记录实际路径。同一交付下的子任务按分工复用适用工作区。依赖尚未合入的任务时，登记依赖提交及合并顺序。实现中扩大写入范围时先更新清单。

### 命名

分支用 `<类型>/YYYY-MM-DD-<范围>-<任务>`，Worktree 名将斜杠换成连字符。日期取创建分支当天的北京时间。范围优先用插件简称，仓库级任务用 `repo`。范围和任务用小写英文、数字和连字符。跨天和同一交付的反馈沿用原名。已有任务按原名交付；宿主分配名称时登记实际名称。

| 类型 | 用途 | 分支示例 |
| --- | --- | --- |
| `feature` | 新功能或交互改动 | `feature/2026-11-23-workbench-session-search` |
| `bugfix` | 修复现有行为 | `bugfix/2026-11-23-workbench-draft-attachments` |
| `refactor` | 保持外部行为的代码调整 | `refactor/2026-11-23-model-picker-usage-loading` |
| `docs` | 纯文档改动 | `docs/2026-11-23-repo-worktree-guide` |
| `chore` | 构建、依赖或仓库维护 | `chore/2026-11-23-repo-ci-checks` |

例如，第一个分支对应的 Worktree 名是 `feature-2026-11-23-workbench-session-search`。

### 合并、验收与清理

1. 任务负责人在独立 Worktree 检查并提交任务范围内的改动，记录待合并提交和验证结果。构建产物与隔离测试 profile 各自独立。
2. 集成负责人以最新 `main` 验证合并结果，处理共享文件和生成目录，跑受影响的检查，按[提交与推送](#提交与推送)更新集成分支。按[自动交付](#自动交付)执行合并、验证、推送和 Desktop 安装验收。同包按共享清单的交接顺序执行。
3. 主理 Agent 核对远端 `main`、验证记录和验收状态。普通合并在更新远端引用后可用 `git merge-base --is-ancestor <任务提交> origin/main` 确认；采用 squash 时记录集成提交并核对交付改动。每个任务的合入提交和验收结果写回清单。
4. 交付完成后，任务负责人检查工作树状态、其他会话和后续任务是否仍引用它，保留需要追溯的验证产物。宿主管理的 Worktree 由宿主归档，手工创建的干净工作树用 `git worktree remove` 移除，然后用 `git branch -d` 清理已合入的本地分支。远端分支按已确认的仓库清理策略处理。仍有独有改动、未完成验收或下游使用时，保留相关工作树或分支并记录原因。清理结果由负责人写回清单，主理 Agent 核对。

## 提交与推送

当前集成分支为 `main`。实现任务完成后默认随任务交付提交和推送。讨论、审查、试验性改动以及用户指定留在本地的任务按相应范围处理。

1. 查看工作区、暂存区和当前分支相对上游的提交。仅暂存本次交付范围内的改动，包括同一文件中可以单独暂存的改动。确保推送范围内的既有提交也属于本次交付。
2. 按 [测试说明](testing.md) 和 [推送前检查](../.agents/skills/dshp-pre-push-checks/SKILL.md) 验证实际交付内容，检查暂存差异。若关键检查失败，先修复。仍有阻塞时保留本地改动并说明原因。
3. 按交付阶段推送对应分支。`main` 对应 `origin/main`；需要将任务分支推送到远端交接时，首次推送设置 `origin` 的同名上游。只有分支可快进且待推送范围已确认时才推送。若有远端分歧、推送被拒绝，或无法分离任务之外的改动，保留本地工作并报告具体阻塞。
4. 核对远端提交和适用的 GitHub Actions 状态，在交付说明中列出分支、提交、实际验证和待完成项。

## 生成文件与清理

pnpm-lock.yaml 与 docs/plugins.md 提交；node_modules、lib、tarball 与测试 home 不提交。生成目录用 catalog:generate 更新，不手改。只清理由本任务创建且确认无用户数据的临时目录。
