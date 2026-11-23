# dsh-model-picker

从左侧栏的线缆图标进入「模型管理」。连接卡片展示 Codex、Qoder、Grok（dsh-grok 0.1.1 起）和可用的 DeepSeek 接入。点击卡片打开独立的连接详情，可用关闭按钮或 Esc 返回。窄窗口自动改为单列。可用模型可按厂商展开。

在 DSH 输入框的菜单中悬停「Models」（中文界面为「模型」）打开选择器。浮层优先贴主菜单右边，空间不足时贴左边。双列布局按厂商行数决定高度，鼠标移到厂商行即可切换等高的模型列表，较长的列表在右栏内滚动。触屏可点按入口和厂商。搜索覆盖所有已加载的厂商和账号，选中模型才改变当前会话的选择。选择结果与 `/model` 共用同一份会话状态。推理强度菜单读取当前账号与模型声明的档位。切换模型时保留仍受支持的显式档位，否则采用目标模型的默认值。没有声明档位时，输入框隐藏该菜单并省略选择参数。团队设置和其他菜单扩展由原生菜单管理。

连接卡片上的账号下拉选择要查看的用量。鼠标悬停或键盘聚焦圆环可查看明细。

- **DeepSeek** 显示已登录平台账号的钱包余额及赠金。配置了 API Key 时，可从卡片选择对应计费入口。
- **Codex** 优先用周剩余比例绘制圆环，明细列出各时间窗口和重置时间。连接状态需 [dsh-codex 0.1.5](../../runtime/codex/README.md)。
- **Qoder** 按所选账号展示套餐、额外购买和组织 Credits。连接卡片需 [dsh-qoder 0.1.5](../../runtime/qoder/README.md)。
- **Grok** 的 API 用量可从连接详情前往 xAI Console 查看。

厂商只返回余额或未返回可计算的额度比例时，圆环保留中性样式。没有用量数据时明细显示「用量暂不可用」。

展开管理页的厂商可以查看每个模型的说明、接入限制与推理档位。账号与模型目录变化后，页面重新读取宿主目录。

## DSH 原生行为与接入方式

- **原生行为**。输入框的模型菜单由 `@deepseek-ai/dsh-client-ui-model-selection` 的 `ModelSelect` 渲染，负责当前会话的模型和推理强度选择。 [宿主菜单源码](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/packages/client/ui-model-selection/src/client/ModelSelect.tsx#L550-L554)
- **接入方式**。向 `conversation.input.model.options` 加入 `id: 'dsh-model-picker'`、`order: -100` 的「Models / 模型」菜单项，复用会话的模型目录和模型选择操作。另以 `dsh-model-picker` 为键在 `main` 注册管理页，并在 `sidebar.panellist` 增加入口。停用时这些贡献随插件移除。 [客户端注册](src/client/index.tsx)
- **验证证据**。DSH `0.2.2-rc.5` 的隔离 Web 已验证模型选择和热启停，Desktop 已验证管理页入口及原生推理强度菜单。 [plugin.meta.json](plugin.meta.json)

## 安装与验证

需要 DSH `0.2.2-rc.5`、Node.js >=24.9.0。该插件可以与 Workbench 独立安装。

```sh
pnpm --filter dsh-model-picker check
pnpm --filter dsh-model-picker pack --pack-destination /tmp
dsh plugin --profile web add /tmp/dsh-model-picker-0.1.9.tgz
```

Desktop 可以在插件页安装 tarball。隔离 Web 验证使用 `pnpm --filter dsh-model-picker test:host`，需要本机 Chrome 或 `DSH_TEST_BROWSER_EXECUTABLE`。测试使用合成输入和临时 profile。

## 接入其他厂商

适配器在账号就绪后发布可用模型，解绑后撤回相应路由，并通过 DSH 的模型目录事件通知界面刷新。可用路由自动进入模型管理页和模型选择器。

需要提供连接表单的适配器可通过 `ctx.slots.inject` 注册 `modelPicker.connections`。它是 root 作用域的 list 插槽，贡献 ID 使用厂商标识。贡献组件可用可选的 `renderCard` 渲染连接摘要和独立详情，并监听 `refresh` 的变化以响应页面刷新。较早的贡献组件仍可渲染独立表单。账号凭据由适配器使用宿主支持的机制保存。

Codex 使用 ChatGPT 的 Codex Dock 图标，Qoder 使用 macOS 应用主图标，Grok 使用 [App Store 的 Grok 应用图标](https://apps.apple.com/us/app/grok-ai/id6670324846)。打包时内嵌 96 像素 PNG。

## 源码组织评估

使用现有 workspace，由 DSH-Plugins 统一维护并独立打包。模型选择和额度查询通过宿主接口接入，源码无需追踪第三方历史。若维护权限或发布流程形成独立仓库边界，再评估 Git submodule。
