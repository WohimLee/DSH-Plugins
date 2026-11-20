# dsh-grok

使用 xAI API Key 将 Grok 语言模型接入 DSH。需要 DSH `0.2.2-rc.5`。

## 连接

1. 在 [xAI Console](https://console.x.ai/) 创建具有推理权限的普通 API Key。
2. 在 DSH 左栏的 **模型管理 → Grok** 卡片点击 **设置 Grok**，展开后填入密钥并连接。单独安装时也可从 **设置 → Grok** 进入。
3. 插件验证密钥并读取该 Key 可用的语言模型，连接成功后在聊天的 **Models → Grok** 出现。卡片显示可用模型数，点击 **查看连接** 可以刷新、更换密钥或断开连接。更换失败时保留原连接。

模型发现与聊天共用同一网络路径。macOS 若未配置宿主代理环境变量，两者均使用系统手动 HTTPS 代理并遵循主机例外名单。

凭据保存在 DSH 宿主凭据存储。推理经 xAI Responses API，复用 DSH 的流式响应、函数调用和附件处理。API 计费使用 xAI Console 的 API 余额或账单。余额和总用量可在控制台查看。当前版本提供一个 API Key 连接。有关 API Key 和账单的说明见 [xAI API 参考](https://docs.x.ai/developers/rest-api-reference/inference) 和 [API Billing FAQ](https://docs.x.ai/developers/faq/billing)。

可选推理档位和默认值来自当前密钥的语言模型目录；缺少能力声明时，聊天使用 xAI 的默认行为。[模型目录接口](https://docs.x.ai/developers/rest-api-reference/inference/models)

模型目录注明本次接入可发送的输入类型、上下文与最大输出的来源。容量优先取当前账号的语言模型目录，再查补充目录、内置模型资料，最后采用插件回退值。启用图片还需要宿主附件服务。推理使用 DSH 函数工具，支持 temperature 与输出长度；stop 及服务档位等选项受当前接入限制。

## 验证

```sh
pnpm --filter dsh-grok check
pnpm --filter dsh-grok test:host
```

宿主测试使用临时 DSH home、合成凭据和回环 API，覆盖页面连接、聊天发请求、断开后撤销模型目录。本机 Desktop 0.2.2-rc.5 已验证 0.1.1 的卡片展开与收起。真实 xAI 账号推理待验收。

## 源码组织评估

采用 workspace，单独构建和打包。插件由本仓库统一维护，直接使用 DSH 凭据服务和模型管理插槽，第三方客户端通过依赖引入。出现独立维护团队、权限或外部源码同步需求时重新评估 Git submodule。
