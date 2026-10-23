# Agent Note: 用文件系统版本快照定义本轮交付物

Status: proposed

[English](2026-10-22-turn-deliverables-from-fs-versions.md) | 中文

## Problem

底部的产物文件条只认识“工具自己承认写过”的文件：`producedPaths` 只接受 `diff` 卡片，或 `kind === 'edit'` 的 `generic` 卡片。而 shell 命令、Python 脚本、以及任何通过 shell 落盘的工具，卡片都是 `terminal`，`TerminalResultView` 里根本没有 `locations` 字段。于是这套部署里最常见的交付方式——跑一个脚本——产出的文件条是空的，收尾消息里的文件提及也没有词表可解析。

系统提示里已经要求模型用行内代码、写精确路径或本轮唯一的 basename，而模型并不稳定遵守。提示词替代不了事实源。

## Proposal

本轮产出集合从文件系统取，不从工具取。

**快照。** `dsh-fs-local` 增加 `collectVersions(root, options)`：只用 `stat`（不读文件）遍历，为每个普通文件记录一个 `FsVersion`，以工作区相对 POSIX 路径为键。`FsVersion` 就是现有的 `dev:ino:size:mtimeNs:ctimeNs` 元组，所以同尺寸改写仍然是变化。上限：`maxDepth`（默认 8）、`maxEntries`（默认 20000）、忽略集（`.git`、`node_modules`、构建产物）、可取消。失败一律降级——读不了的目录只计数、不抛异常，因为“轮末快照”绝不能成为一条回复失败的原因。

**差分。** `changedVersions(before, after)` 返回排序后的 `created` / `modified` / `removed` 以及 `truncated`。截断意味着结果是下界，界面要明说，而不是暗示除此之外没有变化。

**线上契约。** 新增一个一元 RPC `fs.listVersions`，按会话寻址，而不是按路径：

```
request  { sessionId: string, maxDepth?: number, maxEntries?: number }
response { root: string, truncated: boolean, unreadable: number,
           entries: Array<{ path: string, version: string, size: number }> }
errors   session-not-found, fs-unavailable, cancelled
```

请求里**完全不携带文件系统路径**：宿主自己把会话 header 的 `cwd` 解析成根目录（每个被服务的会话在创建时都会记下它）。于是围栏是“调用方点了一个它本来就挂着的会话”，而不是“调用方给了一个我们但愿它在工作区内的路径”。未知会话走既有的 `session-not-found`，没有 `cwd` 的会话走 `fs-unavailable`，两者都在遍历开始前失败。

**归属。** `collectVersions` 放在 `dsh-fs-local`，因为那是文件系统的工作；但 `dsh-host-apiproxy` 不依赖这个 provider，也不该开始依赖：BFF 一旦依赖，就等于知道了装的哪个文件系统实现。所以快照做成工作区服务上的一个方法（`dsh-workspace`，本来就是 apiproxy 的依赖，也本来就拥有工作区路径），由它组合 `collectVersions`；`fs.listVersions` 只是它的薄适配层。provider 仍然待在既有的缝后面。

**载荷单位。** 事件携带 `root` 与**绝对路径**，而不是工作区相对路径。这里所有其它产生文件路径的地方——工具 `locations`、文件服务、下载端点——都只说绝对路径；列表里混两种单位，就无法在缺少根查询的情况下判定并集，而客户端没有那个根。因此不变量检查的是“每个路径等于 `root` 或在它之下”，这直接证明了要证明的性质，而不只是证明“不是绝对路径”。

**事件声明在哪。** `turn/deliverables` 是核心 `SessionEventMap` 的成员，不是包内 declaration merge。它的消费者是浏览器 bundle，而浏览器不能 import 一个会走文件系统的宿主包；核心声明是唯一双方都能读到、又不会把 `node:fs` 拖进客户端依赖图的位置。

**与轮次绑定。** 会话引擎的定义契约是同步的——`match`/`start`/`update`/`buildLocationData` 都是“给一个事件、返回状态”——所以一个轮次边界没法在里面 await 两次快照。因此配对由宿主拥有：宿主本来就跑 agent 循环、观察 `turn/start` 与落定，它取两侧快照，并把结果作为新的 `turn/deliverables` 会话事件发出，携带 `created ∪ modified`（去掉忽略集）。客户端的定义保持同步形状，像读其它事件一样读它。`removed` 保留在事件里供差分报告用，永远不变成下载 chip。工具上报的 `locations` 与文件系统结果取并集：同一个文件只出现一次。

`fs.listVersions` 仍然有价值：它是客户端为“事件早于本次改动”的轮次重新推导同一集合的手段，也让遍历可以在不跑 agent 的情况下被测。它不在轮次边界的关键路径上。

## Alternatives considered

只保留工具上报的 `locations`，并要求模型打印精确路径。否决：提示词不构成事实来源，shell 写入也没有 locations。让客户端通过 `fs.listVersions` 自行轮询工作区。否决：把每轮的文件系统遍历搬进浏览器，并重复了宿主的权威。

## Acceptance criteria

- 只通过 shell 命令写过文件的一轮，底部文件条必须有内容；同样的轮次如果没写文件，则没有。
- 同名、同尺寸重写的文件必须出现在 `modified`。
- 超过 `maxDepth` 或 `maxEntries` 时必须置 `truncated: true`，且界面给出“可能不完整”的提示，而不是默默宣称完整。
- 某个目录不可读时，其余快照保持完整，且不让这一轮失败。
- `fs.listVersions` 传入会话工作区之外的 `root` 时必须返回结构化错误；工作区之外的宿主机路径永远不会被枚举。
- 每轮两次快照在 `maxEntries` 上界的工作区里，仍在该轮的延迟预算内（要实测，不是假设）。

## Risks

每轮多一次目录遍历，在大工作区上等于翻倍；上限约束住了开销，但也让“完整性”变成尽力而为——正因如此，截断必须可见而不能被吞掉。落定时刻仍在写入的竞争，会让文件落进下一轮而不是这一轮。

与工具 `locations` 取并集，可能带出工具在快照根之外写的文件；并集必须按快照根过滤，否则 chip 会给出一个文件服务会拒绝的下载。

一个接受任意 root 的 `fs.listVersions`，如果围栏写错，就是一个宿主机枚举原语。**围栏——只允许会话工作区——才是这个提案的承重部分**，遍历不是。
