/** Two-way IM bridge: Feishu, DingTalk and WeCom chats drive JUDY Agent sessions. */

import type { Context } from '@deepseek-ai/cordis'
import { ChatBridge } from './bridge.ts'
import { Config } from './config.ts'
import type { ProviderConfig } from './config.ts'
import { createDingTalkProvider } from './providers/dingtalk.ts'
import { createFeishuProvider } from './providers/feishu.ts'
import type { ImProvider } from './providers/types.ts'
import { createWeComProvider } from './providers/wecom.ts'

export { Config }
export type { Config as ImBridgeConfig, ProviderConfig } from './config.ts'
export type { ImInbound, ImProvider } from './providers/types.ts'

/** Plugin name in the Loader tree. */
export const name = 'im-bridge'

/** Services the bridge drives: agent creation and the default model route. */
export const inject = ['agents', 'agentDefaultModel']

const createProvider = (config: ProviderConfig, log: (message: string) => void): ImProvider => {
  switch (config.kind) {
    case 'wecom': return createWeComProvider(config, log)
    case 'dingtalk': return createDingTalkProvider(config, log)
    case 'feishu': return createFeishuProvider(config, log)
    default: throw new Error(`unknown IM provider kind: ${String((config as { kind?: unknown }).kind)}`)
  }
}

/**
 * Mount one ChatBridge per configured provider instance.
 * @param ctx - host plugin context.
 * @param config - bundle configuration from the loader.
 */
export function apply(ctx: Context, config: Config): void {
  for (const [index, providerConfig] of config.providers.entries()) {
    const scope = `${providerConfig.kind}-${String(index)}`
    const log = (message: string): void => { ctx.logger.info(`im-bridge[${scope}]: ${message}`) }
    let provider: ImProvider
    try {
      provider = createProvider(providerConfig, log)
    } catch (error) {
      ctx.logger.error(`im-bridge[${scope}]: provider skipped: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    const bridge = new ChatBridge(ctx, provider, { config: providerConfig, log })
    ctx.effect(() => {
      let teardown: (() => Promise<void>) | undefined
      const started = provider.start((message) => { bridge.handle(message) })
        .then((stop) => { teardown = stop })
        .catch((error: unknown) => {
          ctx.logger.error(`im-bridge[${scope}]: start failed: ${error instanceof Error ? error.message : String(error)}`)
        })
      return async () => {
        const stop = teardown
        teardown = undefined
        try {
          if (stop !== undefined) await stop()
        } finally {
          await bridge.dispose()
          await started
        }
      }
    }, `im-bridge:${scope}`)
  }
}
