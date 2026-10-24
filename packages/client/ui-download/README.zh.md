---
description: "输入栏右侧的“下载文件”入口，打开登录网关提供的文件浏览页。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-download

[English](README.md) | 中文

## 概述

输入栏右侧工具栏里的一个安静小胶囊，点击后在新标签页打开实例的文件浏览页。文件浏览页由登录网关在 `/files/` 提供，不进入会话 UI；这个包只贡献入口。

## 目录

- [使用](#use-this-package)
- [实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用

每个会话的模型、权限 chips 旁边都会出现这个入口，点击在新标签页打开 `/files/`（`rel="noopener"`），当前会话不受影响。文案和无障碍名称来自 `download` 词典，中英文都随包提供。

<a id="understand-the-implementation"></a>
## 实现

浏览器半注入 `slots` 和 `locale`，注册自己的词典，并把一个 occupant 加进 `conversation.input.right` 列表槽。组件就是一个普通锚点，使用语义化 `--dsw-*` token；不读会话状态、不发 RPC。

<a id="model-experience"></a>
## 模型体验

无：该入口纯展示，不进入模型请求。

#### KV Cache 影响

无；打开文件浏览页不改变模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 目标地址固定为 `/files/`；如果实例把文件浏览页挂在别处，需要另做入口。
- 假定网关与工作台同源提供文件浏览页。

<a id="dev-note"></a>
### 开发备注

包在 `packages/bundle/web-app` 中与 `ui-deliverables` 相邻注册，客户端聚合入口在 `tsconfig.client.json`。
