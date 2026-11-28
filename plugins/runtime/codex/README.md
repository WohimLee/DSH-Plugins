# dsh-codex

通过本机 Codex CLI 的 ChatGPT 登录或 OpenAI API Key，将 Codex 模型接入 DSH 原生循环。DSH 继续负责工具执行和审批，插件根据连接方式请求对应的 Responses 端点。

提供文本与推理流、工具调用和结果回放、token 用量、推理强度选择、请求取消及卸载清理。模型声明图片输入且宿主提供附件服务时，可以直接发送截图。插件读取 DSH 规范化后的图片，按消息中的顺序发送文字与图片。音频、原生文件上传、temperature 和 stop 暂未接入。桌面连接由 Codex 后端管理输出预算，API 连接将 DSH 配置的输出预算传入 `max_output_tokens`。

## DSH 原生行为与接入方式

- **原生行为**。会话从 DSH 模型选择器或 `/model` 选择宿主模型目录里的路由，由 DSH 执行工具和保存会话。
- **接入方式**。通过 `ctx.llm.registerAdapter` 注册默认 `codex` 及额外桌面账号的 `codex-account-*` 路由。API 账号以独立的 `codex-api-account-*` 路由注册。适配器将流式回复和模型提出的工具调用交回 DSH。停用会撤销插件的适配器注册。 [Host 入口](src/index.ts)
- **验证证据**。在 macOS Desktop `0.2.2-rc.5` 的独立 Worktree 会话中，已通过 0.1.9 选择 GPT-6.2-Sol high 并收到真实回复。 [plugin.meta.json](plugin.meta.json)

## 前提与安装

开发基线为 DSH `0.2.2-rc.5`，发布宿主范围以 package.json 的 `engines.dsh` 为准，Node.js >=24.9.0。运行 DSH 的用户需先执行 `codex login`，且 Codex 使用文件存储登录凭据。仅保存在系统钥匙串中的登录暂不支持。

在仓库根目录构建安装包：

```sh
pnpm install --frozen-lockfile
pnpm --filter dsh-codex check
pnpm --filter dsh-codex pack --pack-destination /tmp
```

在目标 DSH 环境运行（替换 tarball 路径）：

```sh
dsh plugin --profile web add /tmp/dsh-codex-0.1.12.tgz
```

重启后在模型选择器选择 **Codex** 下的模型。Desktop 应在桌面应用的插件页安装该 tarball；桌面版为插件兼容基线，随实际桌面版升级验证，不通过版本豁免安装。包保持 private，未发布 npm。

## 模型与登录配置

左侧栏「模型管理」分别显示能否找到本机 Codex CLI 和是否检测到文件登录。只有检测到本机登录凭据时，Codex 模型才进入 DSH 模型目录。

默认目录取 `CODEX_HOME`，未设置时取 `~/.codex`。只读 `auth.json` 的 OAuth access token 和 account ID，每次请求重新读取；不保存副本、不读取 refresh token、不改写登录文件。401/403 提示重新执行 `codex login`，刷新由 Codex CLI 管理。远程宿主读取的是宿主机器的目录。

在模型管理的 Codex 页面可添加已登录的额外目录。先为该账号创建独立的 Codex 配置目录，通过 `CODEX_HOME=/absolute/path/to/profile codex login` 完成 ChatGPT 登录，并启动该配置下的 CLI 以建立模型缓存。在模型管理填写宿主机器上的目录绝对路径与备注。插件在宿主凭据存储中保留路径、备注和账号标识的散列，删除绑定会撤销对应路由。目录内原有登录由 Codex CLI 管理，同一个目录或 Codex 账号标识只绑定一次。 [Codex 身份验证](https://developers.openai.com/codex/auth)

### API 账号

模型管理中选择 API，输入独立的账号备注和具备 Models 读取及 Responses 写入权限的 OpenAI API Key。插件使用 `GET /v1/models` 查询该密钥可见的 Codex 模型，验证出至少一个后才保存连接。API Key 由 DSH 宿主凭据存储保存，模型请求发送至 `POST /v1/responses`，费用归该密钥所属 API 项目。每个账号可独立刷新或移除，刷新发现密钥无效或没有可选模型时撤回其模型路由。 [Models API](https://developers.openai.com/api/reference/resources/models/methods/list) · [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)

默认从 `models_cache.json` 读取可见且 `supported_in_api=true` 的对话模型。目录刷新时重新核对输入模态、模型说明、上下文、推理档位、档位说明及默认值。能力说明标注目录中的最大上下文、有效比例、默认摘要、详略、服务档位和接入限制。请求采用模型的默认摘要策略。未披露输入模态的模型保留文本对话入口。也可在插件配置中显式填写账号可用的模型。

当多个版本的 Codex 共用登录目录时，DSH 按账号和 Codex 配置目录在 `$DSH_HOME/cache/dsh-codex`（默认 `~/.dsh/cache/dsh-codex`）保存带版本与时间的模型元数据。较旧客户端覆盖共享缓存时，DSH 继续使用已取得的较新目录。同版本后续刷新或更高版本可更新目录，显式 `models` 配置继续决定可选模型及顺序。若有意降级 Codex，可在关闭 DSH 后清除上述 DSH 模型缓存目录以重新建档。

```yaml
- insert:
    - id: dsh-codex:main
      name: dsh-codex
      config:
        codexHome: /absolute/path/to/.codex
        models:
          - id: <账号可用的模型ID>
            name: Codex Model
            # 按实际能力覆盖同 ID 缓存中的模态、contextWindow、efforts 和 defaultEffort
            inputModalities: [text, image]
```

macOS 上，DSH 已配置的代理环境变量优先。若没有这些变量，推理请求读取系统手动 HTTPS 代理并使用 CONNECT 连接到 Codex。支持主机例外名单；使用 PAC 或自动发现的网络可通过宿主的 HTTPS_PROXY 配置代理。

此片段用于修改安装后已有行。`models` 决定默认 Codex 账号的可选模型和顺序，显式字段覆盖同 ID 缓存中的字段，空数组表示不提供模型。额外账号读取各自的目录缓存。凭据由 Codex CLI 管理。

## 验证与边界

配合 `dsh-model-picker` 时，插件通过现有 Codex CLI 的 App Server 查询账号额度，显示各窗口剩余比例和重置时间。默认从宿主 PATH、常见安装目录及 macOS ChatGPT 应用的内置 CLI 查找 `codex`。也可在插件配置中设置 `codexPath` 为 CLI 的绝对路径。额度查询和推理使用对应账号的同一 Codex 配置目录。

```sh
pnpm --filter dsh-codex check
pnpm --filter dsh-codex test:host
```

单元和契约测试使用合成凭据、临时目录和模拟响应，包含真实 Cordis/LLM 服务的注册、prepareCall、卸载与重载。`test:host` 构建 tarball，检查发布文件，然后用临时 DSH_HOME 安装并启动真实 Web 宿主，不读取日常 DSH home，不发送模型请求。2026-11-18 已在 macOS Desktop 0.2.2-rc.3 安装并启用 0.1.2，模型选择器显示 Codex 分组及 10 个本地缓存模型。2026-11-20 使用 Desktop 内置 Node 24.21.0 调用 0.1.6 适配器，在当前 macOS 手动 HTTPS 代理下使用真实账号发送简短提示，GPT-6.2-Astra high 返回文本与正常结束帧。

桌面账号指定 `https://chatgpt.com/backend-api/codex/responses`，API 账号使用 `https://api.openai.com/v1` 的官方接口。两种连接均拒绝自动跟随重定向。已知过载、限流、服务端故障、超时或流中断交由 DSH 对失败的模型请求执行有限重试；额度耗尽、凭据错误、无效请求和无法分类的流式错误不盲重试。

桌面账号（默认及额外绑定）和 OpenAI API 推理在建立连接时遇到明确的网络不可达或 DNS 临时失败，会通过 DSH 的 `agent/request-error` 单独等待网络，按 5、10、20、40 秒递增，此后每 60 秒尝试一次。首次连接失败后 10 分钟内才允许结束等待、交回宿主重试（睡眠也计入时限）；该期限不截断后续请求准备或已发出的请求。只重发当前模型步骤，不切换账号或模型，不重跑已完成的工具，不消耗普通重试次数。聊天使用宿主的原生重试行，展开可见连接失败原因；可用原生停止按钮取消，账号解绑或插件卸载也结束等待。应用退出后不自动恢复定时器。HTTP 错误、通用超时、证书错误、响应流中断、模型目录刷新和账号操作不进入此分支。

错误诊断不保存上游正文、提示词、凭据或任意自定义错误码。只保留已知归类、HTTP 状态、符合预期格式的 `x-request-id` 和可识别的 `Retry-After`。桌面端点和 Codex 本地文件格式可能随 Codex 版本变化。

## 参考

设计参考 [goodjin/dsh-codex](https://github.com/goodjin/dsh-codex/tree/32964dcfe1bf4d760a2f5f039f4429c341002b46) 的模型提供者方式及 Responses 协议。本实现直接依赖固定版本 DSH 的公开 `LlmAdapter`，不引入参考项目的 modelkit、Client 路由和 OAuth 刷新逻辑。
