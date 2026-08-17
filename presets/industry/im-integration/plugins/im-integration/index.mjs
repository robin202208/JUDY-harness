'use strict'
// IM 接入插件：向企业微信 / 钉钉群机器人 webhook 发送消息。
// 纯 ESM + Node 全局 fetch，无外部依赖，可随预设从任意目录加载。

const WECOM_ENV = 'WECOM_WEBHOOK_URL'
const DINGTALK_ENV = 'DINGTALK_WEBHOOK_URL'

function hookUrl(envName, explicit, label) {
  if (explicit && typeof explicit === 'string' && explicit.trim()) return explicit.trim()
  const env = process.env[envName]
  if (!env || !env.trim()) {
    throw new Error(`${label}：未配置 webhook，请通过环境变量 ${envName} 或参数 webhook_url 提供`)
  }
  return env.trim()
}

export default {
  name: 'im-integration',
  inject: ['tools'],
  apply(ctx) {
    ctx.tools.register({
      name: 'wecom_send_message',
      description:
        '向企业微信群机器人 webhook 发送文本消息（通知、报警、日报、任务结果等）。webhook_url 缺省时读取环境变量 WECOM_WEBHOOK_URL。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要发送的文本内容。' },
          webhook_url: {
            type: 'string',
            description: '企业微信群机器人 webhook 地址（可选，缺省用环境变量 WECOM_WEBHOOK_URL）。',
          },
        },
        required: ['text'],
      },
      output: {
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' }, errcode: { type: 'number' }, errmsg: { type: 'string' } },
          required: ['ok'],
        },
        render(_args, v) { return [{ type: 'text', text: JSON.stringify(v) }] },
      },
      async execute(args) {
        const url = hookUrl(WECOM_ENV, args && args.webhook_url, '企业微信')
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ msgtype: 'text', text: { content: String(args.text) } }),
        })
        const data = await res.json().catch(() => ({}))
        return { ok: data.errcode === 0, errcode: data.errcode, errmsg: data.errmsg || '' }
      },
    })

    ctx.tools.register({
      name: 'dingtalk_send_message',
      description:
        '向钉钉群机器人 webhook 发送文本或 markdown 消息。webhook_url 缺省时读取环境变量 DINGTALK_WEBHOOK_URL。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要发送的内容（markdown 时用 markdown 语法）。' },
          msg_type: {
            type: 'string',
            enum: ['text', 'markdown'],
            description: '消息类型，默认 text。',
          },
          webhook_url: {
            type: 'string',
            description: '钉钉群机器人 webhook 地址（可选，缺省用环境变量 DINGTALK_WEBHOOK_URL）。',
          },
        },
        required: ['text'],
      },
      output: {
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' }, errcode: { type: 'number' }, errmsg: { type: 'string' } },
          required: ['ok'],
        },
        render(_args, v) { return [{ type: 'text', text: JSON.stringify(v) }] },
      },
      async execute(args) {
        const url = hookUrl(DINGTALK_ENV, args && args.webhook_url, '钉钉')
        const msgtype = args && args.msg_type === 'markdown' ? 'markdown' : 'text'
        const body = msgtype === 'markdown'
          ? { msgtype: 'markdown', markdown: { title: 'JUDY 消息', text: String(args.text) } }
          : { msgtype: 'text', text: { content: String(args.text) } }
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json().catch(() => ({}))
        return { ok: data.errcode === 0, errcode: data.errcode, errmsg: data.errmsg || '' }
      },
    })
  },
}
