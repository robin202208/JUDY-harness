# Agent Note: 用生成的品牌层做 fork 同步

Status: implemented

[English](2026-10-22-fork-sync-by-brand-script.md) | 中文

## Problem

这个 fork 停在 `0.1.0-rc.5` 一侧，而它跟随的上游极其活跃：从共同祖先 `47f9438`（2026-08-13）到 `dsh-v0.2.1-rc.2`，上游前进了 10,102 个提交，我们只有 16 个自有提交。用 `git merge-tree` 实测合并到 `dsh-v0.2.1-rc.2` 的结果是 346 个文件冲突——其中 114 个是 `package.json`，相对上游的差别只有被手改的 `description` 和 `repository.url`。

这就是结构性的代价：品牌改写被做成普通提交直接压在上游文件上，于是以后每次合并都要重新打开这 114 个 manifest、外加 73 个 markdown，而这些都是机器能精确复现的改动。仓库里也没有任何东西能在花掉一天之前回答"下次合并要花多少"。第一次尝试回答还是错的：本地克隆是浅的，`git rev-list` 只报出 3 个提交，fork 看起来像没有共同祖先的整树导入；`git fetch --unshallow` 之后结论才反转。

## Decision

品牌层改为生成，合并面在付钱之前先量出来。

`scripts/brand.ts` 只改写真正不同的两个字段——`description` 里的产品名和 `repository` 的 URL——用字段级文本替换，不做 parse/stringify，因此上游的缩进与键序原样保留，diff 恰好是被改的两行。脚本幂等，`--dry-run` 只报告不落盘，`--check` 在仍有文件需要改写时以非零退出——正是它挡住规则漂回手工编辑。版本号刻意不再改写：manifest 从此报告它所跟踪的上游版本，而不是钉死的 `0.1.0-rc.5`。

`judy/upstream-base` 标记共同祖先，冲突数因此对着固定锚点计算而不是每次重新推导。`judy-ops/upstream/sync-report.sh` 跑 `git merge-tree --write-tree`（只计算、不碰工作树），报告冲突数、按文件类型与目录的分布、以及其中机械可自动化的比例。`rerere` 在仓库级别打开，解过一次的冲突第二次自动复用。

`.github/workflows/upstream-sync.yml` 每周取上游最新 tag，用既有的 `scripts/contracts.ts` 快照其契约面，与 `contracts/baseline.json` 对比，评级为 `breaking` 时开 issue。

## Alternatives considered

**继续手改 manifest。** 那正是 114 个冲突的来源。改写是机械的，每版手改不增加任何判断，只是把同一处碰撞重演一遍。

**把 fork 拆成只依赖已发布 npm 包的薄壳。** 同步确实会退化成改版本号，但这个 fork 直接改了上游 UI 组件（侧栏品牌、会话兜底、主题色）并在 profile 层做组合；第一个落到树内的补丁出现时，薄壳就不薄了。

**去掉 `@deepseek-ai/` scope，让 fork 看起来独立。** scope 改名可逆、不改变任何行为，却会让每次合并都要重写所有上游 import。现有 manifest 因此保留上游包名。

**用解析再序列化 JSON 的方式做品牌。** 写起来更简单，但它会重排没被改的键——内联依赖表被展开、键序可能移动——于是每次合并的 diff 都带上与决策无关的格式噪音。

## Consequences

合并到 `dsh-v0.2.1-rc.2` 从 346 个冲突文件降到 232 个（在施加任何人工判断之前）：114 个在"manifest 取上游 + 重跑 `brand.ts`"之后消失。剩下的是 73 个 markdown、86 个被上游重录的 `examples/acp-agent` 快照（通常直接取上游）、以及 58 个需要人读的 TypeScript/Python 文件。

description 规则会自然退场：上游现在只有 1/40 的抽样 manifest 仍用那个措辞，规则在更新的版本上基本是 no-op，不需要维护。repository 规则仍然广泛适用（40 个里 29 个）。

接受两项代价。`--check` 让"手改 manifest"变成 CI 失败而不是静默偏离，这是刻意的摩擦。每周的 workflow 需要一份从我们自己构建里抓出来的 `contracts/baseline.json`，而不是 `judy-upgrade/` 里那份参考快照；在重新抓取之前，diff 是拿别人的版本当基准的。
