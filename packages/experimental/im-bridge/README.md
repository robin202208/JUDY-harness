---
description: "Two-way Feishu, DingTalk and WeCom chat bridges that drive JUDY Agent Sessions"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-im-bridge

English | [中文](README.zh.md)

## Summary

Bridges Feishu, DingTalk and WeCom conversations to JUDY Agent Sessions: one Session per chat, one FIFO queue per chat, and the last assistant message of each turn sent back to the platform. Each provider opens an outbound long connection, so an instance needs no public callback URL. The bundle ships switched off; enable it per profile and configure its providers.

## Table of Contents

- [Use this package](#use-this-package)
- [Configuration](#configuration)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

Add the bundle to a profile, then give the `im-bridge` row its providers. Credentials are ordinary config fields; an instance that keeps them in the environment can read them with `!!js`:

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

Every provider accepts `workspace`, `allowedUsers`, `preset`, `provider`/`model`, `turnTimeoutMs` and `maxMessageLength`. An empty `allowedUsers` accepts every sender; set it for any public deployment. A provider whose credentials are missing is logged and skipped rather than failing the whole process.

## Configuration

| Kind | Credentials | Transport |
|---|---|---|
| `wecom` | `botId`, `secret` | WeCom Smart Robot WebSocket (`openws.work.weixin.qq.com`) |
| `dingtalk` | `clientId`, `clientSecret` | DingTalk Stream mode |
| `feishu` | `appId`, `appSecret` | Feishu long-connection event subscription |

## Understand the implementation

Each configured provider instance gets a `ChatBridge`. The bridge maps `chat` to a deterministic Session id (`im-<kind>-<instance>-<digest>`), creates the Agent on first contact and resumes it afterwards, runs one turn per message through `Agent.followup()`, and replies with the last assistant text. Sends are serialized per chat so replies never overtake each other. The plugin owns no HTTP route and waits for the platform SDK's own reconnect handling.

## Model Experience

### Inbound chat text

#### What the model sees

The model sees the platform message text verbatim as one ordinary `user/message`; the bridge adds no framing, metadata or instructions. A message that is not text becomes the placeholder `[<type> 消息]` and is not sent to the model.

#### Token effect

One short user message per turn, unchanged from any other user message. The reply is the assistant's own text; truncation happens only on the platform side of the bridge and does not affect the Session log.

#### KV Cache effect

None: the bridge appends ordinary turns to an existing Session, so the prompt prefix stays cacheable across chats.

## Known Limitations and Deferred Work

- DingTalk and Feishu adapters are covered by mocked transports only; no live tenant was available while landing the package.
- A reply that arrives after the platform's passive-reply window is lost on Feishu custom bots and on DingTalk when no session webhook is usable.
- Images, files, cards and voice messages are not downloaded; they surface as placeholders.
- One Session per chat only: private and group conversations never share context, and there is no `/new` command yet.
- The Feishu adapter uses long connection events; HTTP event callbacks and encryption are not implemented.

### Dev Note

The package lives under `packages/experimental` because it is an optional bundle: `OPTIONAL_BUNDLES` in `dsh-app-boot` lists it, so the Plugins page shows it under Experimental plugins and an instance turns it on per profile.
