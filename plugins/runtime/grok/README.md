# dsh-grok

使用 xAI API Key 将 Grok 语言模型接入 DSH。需要 DSH `0.2.2-rc.5`。

## DSH 原生行为与接入方式

- **原生行为**。会话菜单从 DSH 模型目录读取可选模型。宿主提供凭据存储、流式回复和工具执行。
- **接入方式**。验证密钥并读取可用模型后，通过 `ctx.llm.registerAdapter` 发布该账号的路由，断开时撤回。原版默认连接保留 `grok` 路由。通过共享的 `agent/request-error` 处理明确的推理连接失败，按账号绑定等待的取消信号。客户端在 `settings.section` 提供设置入口，并以 `id: 'grok'` 向 Model Picker 的 `modelPicker.connections` 贡献连接卡片及 API 账号配置。 [Host 入口](src/index.ts) · [客户端注册](src/client/index.tsx)
- **验证证据**。隔离 Web 已通过回环 API 验证连接、流式回复和断开。Desktop `0.2.2-rc.5` 已验证管理页卡片，真实 xAI 账号推理待验收。 [plugin.meta.json](plugin.meta.json)

## 连接

1. 在 [xAI Console](https://console.x.ai/) 创建具有推理权限的普通 API Key。
2. 从 **模型管理 → 添加厂商 → Grok** 选择 **API**，填入账号名称和密钥。单独安装时可从 **设置 → Grok** 添加账号。
3. 插件验证密钥并发布该账号的语言模型。连接成功后，可从 **模型管理 → Grok → API** 查看账号、继续添加、更换密钥或断开连接。更换失败时保留原连接。

模型发现与聊天共用同一网络路径。macOS 若未配置宿主代理环境变量，两者均使用系统手动 HTTPS 代理并遵循主机例外名单。

各账号的密钥分别保存在 DSH 宿主凭据存储，模型目录和推理使用同一账号。推理经 xAI Responses API，复用 DSH 的流式响应、函数调用和附件处理。余额和总用量可在 xAI Console 查看。在 macOS 的 Desktop 选项可以检测是否安装 Grok Bot。DSH 通过 API Key 接入 Grok。有关 API Key 和账单的说明见 [xAI API 参考](https://docs.x.ai/developers/rest-api-reference/inference) 和 [API Billing FAQ](https://docs.x.ai/developers/faq/billing)。

可选推理档位和默认值来自当前密钥的语言模型目录；缺少能力声明时，聊天使用 xAI 的默认行为。[模型目录接口](https://docs.x.ai/developers/rest-api-reference/inference/models)

模型目录注明本次接入可发送的输入类型、上下文与最大输出的来源。容量优先取当前账号的语言模型目录，再查补充目录、内置模型资料，最后采用插件回退值。启用图片还需要宿主附件服务。推理使用 DSH 函数工具，支持 temperature 与输出长度；stop 及服务档位等选项受当前接入限制。

## 请求失败恢复

在挂载 `@deepseek-ai/dsh-llm-retry` 的 Agent 会话中，Grok 将明确的 xAI HTTP 限流、暂时性服务错误、超时、已知传输中断、已识别的 Responses 流内服务错误和空完成交给宿主。宿主在同一失败步骤最多再尝试 5 次；合法的 `Retry-After` 由宿主处理，超过当前 10 秒上限时不自动重试。认证、余额或额度耗尽、请求无效、内容拒绝、未知失败和取消不由 Grok 的重试策略重试。HTTP 行为参见 [xAI Debugging Errors](https://docs.x.ai/developers/debugging)。

若对 xAI Responses 的建连阶段确认网络不可达或 DNS 暂时失败，Agent 会话会进入独立的等网分支：按 5、10、20、40、60 秒退避（后续间隔上限 60 秒），自首次连接失败起 10 分钟后不再结束等待并交回宿主重试；该时限不截断后续请求准备或已发出的请求。停止会话、断开账号、更换密钥或卸载插件均结束等待。目录与密钥验证、HTTP 错误、证书失败和已开始的响应流不进入此分支。等网不消耗普通重试预算，恢复时只重发失败的模型步骤，不重跑已完成的工具。

插件与 SDK 每次只发出一次请求，直接调用 `ctx.llm.stream()` 也不会自动重试。失败诊断只保留归一错误码、HTTP 状态和有效的等待时长等必要字段，不记录上游错误原文、标头、请求 ID 或凭据。Grok 只发送 DSH 执行的函数工具声明，不启用 xAI 服务端工具；失败的流不会成为可执行工具调用，重试可能重新计费。

## 验证

```sh
pnpm --filter dsh-grok check
pnpm --filter dsh-grok test:host
```

宿主测试使用临时 DSH home、合成凭据和回环 API，覆盖页面连接、聊天发请求、断开后撤销模型目录。本机 Desktop 0.2.2-rc.5 已验证 0.1.1 的卡片展开与收起。真实 xAI 账号推理待验收。

## 源码组织评估

采用 workspace，单独构建和打包。插件由本仓库统一维护，直接使用 DSH 凭据服务和模型管理插槽，第三方客户端通过依赖引入。出现独立维护团队、权限或外部源码同步需求时重新评估 Git submodule。
