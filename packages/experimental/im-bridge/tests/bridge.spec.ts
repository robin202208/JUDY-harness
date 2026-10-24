import { describe, expect, it, vi } from 'vitest'
import { ChatBridge } from '../src/bridge.ts'
import type { ImInbound, ImProvider } from '../src/providers/types.ts'

const inbound = (overrides: Partial<ImInbound> = {}): ImInbound => ({
  providerId: 't',
  userId: 'u1',
  chatId: 'c1',
  chatType: 'single',
  text: 'hello',
  raw: {},
  ...overrides,
})

/** Agent whose followup settles asynchronously with `answer`. */
function fakeAgent(answer: string): { agent: unknown; session: { seq: number }; disposed: ReturnType<typeof vi.fn> } {
  const messages: { role: string; content: { type: string; text: string }[] }[] = []
  const session = {
    seq: 0,
    deriveMessages: () => messages,
  }
  const disposed = vi.fn(async () => {})
  const agent = {
    status: 'idle',
    session,
    followup: () => {
      agent.status = 'running'
      session.seq += 1
      setTimeout(() => {
        messages.push({ role: 'assistant', content: [{ type: 'text', text: answer }] })
        agent.status = 'idle'
      }, 5)
    },
  }
  return { agent, session, disposed }
}

/** Context stub exposing only the services the bridge reads. */
function makeContext(agent: unknown, disposed: ReturnType<typeof vi.fn>, overrides: { createError?: Error } = {}) {
  const create = vi.fn(async () => {
    if (overrides.createError !== undefined) throw overrides.createError
    return { agent, dispose: disposed }
  })
  const resume = vi.fn(async () => ({ agent, dispose: disposed }))
  const ctx = {
    agents: { get: () => undefined, create, resume },
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
    agentPresets: { mount: vi.fn(async () => ({ id: 'p' })) },
  }
  return { ctx, create, resume }
}

const makeProvider = (): { provider: ImProvider; reply: ReturnType<typeof vi.fn> } => {
  const reply = vi.fn(async () => true)
  return { provider: { kind: 'wecom', id: 't', start: vi.fn(async () => async () => {}), reply }, reply }
}

describe('ChatBridge', () => {
  it('runs one turn and replies with the assistant text', async () => {
    const fake = fakeAgent('answer')
    const { ctx, create } = makeContext(fake.agent, fake.disposed)
    const { provider, reply } = makeProvider()
    const bridge = new ChatBridge(ctx as never, provider, { config: { kind: 'wecom', turnTimeoutMs: 5000 }, log: () => {} })
    bridge.handle(inbound())
    await vi.waitFor(() => { expect(reply).toHaveBeenCalledTimes(1) }, { timeout: 5000 })
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'c1' }), 'answer')
    expect(create).toHaveBeenCalledTimes(1)
    await bridge.dispose()
  })

  it('ignores senders outside the allowlist', async () => {
    const fake = fakeAgent('answer')
    const { ctx, create } = makeContext(fake.agent, fake.disposed)
    const { provider, reply } = makeProvider()
    const bridge = new ChatBridge(ctx as never, provider, {
      config: { kind: 'wecom', allowedUsers: ['allowed'], turnTimeoutMs: 5000 },
      log: () => {},
    })
    bridge.handle(inbound({ userId: 'intruder' }))
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(create).not.toHaveBeenCalled()
    expect(reply).not.toHaveBeenCalled()
    await bridge.dispose()
  })

  it('resumes when the session already exists on disk', async () => {
    const fake = fakeAgent('resumed answer')
    const { ctx, resume } = makeContext(fake.agent, fake.disposed, { createError: new Error('session already exists') })
    const { provider, reply } = makeProvider()
    const bridge = new ChatBridge(ctx as never, provider, { config: { kind: 'wecom', turnTimeoutMs: 5000 }, log: () => {} })
    bridge.handle(inbound())
    await vi.waitFor(() => { expect(reply).toHaveBeenCalledTimes(1) }, { timeout: 5000 })
    expect(resume).toHaveBeenCalledTimes(1)
    expect(reply).toHaveBeenCalledWith(expect.anything(), 'resumed answer')
    await bridge.dispose()
  })

  it('truncates replies beyond the configured message length', async () => {
    const fake = fakeAgent('x'.repeat(100))
    const { ctx } = makeContext(fake.agent, fake.disposed)
    const { provider, reply } = makeProvider()
    const bridge = new ChatBridge(ctx as never, provider, {
      config: { kind: 'wecom', maxMessageLength: 20, turnTimeoutMs: 5000 },
      log: () => {},
    })
    bridge.handle(inbound())
    await vi.waitFor(() => { expect(reply).toHaveBeenCalledTimes(1) }, { timeout: 5000 })
    const [inboundArg, body] = reply.mock.calls[0] as [ImInbound, string]
    expect(inboundArg.chatId).toBe('c1')
    expect(body.length).toBeLessThanOrEqual(20)
    expect(body).toContain('截断')
    await bridge.dispose()
  })
})
