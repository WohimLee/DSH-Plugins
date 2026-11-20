# dsh-codex

通过本机 Codex CLI 的 OAuth 登录，将 Codex 模型作为 `codex` 提供者接入 DSH 原生循环。DSH 继续负责工具执行和审批，插件向 Codex Responses 端点发送模型请求。

提供文本与推理流、工具调用和结果回放、token 用量、推理强度选择、请求取消及卸载清理。模型声明图片输入且宿主提供附件服务时，可以直接发送截图。插件读取 DSH 规范化后的图片，按消息中的顺序发送文字与图片。音频、原生文件上传、temperature 和 stop 暂未接入。Codex 后端管理输出预算，DSH 的 maxTokens 不转换为请求字段。

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
dsh plugin --profile web add /tmp/dsh-codex-0.1.8.tgz
```

重启后在模型选择器选择 **Codex** 下的模型。Desktop 应在桌面应用的插件页安装该 tarball；桌面版为插件兼容基线，随实际桌面版升级验证，不通过版本豁免安装。包保持 private，未发布 npm。

## 模型与登录配置

左侧栏「模型管理」可检查本机登录状态。只有检测到本机登录凭据时，Codex 模型才进入 DSH 模型目录。

默认目录取 `CODEX_HOME`，未设置时取 `~/.codex`。只读 `auth.json` 的 OAuth access token 和 account ID，每次请求重新读取；不保存副本、不读取 refresh token、不改写登录文件。401/403 提示重新执行 `codex login`，刷新由 Codex CLI 管理。远程宿主读取的是宿主机器的目录。

默认从 `models_cache.json` 读取可见且 `supported_in_api=true` 的对话模型。目录刷新时重新核对输入模态、模型说明、上下文、推理档位、档位说明及默认值。能力说明标注目录中的最大上下文、有效比例、默认摘要、详略、服务档位和接入限制。请求采用模型的默认摘要策略。未披露输入模态的模型保留文本对话入口。缓存不存在时模型列表为空。也可在插件配置中显式填写账号可用的模型。

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

此片段用于修改安装后已有行。`models` 决定可选模型和顺序，显式字段覆盖同 ID 缓存中的字段，空数组表示不提供模型。凭据由 Codex CLI 管理。

## 验证与边界

配合 `dsh-model-picker` 时，插件通过现有 Codex CLI 的 App Server 查询账号额度，显示各窗口剩余比例和重置时间。默认从宿主 PATH 查找 `codex`，Desktop 找不到时可在插件配置中设置 `codexPath` 为 CLI 的绝对路径。额度查询和推理使用同一个 Codex 配置目录。

```sh
pnpm --filter dsh-codex check
pnpm --filter dsh-codex test:host
```

单元和契约测试使用合成凭据、临时目录和模拟响应，包含真实 Cordis/LLM 服务的注册、prepareCall、卸载与重载。`test:host` 构建 tarball，检查发布文件，然后用临时 DSH_HOME 安装并启动真实 Web 宿主，不读取日常 DSH home，不发送模型请求。2026-11-18 已在 macOS Desktop 0.2.2-rc.3 安装并启用 0.1.2，模型选择器显示 Codex 分组及 10 个本地缓存模型。2026-11-20 使用 Desktop 内置 Node 24.21.0 调用 0.1.6 适配器，在当前 macOS 手动 HTTPS 代理下使用真实账号发送简短提示，GPT-6.2-Astra high 返回文本与正常结束帧。

网络端点固定为 `https://chatgpt.com/backend-api/codex/responses`，禁止自动跟随重定向。上游错误正文不进入日志和终端失败信息；HTTP 状态保留为安全诊断。网络或流中断交给宿主重试策略，插件不另建重试循环。该端点和 Codex 本地文件格式可能变化，当前实现不代表 OpenAI 对第三方接入的稳定性承诺。

## 参考

设计参考 [goodjin/dsh-codex](https://github.com/goodjin/dsh-codex/tree/32964dcfe1bf4d760a2f5f039f4429c341002b46) 的模型提供者方式及 Responses 协议。本实现直接依赖固定版本 DSH 的公开 `LlmAdapter`，不引入参考项目的 modelkit、Client 路由和 OAuth 刷新逻辑。
