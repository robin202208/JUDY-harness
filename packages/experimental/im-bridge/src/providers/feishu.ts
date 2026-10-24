/** Feishu (Lark) long-connection adapter over the lark node-sdk WebSocket client. */

import * as lark from '@larksuiteoapi/node-sdk'
import type { ProviderConfig } from '../config.ts'
import type { ImInbound, ImProvider } from './types.ts'

/** Reply context stored on every inbound Feishu message. */
export interface FeishuReplyContext {
  /** Id of the message the agent answers; the reply API addresses it directly. */
  readonly messageId: string
  /** Conversation id the message belongs to. */
  readonly chatId: string
}

/** Sender fields read from an `im.message.receive_v1` event. */
export interface FeishuSender {
  /** Platform identities of the sender; the adapter prefers `open_id`. */
  readonly sender_id?: {
    readonly open_id?: string
    readonly user_id?: string
    readonly union_id?: string
  }
  /** `user` for humans, `app` for bots. */
  readonly sender_type: string
}

/** Message fields read from an `im.message.receive_v1` event. */
export interface FeishuMessage {
  /** Platform message id, used to deduplicate redeliveries and to reply. */
  readonly message_id: string
  /** Conversation id: a group chat id, or the peer id in a direct chat. */
  readonly chat_id: string
  /** `p2p` for direct chats, `group` for group chats. */
  readonly chat_type: string
  /** Content type such as `text` or `image`. */
  readonly message_type: string
  /** JSON string; text messages carry `{"text":"..."}`. */
  readonly content: string
}

/** The subset of `im.message.receive_v1` events this adapter consumes. */
export interface FeishuMessageEvent {
  readonly sender: FeishuSender
  readonly message: FeishuMessage
}

/** Handler invoked by the event dispatcher for one inbound message. */
export type FeishuMessageHandler = (event: FeishuMessageEvent) => void

/** Event registrations the adapter passes to the dispatcher. */
export interface FeishuEventHandles {
  readonly 'im.message.receive_v1': FeishuMessageHandler
}

/** Dispatcher face: register the inbound handler, and remove it on teardown when supported. */
export interface FeishuDispatcherLike {
  register(handles: FeishuEventHandles): unknown
  unregister?(...keys: string[]): unknown
}

/** WebSocket client face: open the long connection and close it. */
export interface FeishuWsLike {
  start(params: { readonly eventDispatcher: FeishuDispatcherLike }): Promise<void>
  close(params?: { readonly force?: boolean }): void
}

/** One reply response; `code` 0 means the platform accepted the message. */
export interface FeishuReplyResponse {
  readonly code?: number | undefined
  readonly msg?: string | undefined
}

/** Client face used to reply into the conversation. */
export interface FeishuClientLike {
  readonly im: {
    readonly message: {
      reply(payload: {
        readonly path: { readonly message_id: string }
        readonly data: { readonly msg_type: string; readonly content: string }
      }): Promise<FeishuReplyResponse>
    }
  }
}

/** SDK object factories; tests inject fakes so no connection is made. */
export interface FeishuProviderDeps {
  createClient(): FeishuClientLike
  createWsClient(): FeishuWsLike
  createDispatcher(): FeishuDispatcherLike
}

/** Message ids remembered for deduplication before the oldest one is forgotten. */
const SEEN_MESSAGE_LIMIT = 512

/** Readable message for a caught value. */
const describeError = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** Default factories over the lark node-sdk, used when the caller injects none. */
const sdkDeps = (appId: string, appSecret: string): FeishuProviderDeps => ({
  createClient: () => new lark.Client({ appId, appSecret }),
  createWsClient: () => new lark.WSClient({ appId, appSecret, loggerLevel: lark.LoggerLevel.info }),
  createDispatcher: () => new lark.EventDispatcher({}),
})

/** Plain text of a JSON message body, or an empty string when it carries none. */
const contentTextOf = (content: string): string => {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return ''
  }
  if (typeof parsed !== 'object' || parsed === null || !('text' in parsed)) return ''
  const text = parsed.text
  return typeof text === 'string' ? text.trim() : ''
}

/** Inbound text of one message; non-text content becomes a readable placeholder. */
const textOf = (message: FeishuMessage): string => {
  if (message.message_type !== 'text') return `[${message.message_type} 消息]`
  const text = contentTextOf(message.content)
  return text !== '' ? text : '[text 消息]'
}

/** Reply context of an inbound message, or `undefined` when it carries none. */
const replyContextOf = (raw: unknown): FeishuReplyContext | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined
  const candidate = raw as { readonly messageId?: unknown; readonly chatId?: unknown }
  if (typeof candidate.messageId !== 'string' || candidate.messageId === '') return undefined
  return {
    messageId: candidate.messageId,
    chatId: typeof candidate.chatId === 'string' ? candidate.chatId : '',
  }
}

/**
 * Create the Feishu long-connection adapter.
 * @param config - one provider instance from the bundle configuration.
 * @param log - bridge logger.
 * @param deps - SDK factories; defaults to the lark node-sdk.
 * @returns the adapter; throws when credentials are missing.
 */
export function createFeishuProvider(
  config: ProviderConfig,
  log: (message: string) => void,
  deps?: FeishuProviderDeps,
): ImProvider {
  const appId = (config.appId ?? '').trim()
  const appSecret = (config.appSecret ?? '').trim()
  if (appId === '' || appSecret === '') throw new Error('feishu provider requires appId and appSecret')
  const id = (config.id ?? '').trim() || 'feishu'
  const factories = deps ?? sdkDeps(appId, appSecret)

  let onMessage: ((message: ImInbound) => void) | undefined
  let dispatcher: FeishuDispatcherLike | undefined
  let socket: FeishuWsLike | undefined
  let client: FeishuClientLike | undefined
  let stopped = false
  const seen = new Set<string>()

  /** Remember one message id, dropping the oldest id once the window is full. */
  const remember = (messageId: string): void => {
    seen.add(messageId)
    if (seen.size <= SEEN_MESSAGE_LIMIT) return
    const oldest = seen.values().next().value
    if (oldest !== undefined) seen.delete(oldest)
  }

  /** Normalise one raw event and hand it to the bridge. */
  const handleEvent = (event: FeishuMessageEvent): void => {
    if (stopped) return
    const message = event.message
    const messageId = message.message_id
    if (messageId === '') {
      log('feishu message without an id ignored')
      return
    }
    if (event.sender.sender_type === 'app') return
    if (seen.has(messageId)) {
      log(`feishu duplicate message ${messageId} ignored`)
      return
    }
    remember(messageId)
    const sender = event.sender.sender_id
    const openId = sender?.open_id ?? ''
    const userId = openId !== '' ? openId : (sender?.user_id ?? '')
    if (userId === '') {
      log(`feishu message ${messageId} has no sender id; ignored`)
      return
    }
    const chatType = message.chat_type === 'p2p' ? 'single' : 'group'
    const inbound: ImInbound = {
      providerId: id,
      userId,
      chatId: message.chat_id,
      chatType,
      text: textOf(message),
      raw: { messageId, chatId: message.chat_id } satisfies FeishuReplyContext,
    }
    log(`feishu inbound ${chatType}:${message.chat_id}`)
    onMessage?.(inbound)
  }

  /** Close the connection and drop the handler; safe to call repeatedly. */
  const stop = (): Promise<void> => {
    if (stopped) return Promise.resolve()
    stopped = true
    onMessage = undefined
    const activeDispatcher = dispatcher
    dispatcher = undefined
    try {
      activeDispatcher?.unregister?.('im.message.receive_v1')
    } catch (error) {
      log(`feishu handler removal failed: ${describeError(error)}`)
    }
    const activeSocket = socket
    socket = undefined
    if (activeSocket !== undefined) {
      try {
        activeSocket.close({ force: true })
      } catch (error) {
        log(`feishu connection close failed: ${describeError(error)}`)
      }
    }
    return Promise.resolve()
  }

  const reply = async (inbound: ImInbound, text: string): Promise<boolean> => {
    const context = replyContextOf(inbound.raw)
    if (context === undefined) {
      log(`feishu cannot reply to ${inbound.providerId}: missing message context`)
      return false
    }
    try {
      const activeClient = client ?? factories.createClient()
      client = activeClient
      const response = await activeClient.im.message.reply({
        path: { message_id: context.messageId },
        data: { msg_type: 'text', content: JSON.stringify({ text }) },
      })
      if (response.code === undefined || response.code === 0) return true
      log(`feishu reply rejected (${String(response.code)}): ${response.msg ?? 'no message'}`)
      return false
    } catch (error) {
      log(`feishu reply failed: ${describeError(error)}`)
      return false
    }
  }

  return {
    kind: 'feishu',
    id,
    async start(handler) {
      if (socket !== undefined) {
        log('feishu long connection already started')
        return stop
      }
      stopped = false
      onMessage = handler
      const nextDispatcher = factories.createDispatcher()
      dispatcher = nextDispatcher
      nextDispatcher.register({
        'im.message.receive_v1': (event) => {
          try {
            handleEvent(event)
          } catch (error) {
            log(`feishu event handling failed: ${describeError(error)}`)
          }
        },
      })
      const nextSocket = factories.createWsClient()
      socket = nextSocket
      log('feishu long connection starting')
      try {
        await nextSocket.start({ eventDispatcher: nextDispatcher })
      } catch (error) {
        // The SDK keeps reconnecting in the background; a first-attempt failure is not fatal.
        log(`feishu long connection unavailable: ${describeError(error)}`)
      }
      return stop
    },
    reply,
  }
}
