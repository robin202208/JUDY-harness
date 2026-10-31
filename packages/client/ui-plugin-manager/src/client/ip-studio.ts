/**
 * The IP studio's task vocabulary: three prompts that take a person from
 * positioning to a shootable 30-second script. Copy-to-clipboard is the
 * prototype's launch surface — the session wiring lands once the flow is
 * agreed, so the prompts stay the source of truth either way.
 */
import type { PluginManagerLocaleKey } from './locales.ts'

/** One launchable task in the studio. */
export interface IpTask {
  readonly id: 'positioning' | 'topics' | 'script'
  readonly titleKey: PluginManagerLocaleKey
  readonly descKey: PluginManagerLocaleKey
  readonly outputKey: PluginManagerLocaleKey
  readonly minutes: number
  readonly prompt: string
}

/** Tasks the studio can start today. */
export const IP_TASKS: readonly IpTask[] = [
  {
    id: 'positioning',
    titleKey: 'ip.task.positioning.title',
    descKey: 'ip.task.positioning.desc',
    outputKey: 'ip.task.positioning.output',
    minutes: 5,
    prompt: `你是一位 IP 定位顾问。请用一页纸帮我定下账号方向，不要泛泛而谈。

我的情况：
- 身份/职业：
- 目标人群：
- 我能提供的独特价值：
- 可长期输出的证据/案例：
- 不想碰的边界：

请输出：
1. 一句话定位（人群 + 问题 + 差异 + 证据）
2. 3 个可替代的定位备选，并说明取舍
3. 人设三件套：身份标签、说话方式、固定视觉/场景
4. 10 条人设标签（可直接放进主页简介）
5. 内容边界：3 个不做、3 个必做
6. 前 10 条内容的最小验证计划（每条一句话）`,
  },
  {
    id: 'topics',
    titleKey: 'ip.task.topics.title',
    descKey: 'ip.task.topics.desc',
    outputKey: 'ip.task.topics.output',
    minutes: 10,
    prompt: `你是一位短视频选题策划。基于下面的账号定位，产出 30 条可在 30 天内拍完的选题。

账号定位：<粘贴上一步的定位结果>
目标人群：
平台：抖音 / 视频号 / 小红书

要求：
- 用「人群 × 场景 × 痛点 × 形式」矩阵，覆盖 5 类人群场景、3 种形式（口播/剧情/图文）
- 每条给：标题（≤20 字）、钩子（第一句）、目标人群、形式、预期时长、可拍性（道具/场地）
- 标注 5 条「本周必拍」，说明理由
- 避免标题党：标题必须能被正文兑现`,
  },
  {
    id: 'script',
    titleKey: 'ip.task.script.title',
    descKey: 'ip.task.script.desc',
    outputKey: 'ip.task.script.output',
    minutes: 5,
    prompt: `你是一位 30 秒口播编剧。把下面的选题写成可直接开拍的脚本。

选题：<粘贴一条选题>
账号人设：<一句话>
平台与时长：抖音 / 视频号 30 秒

结构：
- 0–3 秒 钩子：一句反常识或痛点，必须让人停下
- 3–12 秒 冲突：把问题具体化，给一个反例或代价
- 12–24 秒 反转/方法：给出可执行的一步
- 24–30 秒 行动：一句轻 CTA（关注 / 评论关键词 / 私信）

输出：
1. 逐句台词（口语，≤120 字），标注停顿与重音
2. 镜头与景别建议（每 5 秒一个）
3. 拍摄清单（道具 / 场地 / 字幕关键词）
4. 3 个备选标题`,
  },
]

/** Rows the studio will add next; shown greyed so the roadmap is visible. */
export const IP_UPCOMING: readonly { id: string; key: PluginManagerLocaleKey }[] = [
  { id: 'storyboard', key: 'ip.up.storyboard' },
  { id: 'calendar', key: 'ip.up.calendar' },
  { id: 'review', key: 'ip.up.review' },
]
