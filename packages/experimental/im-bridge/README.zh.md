---
description: "飞书、钉钉、企业微信双向桥接，把 IM 会话接到 JUDY Agent 会话"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-im-bridge

[English](README.md) | 中文

## 概述

把飞书、钉钉、企业微信的对话接到 JUDY Agent 会话：每个会话对应一个 Agent Session，每个会话一条 FIFO 队列，每轮结束把最后一条助手消息回发到平台。所有平台都走**出站长连接**，实例不需要公网回调地址。bundle 默认关闭，按 profile 开启并配置 providers。

## 目录

- [使用](#use-this-package)
- [配置](#configuration)
- [实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## 使用

把 bundle 加进 profile，再给 `im-bridge` 行配置 providers。凭据就是普通 config 字段；实例若把凭据放在环境变量里，可以用 `!!js` 读取：

```yaml
- id: im-bridge
  config:
    providers:
      - kind: wecom
        workspace: '/data/workspace'
        allowedUsers: ['zhangsan']
        preset: standard
        botId: '!!js "process.env.WECOM_BOT_ID"'
        secret: '!!js "process.env.WECOM_BOT_SECRET"'
      - kind: dingtalk
        clientId: '!!js "process.env.DINGTALK_CLIENT_ID"'
        clientSecret: '!!js "process.env.DINGTALK_CLIENT_SECRET"'
      - kind: feishu
        appId: '!!js "process.env.FEISHU_APP_ID"'
        appSecret: '!!js "process.env.FEISHU_APP_SECRET"'
```

每个 provider 都接受 `workspace`、`allowedUsers`、`preset`、`provider`/`model`、`turnTimeoutMs`、`maxMessageLength`。`allowedUsers` 为空表示接受所有发送者，公网部署务必配置。凭据缺失的 provider 会记录错误并跳过，不会拖垮整个进程。

<a id="configuration"></a>

## 配置

| 类型 | 凭据 | 传输 |
|---|---|---|
| `wecom` | `botId`、`secret` | 企微智能机器人 WebSocket（`openws.work.weixin.qq.com`） |
| `dingtalk` | `clientId`、`clientSecret` | 钉钉 Stream 模式 |
| `feishu` | `appId`、`appSecret` | 飞书长连接事件订阅 |

<a id="understand-the-implementation"></a>

## 实现

每个配置的 provider 实例对应一个 `ChatBridge`。桥把 `chat` 映射为确定性 Session id（`im-<kind>-<instance>-<digest>`），首次接触时创建 Agent、之后恢复，每条消息通过 `Agent.followup()` 跑一轮，再把最后一条助手文本回复出去。同一会话的发送串行化，回复不会乱序。插件不注册 HTTP 路由，重连交给平台 SDK。

<a id="model-experience"></a>

## 模型体验

### 入站聊天文本

#### 模型看到的内容

模型原样看到平台消息文本，作为一条普通 `user/message`；桥不添加任何框架、元数据或指令。非文本消息会变成占位文本 `[<类型> 消息]`，不会发给模型。

#### Token 影响

每轮一条短用户消息，与其他用户消息没有区别。回复就是助手自己的文本；截断只发生在桥到平台这一侧，不影响 Session 日志。

#### KV Cache 影响

无：桥只是往已有 Session 追加普通轮次，prompt 前缀仍可跨聊天复用缓存。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与延期工作

- 钉钉、飞书适配器只用 mock 传输层验证过，落地时没有可用的真实租户。
- 超出平台被动回复窗口的回复会丢：飞书自建机器人和钉钉在没有可用 session webhook 时都不支持事后主动回复。
- 图片、文件、卡片、语音不会下载，只以占位文本出现。
- 一个会话只对应一个 Session：单聊和群聊不共享上下文，也还没有 `/new` 指令。
- 飞书适配器走长连接事件；HTTP 事件回调与加密尚未实现。

<a id="dev-note"></a>

### 开发备注

放在 `packages/experimental` 是因为它是可选 bundle：`dsh-app-boot` 的 `OPTIONAL_BUNDLES` 列出它，插件页会出现在“实验性插件”，实例按 profile 打开。
