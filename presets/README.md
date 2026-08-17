# JUDY 行业预设包

开箱即用的行业 Agent 预设集合：每个预设 = 标准工具集 + 领域 persona + 领域技能（SKILL），部分预设附带自定义插件。安装后即可在新建会话时选用。

## 包含的预设

| ID | 名称 | 说明 | 附带 |
|---|---|---|---|
| `maintenance` | 维护工程师 | 系统与代码维护：服务、日志、故障排查、bug 修复、重构、依赖升级 | — |
| `pdf-reader` | PDF 阅读器 | 标准 Agent + `read_pdf` 工具：按路径提取 PDF 纯文本（论文/文档/报告） | 自定义插件 |
| `risk-control` | 企业风控专家 | 反欺诈/反洗钱、合规内控、法务、信用与操作风险 | — |
| `customer-service` | 客服助手 | 客户服务与工单处理：分类定级、流程处理、升级、工单总结 | skill |
| `data-analyst` | 数据分析师 | 数据清洗、统计、可视化与结构化报告 | skill |
| `tutor` | 教学辅导 | 苏格拉底式教学、知识拆解、出题与讲评 | skill |
| `code-reviewer` | 代码审查 | 正确性/安全/性能/可维护性四维审查，分级意见 | skill |
| `im-integration` | IM 接入 | 企业微信/钉钉群机器人消息发送（文本/markdown），可接入通知、报警、日报 | 自定义插件 + skill |

## 一键安装

```sh
cd JUDY-harness
bash presets/install.sh
```

安装到 `$DSH_HOME/.agent-presets/`（默认 `~/.dsh/.agent-presets/`；可用环境变量 `DSH_HOME` 覆盖）。安装后刷新页面，新建会话时在预设选择中选用。

重复安装会先备份旧版本（`.bak.<时间戳>`），不覆盖你的自定义。

## 自定义

- 每个预设目录：`agent.cordis.yml`（组合）、`preset.yml`（名称/描述）、`skills/`（领域技能）、`plugins/`（可选自定义插件）。
- 改 persona：编辑 `agent.cordis.yml` 中 `persona` 行的 `text`。
- 裁剪工具集：删除 `agent.cordis.yml` 中对应行（注意保留 group 的 `isolate` 结构）。
- 造新预设：从任意预设复制目录，按需修改。

## 贡献你自己的行业预设

把你的行业经验固化成预设（persona + skill，必要时加插件），提交 PR 到本目录即可进入行业包。

## 原理

预设 = 单个会话 Agent 的插件组合（Cordis composition）。`agent.cordis.yml` 决定工具与提示词；`skills/` 提供领域知识；`plugins/` 可注册自定义工具——参考 `pdf-reader` 的 `read_pdf` 插件写法：纯 ESM、只依赖 Node 内置模块，即可从任何预设目录直接加载。
