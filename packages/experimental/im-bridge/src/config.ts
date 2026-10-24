/** Cordis configuration for the IM bridge bundle. */

import Schema from '@deepseek-ai/schemastery'

/** One chat platform instance: credentials, allowlist and session target. */
export interface ProviderConfig {
  /** Adapter to instantiate. */
  kind: 'wecom' | 'dingtalk' | 'feishu'
  /** Instance id; defaults to `kind`. Keeps sessions of two instances apart. */
  id?: string
  /** Workspace directory every session of this instance works in. */
  workspace?: string
  /** Platform user ids allowed to talk to the bot; empty accepts everyone. */
  allowedUsers?: string[]
  /** Agent preset id mounted for created sessions. */
  preset?: string
  /** Explicit provider route; empty uses the deployment default selection. */
  provider?: string
  /** Explicit model id; requires `provider`. */
  model?: string
  /** Turn deadline in milliseconds. */
  turnTimeoutMs?: number
  /** Reply body cap in characters. */
  maxMessageLength?: number
  /** WeCom Smart Robot bot id. */
  botId?: string
  /** WeCom Smart Robot secret. */
  secret?: string
  /** DingTalk app client id (appKey). */
  clientId?: string
  /** DingTalk app client secret (appSecret). */
  clientSecret?: string
  /** Feishu app id. */
  appId?: string
  /** Feishu app secret. */
  appSecret?: string
  /** Feishu event verification token (HTTP callback mode only). */
  verificationToken?: string
  /** Feishu event encrypt key (HTTP callback mode only). */
  encryptKey?: string
}

/** Bundle configuration. */
export interface Config {
  /** Platform instances to connect at boot. */
  providers: ProviderConfig[]
}

const ProviderSchema = Schema.object({
  kind: Schema.union(['wecom', 'dingtalk', 'feishu']).required(),
  id: Schema.string().default(''),
  workspace: Schema.string().default(''),
  allowedUsers: Schema.array(Schema.string()).default([]),
  preset: Schema.string().default(''),
  provider: Schema.string().default(''),
  model: Schema.string().default(''),
  turnTimeoutMs: Schema.number().default(240000),
  maxMessageLength: Schema.number().default(4000),
  botId: Schema.string().default(''),
  secret: Schema.string().default(''),
  clientId: Schema.string().default(''),
  clientSecret: Schema.string().default(''),
  appId: Schema.string().default(''),
  appSecret: Schema.string().default(''),
  verificationToken: Schema.string().default(''),
  encryptKey: Schema.string().default(''),
})

/** Config schema consumed by the Cordis Loader. */
export const Config = Schema.object({
  providers: Schema.array(ProviderSchema).default([]),
})
