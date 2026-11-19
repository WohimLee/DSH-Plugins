---
name: dshp-pre-push-checks
description: 为 DSH Plugins 的待推送变更选择最小充分证据，或检查一次开发交付是否具备相应验证；本技能本身不授权推送或发布。
---

# 交付证据

读取 AGENTS、docs/testing.md 和开发指南的提交与推送流程。先核实分支、目标基线以及已提交、暂存、未暂存和新增文件的范围；沿用用户已确定的基线，默认集成分支为 main。

普通文档检查内容、链接与 diff；局部插件运行目标包 check 和相关测试；共享治理变化运行 pnpm check；模板或构建变化追加 pnpm check:templates；Bundle 或宿主接口变化追加 pnpm test:host 与受影响真实功能。复用未失效的已有证据。

打包检查不能省略发布入口、patch、Client 和 Skill 文件。未知桌面版本或未运行的外部集成如实记录，不能标 verified。

检查失败先修复或报告原因。实现任务按仓库交付流程推送，用户指定的交付范围及限制优先。重写远端历史与发布分别需要明确授权。重写使用精确远端状态与 lease 保护。推送后核对远端与 CI，如实报告未完成的检查。
