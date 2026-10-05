# JUDY ↔ 上游 DeepSeek Harness 差异清单

> 本文件由 `scripts/judy-upstream-delta.mjs` 生成，请勿手工编辑。

- 生成时间：2026-10-05T13:06:36.779Z
- JUDY 版本：`0.1.0-rc.5`
- 上游版本：`0.1.0-rc.8`
- 上游提交：`141eb6fef8`

## 总览

| 指标 | 数量 |
| --- | --- |
| JUDY 独有包组 | 0 |
| 上游独有包组（你的缺口） | 1 |
| 共有包组 | 49 |
| 被改过的包 | 87 |
| 与上游逐字节相同的包 | 130 |

## 1. JUDY 独有包组（你的资产，永远不跟上游合）

_无_

## 2. 上游独有包组（你的缺口，需评估是否要）

- `experimental/` — 2 个包

## 3. 被改过的包（必须逐个人工决策）

> 这些是"背补丁"成本的来源。每一项都要决定：
> **A** 改成外挂插件（归入第 1 类，成本永久消失）／
> **B** 保留为 pin 补丁（承认长期成本）／
> **C** 放弃改动，回到上游行为。

### `acp/`


| 包 | 版本 | 决策 |
| --- | --- | --- |
| `acp` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `api/`


| 包 | 版本 | 决策 |
| --- | --- | --- |
| `remotes` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `attachment/`


| 包 | 版本 | 决策 |
| --- | --- | --- |
| `attachment` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `attachment-local` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `boot/`


| 包 | 版本 | 决策 |
| --- | --- | --- |
| `app-boot` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `bundle/`


| 包 | 版本 | 决策 |
| --- | --- | --- |
| `web-app` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `client/`

- **新增于本仓**：`schema-form`, `web-react`
- **本仓缺失**：`ui-brand-official`, `ui-reference`, `ui-renderer`

| 包 | 版本 | 决策 |
| --- | --- | --- |
| `connection` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `locale` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `modules` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `runtime` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `ui-agent-preset` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `ui-attachment` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `ui-commands` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `ui-conversation` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `ui-input-trigger` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `ui-jobs` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `ui-message-feedback` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `ui-model-selection` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `ui-permission-presets` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `ui-plan` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `ui-primitives` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `ui-settings` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `ui-settings-general` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `ui-settings-models` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `ui-settings-plugins` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `ui-sidebar` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `ui-slots` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `ui-subagent` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `ui-theme` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `ui-tool` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `ui-trajectory` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `ui-user-questions` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `ui-workflow-run` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `ui-workspace` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `web` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `code-runtime/`

- **本仓缺失**：`code-runtime-python`

### `context/`

- **本仓缺失**：`file-reference`, `file-reference-local`

| 包 | 版本 | 决策 |
| --- | --- | --- |
| `session-reference` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `core/`


| 包 | 版本 | 决策 |
| --- | --- | --- |
| `agent-loop` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `session` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `system-prompt` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `tools` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `examples/`


| 包 | 版本 | 决策 |
| --- | --- | --- |
| `acp-demo` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `agent-spine-demo` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `extensions/`


| 包 | 版本 | 决策 |
| --- | --- | --- |
| `cordis-client-runner` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `tool-cordis` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `ui-cordis` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `fs/`


| 包 | 版本 | 决策 |
| --- | --- | --- |
| `tool-fs` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `tool-fs-search` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `goal/`


| 包 | 版本 | 决策 |
| --- | --- | --- |
| `command-goal` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `host/`


| 包 | 版本 | 决策 |
| --- | --- | --- |
| `apiproxy` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `interaction/`


| 包 | 版本 | 决策 |
| --- | --- | --- |
| `commands` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `llm/`


| 包 | 版本 | 决策 |
| --- | --- | --- |
| `llm` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `llm-deepseek` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `llm-pi-ai` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `mcp/`


| 包 | 版本 | 决策 |
| --- | --- | --- |
| `mcp-client` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `plan/`


| 包 | 版本 | 决策 |
| --- | --- | --- |
| `plan-mode` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `sandbox/`


| 包 | 版本 | 决策 |
| --- | --- | --- |
| `sandbox-windows-acl` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `sdk/`


| 包 | 版本 | 决策 |
| --- | --- | --- |
| `client` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `protocol` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `server` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `session/`


| 包 | 版本 | 决策 |
| --- | --- | --- |
| `session-persistence` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `session-persistence-sqlite` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `session-telemetry` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `session-telemetry-otel` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `session-query/`


| 包 | 版本 | 决策 |
| --- | --- | --- |
| `session-query` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `shell/`

- **本仓缺失**：`tool-pwsh-persistent`

| 包 | 版本 | 决策 |
| --- | --- | --- |
| `shell-env` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `tool-bash-persistent` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `skill/`


| 包 | 版本 | 决策 |
| --- | --- | --- |
| `skill-badge` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `skill-filesystem` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `subagent/`


| 包 | 版本 | 决策 |
| --- | --- | --- |
| `subagent` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `subagent-claude-code` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `subagent-codex` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `subagent-dsh-sdk` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `tool-subagent` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `tool-subagent-report` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `subprocess/`


| 包 | 版本 | 决策 |
| --- | --- | --- |
| `subprocess` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `subprocess-local` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `terminal/`


| 包 | 版本 | 决策 |
| --- | --- | --- |
| `terminal-bash` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `test-support/`


| 包 | 版本 | 决策 |
| --- | --- | --- |
| `acp-snapshot` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `client-runtime` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `util/`


| 包 | 版本 | 决策 |
| --- | --- | --- |
| `atomic-write` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `home-paths` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

### `web/`


| 包 | 版本 | 决策 |
| --- | --- | --- |
| `tool-web` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `web` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `web-fetch-http` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `web-search-deepseek` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `web-search-exa` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |
| `web-search-perplexity` | 0.1.0-rc.5 → 0.1.0-rc.8 | ⬜ A / ⬜ B / ⬜ C |

## 附：与上游完全一致、可直接取上游的包

共 130 个。这些包升级时无需任何处理。
