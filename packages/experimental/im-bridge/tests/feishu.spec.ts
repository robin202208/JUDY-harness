import { describe, expect, it } from 'vitest'
import type { ProviderConfig } from '../src/config.ts'
import type { ImInbound, ImProvider } from '../src/providers/types.ts'
import {
  createFeishuProvider,
  type FeishuClientLike,
  type FeishuDispatcherLike,
  type FeishuEventHandles,
  type FeishuMessageEvent,
  type FeishuMessageHandler,
  type FeishuProviderDeps,
  type FeishuReplyResponse,
  type FeishuWsLike,
} from '../src/providers/feishu.ts'

/** Credentials shared by the tests; only the injected fakes ever see them. */
const CONFIG: ProviderConfig = { kind: 'feishu', appId: 'cli_test_app_id', appSecret: 'app-secret' }

interface ReplyPayload {
  readonly path: { readonly message_id: string }
  readonly data: { readonly msg_type: string; readonly content: string }
}

class FakeDispatcher implements FeishuDispatcherLike {
  readonly handlers = new Map<string, FeishuMessageHandler>()
  readonly removed: string[] = []
  removalFailure: Error | undefined = undefined

  register(handles: FeishuEventHandles): this {
    this.handlers.set('im.message.receive_v1', handles['im.message.receive_v1'])
    return this
  }

  unregister(...keys: string[]): this {
    if (this.removalFailure !== undefined) throw this.removalFailure
    for (const key of keys) {
      this.handlers.delete(key)
      this.removed.push(key)
    }
    return this
  }

  dispatch(event: FeishuMessageEvent): void {
    const handler = this.handlers.get('im.message.receive_v1')
    if (handler === undefined) throw new Error('feishu handler is not registered')
    handler(event)
  }
}

class FakeWs implements FeishuWsLike {
  readonly dispatchers: FeishuDispatcherLike[] = []
  closes = 0
  forced = false
  failure: Error | undefined = undefined

  async start(params: { readonly eventDispatcher: FeishuDispatcherLike }): Promise<void> {
    this.dispatchers.push(params.eventDispatcher)
    if (this.failure !== undefined) throw this.failure
  }

  close(params?: { readonly force?: boolean }): void {
    this.closes += 1
    this.forced = params?.force === true
  }
}

class FakeClient implements FeishuClientLike {
  readonly calls: ReplyPayload[] = []
  response: FeishuReplyResponse = { code: 0 }
  failure: Error | undefined = undefined

  readonly im = {
    message: {
      reply: async (payload: ReplyPayload): Promise<FeishuReplyResponse> => {
        this.calls.push(payload)
        if (this.failure !== undefined) throw this.failure
        return this.response
      },
    },
  }
}

class FakeDeps implements FeishuProviderDeps {
  readonly client = new FakeClient()
  readonly ws = new FakeWs()
  readonly dispatcher = new FakeDispatcher()
  clientCalls = 0
  wsCalls = 0
  dispatcherCalls = 0

  createClient(): FeishuClientLike {
    this.clientCalls += 1
    return this.client
  }

  createWsClient(): FeishuWsLike {
    this.wsCalls += 1
    return this.ws
  }

  createDispatcher(): FeishuDispatcherLike {
    this.dispatcherCalls += 1
    return this.dispatcher
  }
}

interface Started {
  readonly provider: ImProvider
  readonly deps: FakeDeps
  readonly logs: string[]
  readonly received: ImInbound[]
  readonly stop: () => Promise<void>
}

/** Start one provider over fresh fakes and collect every delivered message. */
const startWith = async (deps: FakeDeps, overrides: Partial<ProviderConfig> = {}): Promise<Started> => {
  const logs: string[] = []
  const received: ImInbound[] = []
  const provider = createFeishuProvider({ ...CONFIG, ...overrides }, (message) => { logs.push(message) }, deps)
  const stop = await provider.start((message) => { received.push(message) })
  return { provider, deps, logs, received, stop }
}

const startProvider = async (overrides: Partial<ProviderConfig> = {}): Promise<Started> => startWith(new FakeDeps(), overrides)

interface EventOptions {
  readonly messageId?: string
  readonly chatId?: string
  readonly chatType?: string
  readonly openId?: string
  readonly userId?: string
  readonly senderType?: string
  readonly messageType?: string
  readonly content?: string
}

/** Build one `im.message.receive_v1` event payload. */
const textEvent = (options: EventOptions = {}): FeishuMessageEvent => ({
  sender: {
    sender_id: { open_id: options.openId ?? 'ou_sender', user_id: options.userId ?? 'on_sender' },
    sender_type: options.senderType ?? 'user',
  },
  message: {
    message_id: options.messageId ?? 'om_first',
    chat_id: options.chatId ?? 'oc_chat',
    chat_type: options.chatType ?? 'p2p',
    message_type: options.messageType ?? 'text',
    content: options.content ?? JSON.stringify({ text: 'hello' }),
  },
})

/** Build one inbound message whose reply context is the given value. */
const inboundWith = (raw: unknown): ImInbound => ({
  providerId: 'feishu',
  userId: 'ou_sender',
  chatId: 'oc_chat',
  chatType: 'single',
  text: 'hello',
  raw,
})

describe('createFeishuProvider', () => {
  it('requires app credentials', () => {
    expect(() => createFeishuProvider({ kind: 'feishu' }, () => {})).toThrow('feishu provider requires appId and appSecret')
    expect(() => createFeishuProvider({ kind: 'feishu', appId: 'cli_x' }, () => {})).toThrow('feishu provider requires appId and appSecret')
    expect(() => createFeishuProvider({ kind: 'feishu', appId: '  ', appSecret: '  ' }, () => {})).toThrow('feishu provider requires appId and appSecret')
  })

  it('uses the configured instance id and defaults to the provider kind', () => {
    expect(createFeishuProvider(CONFIG, () => {}).id).toBe('feishu')
    expect(createFeishuProvider({ ...CONFIG, id: '  ' }, () => {}).id).toBe('feishu')
    const named = createFeishuProvider({ ...CONFIG, id: 'sales' }, () => {})
    expect(named.kind).toBe('feishu')
    expect(named.id).toBe('sales')
  })

  it('opens one long connection bound to the registered event dispatcher', async () => {
    const { provider, deps, logs } = await startProvider()
    expect(provider.kind).toBe('feishu')
    expect(provider.id).toBe('feishu')
    expect(deps.dispatcherCalls).toBe(1)
    expect(deps.wsCalls).toBe(1)
    expect(deps.ws.dispatchers).toEqual([deps.dispatcher])
    expect([...deps.dispatcher.handlers.keys()]).toEqual(['im.message.receive_v1'])
    expect(logs).toContain('feishu long connection starting')
  })

  it('does not open a second connection when started twice', async () => {
    const started = await startProvider()
    const stopAgain = await started.provider.start(() => {})
    expect(started.deps.wsCalls).toBe(1)
    expect(stopAgain).toBe(started.stop)
  })

  it('survives a long connection that cannot be established yet', async () => {
    const deps = new FakeDeps()
    deps.ws.failure = new Error('connect ECONNREFUSED')
    const started = await startWith(deps)
    expect(started.logs.some(line => line.includes('ECONNREFUSED'))).toBe(true)
    expect([...deps.dispatcher.handlers.keys()]).toEqual(['im.message.receive_v1'])
  })

  it('normalises a direct text message into an inbound message', async () => {
    const { deps, received } = await startProvider()
    deps.dispatcher.dispatch(textEvent({ content: JSON.stringify({ text: '  hello  ' }) }))
    expect(received).toEqual([{
      providerId: 'feishu',
      userId: 'ou_sender',
      chatId: 'oc_chat',
      chatType: 'single',
      text: 'hello',
      raw: { messageId: 'om_first', chatId: 'oc_chat' },
    }])
  })

  it('maps group chats and falls back to the platform user id', async () => {
    const { deps, received } = await startProvider({ id: 'ops' })
    deps.dispatcher.dispatch(textEvent({ chatType: 'group', chatId: 'oc_group', openId: '', userId: 'on_sender' }))
    expect(received[0]).toMatchObject({
      providerId: 'ops',
      userId: 'on_sender',
      chatId: 'oc_group',
      chatType: 'group',
      text: 'hello',
    })
  })

  it('replaces non-text content with a placeholder', async () => {
    const { deps, received } = await startProvider()
    deps.dispatcher.dispatch(textEvent({ messageType: 'image', content: '{"image_key":"img_v2_key"}' }))
    expect(received[0]?.text).toBe('[image 消息]')
  })

  it('replaces unreadable text content with a placeholder', async () => {
    const { deps, received } = await startProvider()
    deps.dispatcher.dispatch(textEvent({ messageId: 'om_bad_json', content: 'not-json' }))
    deps.dispatcher.dispatch(textEvent({ messageId: 'om_no_text', content: '{"file_key":"file_v2_key"}' }))
    expect(received.map(message => message.text)).toEqual(['[text 消息]', '[text 消息]'])
  })

  it('ignores messages sent by the bot itself', async () => {
    const { deps, received } = await startProvider()
    deps.dispatcher.dispatch(textEvent({ senderType: 'app' }))
    expect(received).toEqual([])
  })

  it('ignores a redelivered message id', async () => {
    const { deps, received, logs } = await startProvider()
    deps.dispatcher.dispatch(textEvent())
    deps.dispatcher.dispatch(textEvent())
    expect(received).toHaveLength(1)
    expect(logs).toContain('feishu duplicate message om_first ignored')
  })

  it('ignores messages without a message id or a sender id', async () => {
    const { deps, received, logs } = await startProvider()
    deps.dispatcher.dispatch(textEvent({ messageId: '' }))
    deps.dispatcher.dispatch(textEvent({ messageId: 'om_no_sender', openId: '', userId: '' }))
    expect(received).toEqual([])
    expect(logs).toContain('feishu message without an id ignored')
    expect(logs).toContain('feishu message om_no_sender has no sender id; ignored')
  })

  it('contains a throwing message callback so the connection keeps delivering', async () => {
    const deps = new FakeDeps()
    const logs: string[] = []
    const provider = createFeishuProvider(CONFIG, (message) => { logs.push(message) }, deps)
    await provider.start(() => { throw new Error('bridge exploded') })
    expect(() => { deps.dispatcher.dispatch(textEvent()) }).not.toThrow()
    expect(logs.some(line => line.includes('bridge exploded'))).toBe(true)
  })

  it('replies to the originating message with a text payload exactly once', async () => {
    const { deps, provider, received } = await startProvider()
    deps.dispatcher.dispatch(textEvent({ messageId: 'om_reply' }))
    const inbound = received[0]
    if (inbound === undefined) throw new Error('no inbound message delivered')
    expect(await provider.reply(inbound, 'answer')).toBe(true)
    expect(await provider.reply(inbound, 'again')).toBe(true)
    expect(deps.client.calls).toEqual([
      { path: { message_id: 'om_reply' }, data: { msg_type: 'text', content: '{"text":"answer"}' } },
      { path: { message_id: 'om_reply' }, data: { msg_type: 'text', content: '{"text":"again"}' } },
    ])
    expect(deps.clientCalls).toBe(1)
  })

  it('accepts a reply response without an error code', async () => {
    const { deps, provider } = await startProvider()
    deps.client.response = {}
    expect(await provider.reply(inboundWith({ messageId: 'om_reply', chatId: 'oc_chat' }), 'answer')).toBe(true)
  })

  it('reports a rejected reply and logs the platform reason', async () => {
    const { deps, provider, logs } = await startProvider()
    deps.client.response = { code: 99991400, msg: 'rate limited' }
    expect(await provider.reply(inboundWith({ messageId: 'om_reply' }), 'answer')).toBe(false)
    expect(logs.some(line => line.includes('99991400') && line.includes('rate limited'))).toBe(true)
  })

  it('reports a failed reply call', async () => {
    const { deps, provider, logs } = await startProvider()
    deps.client.failure = new Error('network down')
    expect(await provider.reply(inboundWith({ messageId: 'om_reply' }), 'answer')).toBe(false)
    expect(logs.some(line => line.includes('network down'))).toBe(true)
  })

  it('refuses to reply without a usable message context', async () => {
    const { provider, deps, logs } = await startProvider()
    expect(await provider.reply(inboundWith(undefined), 'answer')).toBe(false)
    expect(await provider.reply(inboundWith({ messageId: 42 }), 'answer')).toBe(false)
    expect(await provider.reply(inboundWith({ chatId: 'oc_chat' }), 'answer')).toBe(false)
    expect(deps.clientCalls).toBe(0)
    expect(logs.some(line => line.includes('missing message context'))).toBe(true)
  })

  it('closes the connection, removes the handler, and stops delivering on teardown', async () => {
    const { deps, received, stop } = await startProvider()
    const handler = deps.dispatcher.handlers.get('im.message.receive_v1')
    if (handler === undefined) throw new Error('feishu handler was not registered')
    await stop()
    expect(deps.dispatcher.removed).toEqual(['im.message.receive_v1'])
    expect(deps.ws.closes).toBe(1)
    expect(deps.ws.forced).toBe(true)
    handler(textEvent())
    expect(received).toEqual([])
    await stop()
    expect(deps.dispatcher.removed).toHaveLength(1)
    expect(deps.ws.closes).toBe(1)
  })

  it('tears down a dispatcher that cannot unregister handlers', async () => {
    let registered: FeishuEventHandles | undefined
    const ws = new FakeWs()
    const deps: FeishuProviderDeps = {
      createClient: () => new FakeClient(),
      createWsClient: () => ws,
      createDispatcher: () => ({ register: (handles) => { registered = handles } }),
    }
    const provider = createFeishuProvider(CONFIG, () => {}, deps)
    const stop = await provider.start(() => {})
    await stop()
    expect(registered).toBeDefined()
    expect(ws.closes).toBe(1)
  })

  it('logs a failed handler removal and still closes the connection', async () => {
    const { deps, logs, stop } = await startProvider()
    deps.dispatcher.removalFailure = new Error('unregister exploded')
    await stop()
    expect(logs.some(line => line.includes('unregister exploded'))).toBe(true)
    expect(deps.ws.closes).toBe(1)
  })

  it('reuses one lazily created client for every reply', async () => {
    const { deps, provider } = await startProvider()
    expect(deps.clientCalls).toBe(0)
    await provider.reply(inboundWith({ messageId: 'om_one' }), 'one')
    await provider.reply(inboundWith({ messageId: 'om_two' }), 'two')
    expect(deps.clientCalls).toBe(1)
  })
})
