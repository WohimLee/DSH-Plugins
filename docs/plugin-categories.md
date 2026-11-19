# 插件分类

类别数据的唯一来源为 [plugin-categories.json](plugin-categories.json)，插件目录由脚本生成。

| 目录 | 类别 | 范围 |
| --- | --- | --- |
| `development/` | 开发辅助 | Git、代码审查、构建诊断、调试和 LSP |
| `knowledge/` | 记忆与知识 | 项目记忆、知识库、笔记和会话检索 |
| `research/` | 搜索与研究 | 搜索、网页采集、资料整理和引用 |
| `integrations/` | 外部服务接入 | 飞书、GitHub、邮件、数据库和业务系统 |
| `automation/` | 自动化与协作 | 定时任务、工作流、多 Agent 协作和通知 |
| `ui/` | 界面与交互 | 侧栏、布局、主题和交互式回答 |
| `media/` | 图像、语音与文档 | 图片理解、语音、媒体生成和文档处理 |
| `runtime/` | 模型与执行环境 | 模型适配、路由、浏览器操作和远程执行 |
| `security/` | 安全与治理 | 权限、脱敏、审计和调用预算 |

一个插件只选一个主类别，按用户主要用途选择；跨领域能力用 tags 表达。记忆插件附带页面仍放 knowledge，飞书任务通知放 automation，完整飞书连接器放 integrations。技术层 Host/Client 不决定主类别。

类别目录只是容器，不含 package.json。有插件时才创建。迁移类别保留包名并同步路径、repository.directory、引用和生成目录。新增类别先修改数据表及本说明，不通过随意拼写绕过校验。

plugin.meta.json 包含 schemaVersion=1、category、tags（短字符串数组）和 surfaces。surfaces 的 web/desktop/headless 各包含 status；verified 另须非空 evidence。目录不重复保存包名、版本、描述或 DSH 范围。
