import { EventAck, TOPIC_ROBOT } from 'dingtalk-stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderConfig } from '../src/config.ts'
import {
  createDingTalkProvider,
  type DingTalkClientLike,
  type DingTalkDownstream,
  type DingTalkProviderDeps,
} from '../src/providers/dingtalk.ts'
import type { ImInbound } from '../src/providers/types.ts'

interface AckRecord {
  readonly messageId: string
  readonly result: unknown
}

interface FetchRecord {
  readonly url: string
  readonly init: RequestInit | undefined
}

class FakeDingTalkClient implements DingTalkClientLike {
  connectCalls = 0
  disconnectCalls = 0
  connectError: Error | undefined
  readonly acks: AckRecord[] = []
  private readonly listeners = new Map<string, Set<(downstream: DingTalkDownstream) => void>>()

  registerCallbackListener(topic: string, listener: (downstream: DingTalkDownstream) => void): void {
    const listeners = this.listeners.get(topic) ?? new Set()
    listeners.add(listener)
    this.listeners.set(topic, listeners)
  }

  removeCallbackListener(topic: string, listener: (downstream: DingTalkDownstream) => void): void {
    this.listeners.get(topic)?.delete(listener)
  }

  async connect(): Promise<void> {
    this.connectCalls += 1
    if (this.connectError !== undefined) throw this.connectError
  }

  disconnect(): void {
    this.disconnectCalls += 1
  }

  socketCallBackResponse(messageId: string, result: unknown): void {
    this.acks.push({ messageId, result })
  }

  listenerCount(topic: string): number {
    return this.listeners.get(topic)?.size ?? 0
  }

  emit(downstream: DingTalkDownstream): void {
    for (const listener of [...(this.listeners.get(TOPIC_ROBOT) ?? [])]) listener(downstream)
  }
}

const config = (overrides: Partial<ProviderConfig> = {}): ProviderConfig => ({
  kind: 'dingtalk',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  ...overrides,
})

const depsFor = (client: DingTalkClientLike): DingTalkProviderDeps => ({ createClient: () => client })

const downstreamOf = (payload: string, frameId = 'frame-1'): DingTalkDownstream => ({
  headers: { messageId: frameId, topic: TOPIC_ROBOT },
  data: payload,
})

const robotPayload = (overrides: Record<string, unknown> = {}): string => JSON.stringify({
  msgtype: 'text',
  text: { content: '  你好  ' },
  msgId: 'msg-1',
  senderStaffId: 'staff-1',
  senderId: 'sender-1',
  conversationId: 'cid-1',
  conversationType: '2',
  sessionWebhook: 'https://api.dingtalk.test/session/webhook',
  sessionWebhookExpiredTime: 1_700_000_000_000,
  ...overrides,
})

const onlyMessage = (messages: readonly ImInbound[]): ImInbound => {
  const [message] = messages
  if (message === undefined || messages.length !== 1) throw new Error(`expected one inbound message, got ${String(messages.length)}`)
  return message
}

const stubFetch = (respond: (url: string, init: RequestInit | undefined) => Promise<Response>): FetchRecord[] => {
  const calls: FetchRecord[] = []
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init })
    return respond(url, init)
  }))
  return calls
}

const startedProvider = async (client: FakeDingTalkClient, overrides: Partial<ProviderConfig> = {}) => {
  const messages: ImInbound[] = []
  const logs: string[] = []
  const provider = createDingTalkProvider(config(overrides), (message) => { logs.push(message) }, depsFor(client))
  const stop = await provider.start((message) => { messages.push(message) })
  return { provider, stop, messages, logs }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('createDingTalkProvider', () => {
  it('requires clientId and clientSecret and keeps a custom instance id', () => {
    expect(() => createDingTalkProvider({ kind: 'dingtalk' }, () => {})).toThrow('dingtalk provider requires clientId and clientSecret')
    expect(() => createDingTalkProvider({ kind: 'dingtalk', clientId: 'id' }, () => {})).toThrow('dingtalk provider requires clientId and clientSecret')
    expect(() => createDingTalkProvider({ kind: 'dingtalk', clientId: '  ', clientSecret: 'secret' }, () => {})).toThrow('dingtalk provider requires clientId and clientSecret')

    const provider = createDingTalkProvider(config({ id: 'dingtalk-work' }), () => {}, depsFor(new FakeDingTalkClient()))
    expect(provider.kind).toBe('dingtalk')
    expect(provider.id).toBe('dingtalk-work')
  })

  it('connects, registers the robot listener and normalises a group text message', async () => {
    const client = new FakeDingTalkClient()
    const { messages, stop, provider } = await startedProvider(client)

    expect(provider.id).toBe('dingtalk')
    expect(client.connectCalls).toBe(1)
    expect(client.listenerCount(TOPIC_ROBOT)).toBe(1)

    client.emit(downstreamOf(robotPayload()))
    const inbound = onlyMessage(messages)
    expect(inbound).toEqual({
      providerId: 'dingtalk',
      userId: 'staff-1',
      chatId: 'cid-1',
      chatType: 'group',
      text: '你好',
      raw: {
        messageId: 'msg-1',
        sessionWebhook: 'https://api.dingtalk.test/session/webhook',
        conversationId: 'cid-1',
      },
    })
    expect(client.acks).toEqual([{ messageId: 'frame-1', result: { status: EventAck.SUCCESS } }])

    await stop()
  })

  it('falls back to senderId and the sender user id for direct chats', async () => {
    const client = new FakeDingTalkClient()
    const { messages, stop } = await startedProvider(client, { id: 'dingtalk-direct' })

    client.emit(downstreamOf(robotPayload({
      msgId: 'msg-direct',
      senderStaffId: '',
      senderId: 'sender-9',
      conversationId: '',
      conversationType: '1',
    })))
    const inbound = onlyMessage(messages)
    expect(inbound.providerId).toBe('dingtalk-direct')
    expect(inbound.userId).toBe('sender-9')
    expect(inbound.chatId).toBe('sender-9')
    expect(inbound.chatType).toBe('single')

    await stop()
  })

  it('ignores duplicate, empty-text, non-text and unparseable callbacks', async () => {
    const client = new FakeDingTalkClient()
    const { messages, stop, logs } = await startedProvider(client)

    client.emit(downstreamOf(robotPayload(), 'frame-1'))
    client.emit(downstreamOf(robotPayload(), 'frame-2'))
    client.emit(downstreamOf(robotPayload({ msgId: 'msg-2', text: { content: '   ' } }), 'frame-3'))
    client.emit(downstreamOf(robotPayload({ msgId: 'msg-3', msgtype: 'picture' }), 'frame-4'))
    client.emit(downstreamOf('not json', 'frame-5'))
    client.emit(downstreamOf(JSON.stringify({ msgId: 'msg-4', msgtype: 'text', text: { content: 'hi' }, senderId: 'sender-1' }), 'frame-6'))

    expect(messages).toHaveLength(2)
    expect(messages[0]?.text).toBe('你好')
    expect(messages[1]?.text).toBe('hi')
    expect(messages[1]?.chatId).toBe('sender-1')
    expect(logs.some(line => line.includes('duplicate message ignored (msg-1)'))).toBe(true)
    expect(logs.some(line => line.includes('without a usable text message'))).toBe(true)
    expect(client.acks).toHaveLength(6)

    await stop()
  })

  it('replies through the sessionWebhook with a markdown body', async () => {
    const calls = stubFetch(() => Promise.resolve(new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }))))
    const client = new FakeDingTalkClient()
    const { messages, stop, provider } = await startedProvider(client)
    client.emit(downstreamOf(robotPayload()))
    const inbound = onlyMessage(messages)

    const accepted = await provider.reply(inbound, 'hello from judy')

    expect(accepted).toBe(true)
    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call?.url).toBe('https://api.dingtalk.test/session/webhook')
    expect(call?.init?.method).toBe('POST')
    expect(call?.init?.headers).toEqual({ 'content-type': 'application/json' })
    const body = call?.init?.body
    if (typeof body !== 'string') throw new Error('expected a stringified reply body')
    expect(JSON.parse(body)).toEqual({
      msgtype: 'markdown',
      markdown: { title: 'JUDY', text: 'hello from judy' },
    })

    await stop()
  })

  it('reports failure when the reply has no webhook, is rejected, or the request fails', async () => {
    const client = new FakeDingTalkClient()
    const provider = createDingTalkProvider(config(), () => {}, depsFor(client))
    const inbound = (raw: unknown): ImInbound => ({
      providerId: 'dingtalk',
      userId: 'staff-1',
      chatId: 'cid-1',
      chatType: 'group',
      text: 'hi',
      raw,
    })

    expect(await provider.reply(inbound({}), 'hello')).toBe(false)

    const httpCalls = stubFetch(() => Promise.resolve(new Response('rejected', { status: 500 })))
    expect(await provider.reply(inbound({ sessionWebhook: 'https://api.dingtalk.test/session/webhook' }), 'hello')).toBe(false)
    expect(httpCalls).toHaveLength(1)

    stubFetch(() => Promise.resolve(new Response(JSON.stringify({ errcode: 310_000, errmsg: 'expired' }))))
    expect(await provider.reply(inbound({ sessionWebhook: 'https://api.dingtalk.test/session/webhook' }), 'hello')).toBe(false)

    stubFetch(() => Promise.reject(new Error('offline')))
    expect(await provider.reply(inbound({ sessionWebhook: 'https://api.dingtalk.test/session/webhook' }), 'hello')).toBe(false)

    stubFetch(() => Promise.resolve(new Response('not json')))
    expect(await provider.reply(inbound({ sessionWebhook: 'https://api.dingtalk.test/session/webhook' }), 'hello')).toBe(true)
  })

  it('tears down idempotently and can start again afterwards', async () => {
    const client = new FakeDingTalkClient()
    const { messages, stop, provider } = await startedProvider(client)

    expect(await provider.start((message) => { messages.push(message) })).toBe(stop)
    expect(client.connectCalls).toBe(1)

    await stop()
    await stop()
    expect(client.disconnectCalls).toBe(1)
    expect(client.listenerCount(TOPIC_ROBOT)).toBe(0)

    client.emit(downstreamOf(robotPayload()))
    expect(messages).toHaveLength(0)

    const restarted = await provider.start((message) => { messages.push(message) })
    expect(client.connectCalls).toBe(2)
    expect(client.listenerCount(TOPIC_ROBOT)).toBe(1)
    client.emit(downstreamOf(robotPayload()))
    expect(messages).toHaveLength(1)
    await restarted()
  })

  it('does not reject start when the initial connection fails', async () => {
    const client = new FakeDingTalkClient()
    client.connectError = new Error('offline')
    const logs: string[] = []
    const provider = createDingTalkProvider(config(), (message) => { logs.push(message) }, depsFor(client))

    const stop = await provider.start(() => {})
    expect(typeof stop).toBe('function')
    expect(logs.some(line => line.includes('initial connection failed'))).toBe(true)
    await stop()
    expect(client.disconnectCalls).toBe(1)
  })
})
