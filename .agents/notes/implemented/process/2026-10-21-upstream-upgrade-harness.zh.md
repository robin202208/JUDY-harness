# Agent Note: 上游升级三件套与契约快照

Status: implemented

[English](2026-10-21-upstream-upgrade-harness.md) | 中文

## Problem

这个分叉直接改上游 UI 组件：侧栏与对话页的品牌回退位承载 JUDY 的标志，因此上游一旦重命名某个 slot、删除某个包或改掉某个 patch 行 id，产品就会静默损坏。仓库里没有任何东西能在构建之前回答"上游改了什么而我依赖它"，历次升级的代价也只存在于记忆里。读上游的 changelog 回答的是另一个问题：它列出新增了什么，而不是下游的哪一处覆盖失去了目标。

## Decision

三个脚本加一个数据目录，让升级面对的东西可以被度量。

`scripts/contracts.ts` 采集下游真正依赖的契约面——包版本、`dsh.client` 声明及其 `inject` 边、`dsh.bundle.patch` 文件、每一个可被 patch 层命中的 Loader 行 id、每一个 UI slot 名、以及每一处 `DSH_*` 环境读取——来源可以是安装好的 `app.asar`，也可以是源码树，不需要构建，也不需要起服务。两份快照 diff 成 Markdown 报告，分三档：`breaking`（slot、行 id、包或 inject 边被删除）、`warning`（环境变量被删除、bundle patch 列表变化）、`info`（新增或版本变化）。`--fail-on breaking` 让它成为 CI 门禁。

`scripts/upgrade.ts` 按代价顺序执行流水线：preflight、fetch、契约 diff、重放 `patches/upgrade/*.patch`、作用域改名、构建、类型检查、技能预检。步骤只在 `steps()` 里声明一次，所以 `plan` 与 `run` 不会漂移。成功的一次运行会向 `contracts/upgrade-ledger.md` 追加一行，记录冲突数、级别、耗时、根因，以及应当让下次更便宜的预防动作。

`scripts/verify-skill-bundles.ts` 覆盖"静默消失"的另一半：`dsh-skill-filesystem` 真正加载的磁盘约定。嵌在 `<root>/<name>/SKILL.md` 更深的 `SKILL.md` 永远不会被发现；缺少 `name` 或 `description` 会让整个技能从目录中消失；正文承诺的 `scripts/` 资源缺失或无法解析，会在模型运行时而不是 CI 里失败。

可重放的补丁单独占一个目录，因为 `patches/*.patch` 已经存放 pnpm 依赖补丁，重放若应用了其中一个会破坏依赖。`contracts/baseline.json` 刻意不提交：它必须是真正在跑的版本，并且要在构建之后采集，slot 与环境读取才是完整的。

## Alternatives considered

**每次升级前读上游 changelog。** changelog 描述新增与修复，不会报告 `sidebar.brand.mark` 消失，也无法机械 diff，判断只能依赖还记得上次升级的人。

**固定在当前上游版本、不再升级。** 这消除了升级成本，也一并消除了上游的修复与安全工作，而推迟的每一次 rebase 都比当下这一次更贵。

**去掉 `@deepseek-ai/` 作用域，让分叉看起来独立。** 作用域改名是机械且可逆的，不改变本机制度量的任何行为，却会让未来每一次上游合并的 diff 成倍增长，而不减少冲突。

**用 submodule 跟踪上游。** submodule 固定的是提交，而产品在安装树上叠加 profile 补丁层；快照工具需要的要么是源码检出、要么是 `app.asar`，submodule 增加第二个事实来源却没有回答契约问题。

## Consequences

现在每次升级都以秒级的契约 diff 开始、以一行记账结束，下一次升级的成本按记录估算而不是凭记忆。两个指标由该表得出：近期升级耗时的中位数，以及补丁层的规模。

没有构建产物 `lib/client.js` 的源码树无法采集 slot 与环境读取；快照工具会显式告警，而不是给出一个看起来完整的空记录，基准必须在 `pnpm run build` 之后重新采集。快照能精确识别删除与新增，但会把重命名报告为一次删除加一次新增。

补丁层在结构上保持很小：新增一个补丁必须说明它为什么不能上移到插件层，而记账表的根因列就是检验这句说明的地方。
