# dsh-model-picker

从左侧栏的线缆图标进入「模型管理」。页面默认显示 Overview，Models 侧栏依次列出 Overview、Add provider 和已连接的厂商。Overview 的单列连接清单与左栏共用连接状态，点击厂商或连接行进入对应详情。窄窗口的导航自动换行，可用模型可按厂商展开。

在 Add provider 选择厂商和连接方式。Desktop 显示安装及登录检测，API 显示对应凭据配置。详情的 Desktop 与 API 分区分别显示账号与适用的添加入口。Codex 0.1.10 与 Qoder 0.1.10 可通过独立、已登录的配置目录关联桌面账号。Codex 的 API 分区使用 OpenAI API Key，Qoder 使用 PAT，Grok 0.1.4 使用 xAI API Key。DeepSeek 原生登录由 DSH 账号菜单管理，命名 API 账号可从管理页添加。Grok 通过 API 接入。

在 DSH 输入框的模型菜单中，悬停「Effort」打开推理档位，悬停「Models」先打开厂商列表。把指针移到厂商上，再展开该厂商的模型选择。厂商、模型和 Effort 面板按各自内容定宽定高。单个显著超长模型名显示省略号，悬停、键盘聚焦或触屏首次点按可查看全名。相邻项和子菜单之间可以移动指针，移出分支后逐级收起。窄窗优先使用上下停靠，触屏可逐级点按。键盘可用方向键进入或返回，搜索覆盖所有已加载的厂商和账号。模型列表和搜索结果标注已知的 Desktop 或 API 来源。选中模型才改变当前会话的选择，结果与 `/model` 共用同一份状态。推理强度菜单读取当前账号与模型声明的档位。切换模型时保留仍受支持的显式档位，否则采用目标模型的默认值。没有声明档位时，输入框隐藏该菜单并省略选择参数。团队设置和其他菜单扩展由原生菜单管理。

在厂商详情的用量区选择账号。鼠标悬停或键盘聚焦圆环可查看明细。

- **DeepSeek** 显示已登录平台账号的钱包余额及赠金。配置了 API Key 时，可在用量区选择对应计费入口。
- **Codex** 优先用周剩余比例绘制圆环，明细列出各时间窗口和重置时间。连接状态需 [dsh-codex 0.1.5](../../runtime/codex/README.md)。
- **Qoder** 按所选账号展示套餐、额外购买和组织 Credits。连接卡片需 [dsh-qoder 0.1.5](../../runtime/qoder/README.md)。
- **Grok** 的 API 用量可从连接详情前往 xAI Console 查看。

厂商只返回余额或未返回可计算的额度比例时，圆环保留中性样式。没有用量数据时明细显示「用量暂不可用」。

展开管理页的厂商可以查看每个模型的说明、接入限制与推理档位。详情中的「查看可用模型」直接展开该厂商的目录。账号与模型目录变化后，页面重新读取宿主目录。

## DSH 原生行为与接入方式

- **原生行为**。输入框的模型菜单由 `@deepseek-ai/dsh-client-ui-model-selection` 的 `ModelSelect` 渲染，负责当前会话的模型和推理强度选择。 [宿主菜单源码](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/packages/client/ui-model-selection/src/client/ModelSelect.tsx#L550-L554)
- **接入方式**。向 `conversation.input.model.options` 加入 `id: 'dsh-model-picker'`、`order: -100` 的「Models / 模型」菜单项，复用会话的模型目录和模型选择操作。另以 `dsh-model-picker` 为键在 `main` 注册管理页，并在 `sidebar.panellist` 增加入口。停用时这些贡献随插件移除。 [客户端注册](src/client/index.tsx)
- **验证证据**。DSH `0.2.2-rc.5` 的隔离 Web 已验证模型选择和热启停，Desktop 已验证管理页入口及原生推理强度菜单。 [plugin.meta.json](plugin.meta.json)

## 安装与验证

需要 DSH `0.2.2-rc.5`、Node.js >=24.9.0。该插件可以与 Workbench 独立安装。

```sh
pnpm --filter dsh-model-picker check
pnpm --filter dsh-model-picker pack --pack-destination /tmp
dsh plugin --profile web add /tmp/dsh-model-picker-0.2.4.tgz
```

Desktop 可以在插件页安装 tarball。隔离 Web 验证使用 `pnpm --filter dsh-model-picker test:host`，需要本机 Chrome 或 `DSH_TEST_BROWSER_EXECUTABLE`。测试使用合成输入和临时 profile。

## 接入其他厂商

适配器在账号就绪后发布可用模型，解绑后撤回相应路由，并通过 DSH 的模型目录事件通知界面刷新。可用路由自动进入模型管理页和模型选择器。

需要提供连接表单的适配器可通过 `ctx.slots.inject` 注册 `modelPicker.connections`。它是 root 作用域的 list 插槽，贡献 ID 使用厂商标识。贡献组件通过 `renderCard` 提供摘要，可附上 `connection` 声明连接状态、账号数、各方式的详情与配置内容，并监听 `refresh` 响应刷新。账号凭据由适配器使用宿主支持的机制保存。

概览和厂商导航的图标按模型管理设计稿呈现。Grok 概览卡片使用应用图标。[App Store 的 Grok 应用图标](https://apps.apple.com/us/app/grok-ai/id6670324846)

## 源码组织评估

使用现有 workspace，由 DSH-Plugins 统一维护并独立打包。模型选择和额度查询通过宿主接口接入，源码无需追踪第三方历史。若维护权限或发布流程形成独立仓库边界，再评估 Git submodule。
