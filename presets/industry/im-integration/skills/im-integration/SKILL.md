---
name: im-integration-playbook
description: 企业微信/钉钉群机器人 webhook 使用规范：配置、消息格式、发送准则。需要向 IM 群发送消息时使用。
---

# IM 群机器人接入规范

## 配置
- 企业微信：群设置 → 群机器人 → 添加，复制 webhook（https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...），
  配置环境变量 `WECOM_WEBHOOK_URL`，或在调用时传 `webhook_url` 参数。
- 钉钉：群设置 → 智能群助手 → 添加机器人，复制 webhook（https://oapi.dingtalk.com/robot/send?access_token=...），
  配置环境变量 `DINGTALK_WEBHOOK_URL`，或在调用时传 `webhook_url` 参数。

## 消息格式
- 文本：直接发送内容，多行用换行分隔。
- 钉钉 markdown：标题行 + 要点列表 + 代码块。
- 推荐结构：标题行 → 摘要 → 要点 → 来源/下一步。

## 发送准则
- 频率克制：同一内容不重复推送，仅对重要事件发送。
- 内容自包含：收件人不依赖上下文也能看懂（时间、对象、结果、下一步）。
- 失败处理：`errcode ≠ 0` 时说明原因（webhook 失效、频率限制等）。
