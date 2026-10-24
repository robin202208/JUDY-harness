---
description: "输入栏开关：默认进入简单模式，隐藏模型、权限、预设等技术 chips。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-simple-mode

[English](README.md) | 中文

## 概述

输入栏右侧工具栏里的一个文字开关。首次访问默认进入简单模式：模型、权限、Agent 预设这些 chips 从输入栏消失，界面更干净。偏好只存在浏览器本地，不会上传到 Host，也不会进入 Session 日志。

## 目录

- [使用](#use-this-package)
- [实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用

简单模式开启时按钮显示“显示高级选项”，关闭时显示“隐藏高级选项”。切换会写入 `localStorage` 的 `judy.ui.simple`，并在 document 上切换 `data-judy-simple`；本包的样式表随后隐藏所有 `[data-judy-chip]` 控件。被隐藏的 chips 仍然可用，新组件只要带上该属性也会被隐藏。

<a id="understand-the-implementation"></a>
## 实现

浏览器半注入 `slots` 和 `locale`，加载时恢复已存的标记，并把开关注册进 `conversation.input.right`。隐藏完全由基于 document 属性的 CSS 完成，组件不需要知道有哪些 chips，也不涉及会话状态。

<a id="model-experience"></a>
## 模型体验

无：隐藏输入栏 chips 属于纯展示，不进入模型请求。

#### KV Cache 影响

无；本地偏好不改变模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 只隐藏带 `data-judy-chip` 的控件；新增 chip 需要自己加上该属性。
- 偏好按浏览器保存，不跟账号走。

<a id="dev-note"></a>
### 开发备注

chip 所有者在触发器上加 `data-judy-chip`；模型、权限、Agent 预设三个包已经加上。
