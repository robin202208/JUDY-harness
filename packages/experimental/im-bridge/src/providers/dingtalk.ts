/** DingTalk Stream-mode adapter: robot callbacks from DWClient, replies over sessionWebhook. */

import { DWClient, EventAck, TOPIC_ROBOT, type DWClientDownStream } from 'dingtalk-stream'
import type { ProviderConfig } from '../config.ts'
import type { ImInbound, ImProvider } from './types.ts'

/** Stream topic DingTalk pushes robot messages on. */
const ROBOT_TOPIC = TOPIC_ROBOT

/** Title rendered by the markdown reply card. */
const REPLY_TITLE = 'JUDY'

/** Deadline for one sessionWebhook POST; the webhook itself also expires. */
const REPLY_TIMEOUT_MS = 10_000

/** How many recent message ids are remembered for retry de-duplication. */
const MAX_TRACKED_MESSAGE_IDS = 500

/** Minimal downstream frame surfaced by the DingTalk Stream SDK. */
export interface DingTalkDownstream {
  /** Stream envelope headers; `messageId` identifies the frame for acknowledgement. */
  readonly headers: { readonly messageId: string; readonly topic?: string }
  /** JSON-encoded DingTalk robot message. */
  readonly data: string
}

/** Narrow client surface the adapter needs from the SDK's DWClient. */
export interface DingTalkClientLike {
  /** Register the callback listener for one topic. */
  registerCallbackListener(topic: string, listener: (downstream: DingTalkDownstream) => void): void
  /** Open the Stream connection; the SDK owns reconnection. */
  connect(): Promise<void>
  /** Close the Stream connection. */
  disconnect(): void
  /** Remove a listener registered earlier, so a stopped client receives nothing. */
  removeCallbackListener?(topic: string, listener: (downstream: DingTalkDownstream) => void): void
  /** Acknowledge one callback frame so DingTalk stops retrying it. */
  socketCallBackResponse?(messageId: string, result: unknown): void
}

/** Test seam: builds the DingTalk client the adapter talks to. */
export interface DingTalkProviderDeps {
  /** Create one unconnected Stream client. */
  createClient(): DingTalkClientLike
}

/** Reply context stored in `ImInbound.raw` for one DingTalk message. */
interface DingTalkReplyContext {
  readonly messageId: string
  readonly sessionWebhook: string
  readonly conversationId: string
}

/** One robot message decoded from the callback body. */
interface DingTalkRobotMessage {
  readonly messageId: string
  readonly userId: string
  readonly chatId: string
  readonly chatType: 'single' | 'group'
  readonly text: string
  readonly sessionWebhook: string
  readonly conversationId: string
}

const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

const stringField = (record: Record<string, unknown>, key: string): string => {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Wrap the SDK client in the narrow surface the adapter depends on. */
const createSdkClient = (clientId: string, clientSecret: string): DingTalkClientLike => {
  const client = new DWClient({ clientId, clientSecret, keepAlive: true })
  const wrappedListeners = new Map<
    (downstream: DingTalkDownstream) => void,
    (downstream: DWClientDownStream) => void
  >()
  return {
    registerCallbackListener(topic, listener) {
      const wrapped = (downstream: DWClientDownStream): void => { listener(downstream) }
      wrappedListeners.set(listener, wrapped)
      client.registerCallbackListener(topic, wrapped)
    },
    removeCallbackListener(topic, listener) {
      const wrapped = wrappedListeners.get(listener)
      if (wrapped === undefined) return
      wrappedListeners.delete(listener)
      client.removeListener(topic, wrapped)
    },
    async connect() {
      await client.connect()
    },
    disconnect() {
      client.disconnect()
    },
    socketCallBackResponse(messageId, result) {
      client.socketCallBackResponse(messageId, result)
    },
  }
}

/** Decode the robot message body, or `undefined` when it carries no usable text. */
const decodeRobotMessage = (raw: string): DingTalkRobotMessage | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  const body = asRecord(parsed)
  const messageId = stringField(body, 'msgId')
  const senderStaffId = stringField(body, 'senderStaffId')
  const senderId = stringField(body, 'senderId')
  const userId = senderStaffId !== '' ? senderStaffId : senderId
  const conversationId = stringField(body, 'conversationId')
  const chatType = stringField(body, 'conversationType') === '2' ? 'group' : 'single'
  const chatId = conversationId !== '' ? conversationId : userId
  const msgtype = stringField(body, 'msgtype')
  const text = msgtype === 'text' ? stringField(asRecord(body.text), 'content').trim() : ''
  if (messageId === '' || userId === '' || chatId === '' || text === '') return undefined
  return {
    messageId,
    userId,
    chatId,
    chatType,
    text,
    sessionWebhook: stringField(body, 'sessionWebhook'),
    conversationId,
  }
}

/** Read a JSON object body, degrading to `undefined` for an unreadable body. */
const readResponseBody = async (response: Response): Promise<Record<string, unknown> | undefined> => {
  try {
    const parsed: unknown = await response.json()
    return asRecord(parsed)
  } catch {
    return undefined
  }
}

/**
 * Create the DingTalk Stream adapter.
 * @param config - one provider instance from the bundle configuration.
 * @param log - bridge logger.
 * @param deps - optional client factory used by tests; defaults to the dingtalk-stream SDK.
 * @returns the adapter; throws when credentials are missing.
 */
export function createDingTalkProvider(
  config: ProviderConfig,
  log: (message: string) => void,
  deps?: DingTalkProviderDeps,
): ImProvider {
  const clientId = (config.clientId ?? '').trim()
  const clientSecret = (config.clientSecret ?? '').trim()
  if (clientId === '' || clientSecret === '') throw new Error('dingtalk provider requires clientId and clientSecret')
  const id = (config.id ?? '').trim() || 'dingtalk'
  const factory: DingTalkProviderDeps = deps ?? { createClient: () => createSdkClient(clientId, clientSecret) }

  const seenMessageIds = new Set<string>()
  let active: { readonly teardown: () => Promise<void> } | undefined

  const remember = (messageId: string): void => {
    seenMessageIds.add(messageId)
    if (seenMessageIds.size <= MAX_TRACKED_MESSAGE_IDS) return
    const oldest = seenMessageIds.values().next().value
    if (oldest !== undefined) seenMessageIds.delete(oldest)
  }

  const acknowledge = (client: DingTalkClientLike, messageId: string): void => {
    if (messageId === '' || client.socketCallBackResponse === undefined) return
    try {
      client.socketCallBackResponse(messageId, { status: EventAck.SUCCESS })
    } catch (error) {
      log(`dingtalk acknowledge failed: ${errorMessage(error)}`)
    }
  }

  const handleDownstream = (
    client: DingTalkClientLike,
    downstream: DingTalkDownstream,
    deliver: (message: ImInbound) => void,
  ): void => {
    acknowledge(client, downstream.headers.messageId)
    const message = decodeRobotMessage(downstream.data)
    if (message === undefined) {
      log('dingtalk callback without a usable text message; ignored')
      return
    }
    if (seenMessageIds.has(message.messageId)) {
      log(`dingtalk duplicate message ignored (${message.messageId})`)
      return
    }
    remember(message.messageId)
    const inbound: ImInbound = {
      providerId: id,
      userId: message.userId,
      chatId: message.chatId,
      chatType: message.chatType,
      text: message.text,
      raw: {
        messageId: message.messageId,
        sessionWebhook: message.sessionWebhook,
        conversationId: message.conversationId,
      } satisfies DingTalkReplyContext,
    }
    log(`dingtalk inbound ${message.chatType}:${message.chatId} from ${message.userId}`)
    try {
      deliver(inbound)
    } catch (error) {
      log(`dingtalk message handler failed: ${errorMessage(error)}`)
    }
  }

  const reply = async (inbound: ImInbound, text: string): Promise<boolean> => {
    const webhook = stringField(asRecord(inbound.raw), 'sessionWebhook')
    if (webhook === '') {
      log('dingtalk reply skipped: inbound message has no sessionWebhook')
      return false
    }
    const payload = { msgtype: 'markdown', markdown: { title: REPLY_TITLE, text } }
    try {
      const response = await fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REPLY_TIMEOUT_MS),
      })
      if (!response.ok) {
        log(`dingtalk reply rejected with HTTP ${String(response.status)}`)
        return false
      }
      const body = await readResponseBody(response)
      if (body !== undefined) {
        const errcode = body.errcode
        if (typeof errcode === 'number' && errcode !== 0) {
          log(`dingtalk reply rejected ${String(errcode)} ${stringField(body, 'errmsg')}`)
          return false
        }
      }
      return true
    } catch (error) {
      log(`dingtalk reply failed: ${errorMessage(error)}`)
      return false
    }
  }

  return {
    kind: 'dingtalk',
    id,
    async start(onMessage) {
      if (active !== undefined) {
        log('dingtalk adapter already started; reusing the active connection')
        return active.teardown
      }
      const client = factory.createClient()
      const listener = (downstream: DingTalkDownstream): void => { handleDownstream(client, downstream, onMessage) }
      client.registerCallbackListener(ROBOT_TOPIC, listener)
      let stopped = false
      const teardown = (): Promise<void> => {
        if (stopped) return Promise.resolve()
        stopped = true
        client.removeCallbackListener?.(ROBOT_TOPIC, listener)
        if (active?.teardown === teardown) active = undefined
        try {
          client.disconnect()
        } catch (error) {
          log(`dingtalk disconnect failed: ${errorMessage(error)}`)
        }
        return Promise.resolve()
      }
      active = { teardown }
      try {
        await client.connect()
        log(`dingtalk stream client connected (${id})`)
      } catch (error) {
        log(`dingtalk initial connection failed, the SDK keeps retrying: ${errorMessage(error)}`)
      }
      return teardown
    },
    reply,
  }
}
