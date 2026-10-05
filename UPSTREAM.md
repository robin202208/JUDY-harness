# Upstream baseline

本文件记录 JUDY 与上游 **DeepSeek Harness** 的同步基线。
它是 `scripts/judy-upstream-delta.mjs` 的输入，也是 CI 判断漂移量的依据。

## 当前基线

| 项 | 值 |
| --- | --- |
| 上游仓库 | https://github.com/deepseek-ai/deepseek-harness |
| 基线 tag | `dsh-v0.1.0-rc.8` |
| 基线 commit | `141eb6fef8` |
| 基线版本 | `0.1.0-rc.8` |
| 本仓版本 | `0.1.0-rc.5` |
| 基线确立日期 | 2026-10-05 |

### 为什么基线是 rc.8 而不是 rc.5

本仓的 `package.json` 版本字符串（`0.1.0-rc.5`）在上游没有对应的 tag。
按**结构同代性**选定了最近的同系列 tag：

| 结构特征 | 本仓 | `rc.8` | `0.2.1-alpha.1` |
| --- | --- | --- | --- |
| `invariant.ts` 数量 | 219 | 226 | **0**（该机制已被上游删除） |
| `native/` 目录 | `landlock-run` | `landlock-run` | **`system`** |
| 包数量 | 226 | 226 | 328 |

上游有一个提交 `refactor: remove runtime invariant plugins`，说明 invariants 是上游自己的
机制、后来被删除。本仓保留了它，因此本仓属于 **0.1.x 世代**，不能与 0.2.x 直接对比——
跨代对比会得出「200 个包全被改过」的失真结论。

**基线的性质**：这是「从今往后的参照系」，不是「精确复原你的分叉点」。
因为本仓历史被压平为单个 commit，没有 merge-base，无法回溯真正的分叉点。
这不影响使用——有了固定参照系就能测量增量漂移。

## 实测差异（对 rc.8，只比源码）

| 指标 | 数量 |
| --- | --- |
| 可比包 | 219 |
| 与上游完全一致 | **130**（升级时零风险，直接取上游） |
| 有改动 | **87**（补丁成本来源） |
| 本仓新增 | 2 |

改动最集中的包：

| 包 | 变化行数 | 性质 |
| --- | --- | --- |
| `client/ui-conversation` | 1401 | 会话界面，改动最大 |
| `session/session-persistence-sqlite` | 944 | 持久化后端，**触及数据格式，最危险** |
| `subagent/subagent-codex` | 841 | Codex 子 Agent provider |
| `llm/llm-pi-ai` | 750 | 多协议模型适配 |
| `client/modules` | 539 | 插件表 / bundle 路由 |
| `subagent/subagent-claude-code` | 526 | Claude Code 子 Agent provider |
| `llm/llm-deepseek` | 395 | 官方适配器 |
| `acp/acp` | 351 | Agent Client Protocol 实现 |

完整清单见 [`UPSTREAM-DELTA.md`](UPSTREAM-DELTA.md)。

## 如何更新这个基线

```bash
# 1. 拉取上游
git fetch upstream --tags

# 2. 列出可用 tag，选择一个同代版本
git tag --list 'dsh-v0.1.*'

# 3. 检出到工作树做对比（不要切走你的工作分支）
git worktree add --detach /tmp/upstream-next <tag>

# 4. 生成差异清单
DELTA_CODE_ONLY=1 node scripts/judy-upstream-delta.mjs \
  --upstream /tmp/upstream-next --judy . --markdown > UPSTREAM-DELTA.md

bash scripts/judy-upstream-diffstat.sh /tmp/upstream-next . 40

# 5. 更新上表的基线记录，然后清理
git worktree remove /tmp/upstream-next
```

## 变更记录

| 日期 | 基线 tag | commit | 说明 |
| --- | --- | --- | --- |
| 2026-10-05 | `dsh-v0.1.0-rc.8` | `141eb6fef8` | 首次确立基线 |
