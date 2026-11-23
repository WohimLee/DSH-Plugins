# dsh-qoder

通过官方 Qoder Agent SDK，把 Qoder 登录可用的模型接入 DSH 模型选择器。模型选择器按账号显示 Qoder 返回的可用档位和具体模型。启动时检查账号，只有查到可用模型的账号才显示在 Models 和会话模型菜单里。

## DSH 原生行为与接入方式

- **原生行为**。DSH 从宿主模型目录提供会话选模，并负责工具审批、执行和对话持久化。
- **接入方式**。通过 `ctx.llm.registerAdapter` 为可用的 CLI 登录或账号新增 `qoder`、`qoder-account-<id>` 路由。账号失去可用模型时从目录撤回其路由。通过 `settings.section` 提供独立设置，并以 `id: 'qoder'` 向 Model Picker 的 `modelPicker.connections` 贡献连接卡片。 [Host 入口](src/index.ts) · [客户端注册](src/client/index.tsx)
- **验证证据**。在 Desktop `0.2.2-rc.5` 已实测从管理页授权并自动加载可用模型。真实 CLI 登录推理和 PAT 模拟验证见[验证记录](#验证)与 [plugin.meta.json](plugin.meta.json)。

## 安装和使用

需要 DSH `0.2.2-rc.5`、Node.js >=24.9.0，以及运行 DSH 的机器上的 Qoder CLI。SDK 固定为 `1.0.59`，搭配的原生 Qoder CLI 版本为 `1.1.83`。

按 [Qoder CLI 安装指南](https://docs.qoder.com/cli/installation) 安装 CLI 后，在 **模型管理 → Qoder → 设置 Qoder** 或 **设置 → Qoder** 点击「连接 Qoder」，再点「前往 Qoder 授权」。在浏览器选定账号并确认后，插件自动刷新模型目录。等待期间可以取消，链接过期后可重新连接。浏览器授权由官方 CLI 管理。已配置默认 PAT 的用户继续使用宿主凭据引用 `QODER_PERSONAL_ACCESS_TOKEN`。

在仓库根目录构建 tarball。

```sh
pnpm install --frozen-lockfile
pnpm --filter dsh-qoder check
pnpm --filter dsh-qoder pack --pack-destination /tmp
```

Web 使用对应版本的 DSH CLI 安装。安装参数 `--ignore-scripts` 跳过 SDK 自带的运行时下载脚本，插件使用已安装的 Qoder CLI。

```sh
dsh plugin --profile web add /tmp/dsh-qoder-0.1.11.tgz --ignore-scripts
```

Desktop 可以用桌面自带的 DSH CLI 把 `--profile web` 改为 `--profile desktop`。若从 Desktop 插件页安装，在该 profile 的 `pnpm-workspace.yaml` 现有 `allowBuilds` 下添加 `'@qoder-ai/qoder-agent-sdk': false`，即可跳过该 SDK 的下载脚本。重启宿主后，打开 **设置 → Qoder** 查看账号状态。

插件在宿主的 `PATH` 和常见的本机安装目录查找 `qodercli`。若 Desktop 无法从启动环境找到 CLI，在安装后已有的插件配置行填写绝对路径，以下是该行的配置示例。

```yaml
- id: dsh-qoder:main
  config:
    cliPath: /absolute/path/to/qodercli
```

推理强度和默认档位取自当前账号的 SDK 模型目录。没有声明档位的模型使用厂商默认行为。

## 绑定账号

要绑定其他桌面账号，先在运行 DSH 的机器上使用独立的配置目录登录 Qoder。

```sh
qodercli --config-dir /absolute/path/to/qoder-profile login
```

在 **模型管理 → Qoder → Desktop → 添加桌面账号** 填写该目录的绝对路径。插件核对登录账号并使用该目录读取模型、查询用量和发起推理。DSH 保存目录、备注及账号标识的摘要。若目录中的登录账号发生变化，需要解绑后重新绑定。解绑会移除 DSH 的模型路由，Qoder 目录和登录由 Qoder 自己管理。

### 绑定 PAT

1. 在每个账号的 [Qoder 账号集成设置](https://qoder.com/account/integrations) 创建个人访问令牌（PAT）。
2. 在 DSH 打开 **设置 → Qoder → 添加账号**，填入该账号的 PAT。备注可留空，也可填写「个人」「工作」等名称。通过模型目录验证后，DSH 凭据服务保存 PAT 和备注。换绑验证失败时保留当前凭据。
3. 状态显示「已连接」并列出可用模型数量后，即可从会话模型菜单选中相应账号的模型。切换 Qoder CLI 登录、模型目录变化或连接失败时，可在这里点「刷新账号」。

账号卡片可随时修改备注、更换令牌或解绑。修改备注会更新模型菜单显示名称，已有会话继续使用同一账号。0.1.2 已绑定的账号会沿用原凭据引用和会话路由，可以直接补填备注。

如需自定义环境变量，可在插件配置行添加 `accounts`。账号 ID 用于保存会话模型路由，`name` 是默认备注。凭据引用只写名称，`models` 如有填写会从实时目录中筛选指定 ID。

```yaml
- id: dsh-qoder:main
  config:
    accounts:
      - id: my-account
        name: 我的 Qoder 账号
        tokenEnv: QODER_CUSTOM_PAT
```

模型选择器使用插件报告的套餐、额外购买和组织 Credits。目录查询、用量和推理都使用所选账号的同一凭据。装有 `dsh-model-picker` 时，命名账号归在 Qoder 的二级菜单内。

## 模型和工具行为

支持文本对话、推理和文本流、token 用量及取消。每次调用在临时目录创建独立的 Qoder 会话，把 DSH 历史及工具结果作为结构化文本交给 Qoder。DSH 持久化对话。Qoder 的原生工具和用户设置来源在 SDK 请求中关闭，DSH 工具通过进程内 MCP 提供定义，模型提出的调用交由 DSH 审批和执行。

每个账号分别从 SDK 目录读取默认上下文、厂商窗口档位、输入和输出上限、推理档位及说明。只有有效的默认上下文进入 DSH 的上下文预算；最大输入和输出在模型详情中单列。调用可传输出预算，插件在厂商披露上限时检查该预算。支持 DSH 函数工具与结果回放；temperature 和 stop 参数会被拒绝。

插件从 CLI 登录会话的 `getAvailableModels()` 或 PAT 的 `getModels()` 读取视觉标记 `isVl`。只有所选账号模型明确声明视觉能力且宿主提供附件服务时才接收图片，包括目录中明确声明该能力的 auto 路由。未披露或关闭视觉能力时仅接收文本，模型说明标明原因。刷新账号后目录重新评估能力。发送时从宿主读取本次请求规格的图片，通过 Qoder SDK 原生图片块发送；已卸载的历史图片保留为文字占位。

如果 Qoder 的模型队列在内部恢复后仍未完成，DSH 会显示 `QODER_MODEL_QUEUE_EXHAUSTED`。请稍后重试，或从输入框手动切换模型后再发送。插件不会自动更改账号或模型，也不会在 Qoder 自身的队列恢复之后额外重试。

## 验证

```sh
pnpm --filter dsh-qoder check
pnpm --filter dsh-qoder test:host
```

合成测试覆盖未绑定时隐藏模型、备注持久化、旧版绑定兼容、账号目录与凭据隔离、历史和工具定义、流式响应、取消及卸载。宿主测试检查 tarball 并在隔离 Web profile 中安装、启动。2026-11-20 本机已登录 CLI 目录的 17 个启用模型均声明视觉能力，默认上下文为 200000，均未声明最大输出。本次适配器使用合成 PNG 及真实登录，在 auto 和 smodel 两条路由分别读对随机八位码并正常结束。PAT 目录与账号切换通过合成测试。

## 源码组织评估

采用 workspace 源码组织和独立安装包。插件由本仓库统一维护，和 DSH 基线、构建及目录工具一起验证。Qoder SDK 作为版本锁定的依赖消费，CLI 由宿主机提供。目前没有独立仓库权限、维护团队或上游源码同步需求。维护边界或源码来源改变时，再评估 Git submodule。
