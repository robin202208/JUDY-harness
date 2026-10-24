import { describe, expect, it, vi } from 'vitest'
import { createWeComProvider } from '../src/providers/wecom.ts'
import type { WeComSocketLike } from '../src/providers/wecom.ts'

/** Minimal scriptable socket for the adapter's transport seam. */
class FakeSocket implements WeComSocketLike {
  isOpen = true
  readonly sent: Record<string, unknown>[] = []
  closed = false
  private openListener: (() => void) | undefined
  private messageListener: ((data: string) => void) | undefined
  private closeListener: (() => void) | undefined
  send(payload: string): void { this.sent.push(JSON.parse(payload) as Record<string, unknown>) }
  close(): void { this.closed = true; this.isOpen = false; this.closeListener?.() }
  terminate(): void { this.close() }
  onOpen(listener: () => void): void { this.openListener = listener }
  onMessage(listener: (data: string) => void): void { this.messageListener = listener }
  onError(): void {}
  onClose(listener: () => void): void { this.closeListener = listener }
  fireOpen(): void { this.openListener?.() }
  fireMessage(frame: Record<string, unknown>): void { this.messageListener?.(JSON.stringify(frame)) }
}

const setup = () => {
  const socket = new FakeSocket()
  const provider = createWeComProvider(
    { kind: 'wecom', botId: 'bot', secret: 'secret' },
    () => {},
    { createSocket: () => socket },
  )
  return { socket, provider }
}

const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 5) })

describe('wecom provider', () => {
  it('subscribes on open and forwards text callbacks', async () => {
    const { socket, provider } = setup()
    const received: unknown[] = []
    const stop = await provider.start((message) => { received.push(message) })
    socket.fireOpen()
    await flush()
    expect(socket.sent[0]).toMatchObject({ cmd: 'aibot_subscribe' })
    const frame = socket.sent[0] as { headers: { req_id: string } }
    socket.fireMessage({ headers: { req_id: frame.headers.req_id }, errcode: 0 })
    await flush()
    socket.fireMessage({
      cmd: 'aibot_msg_callback',
      headers: { req_id: 'req-1' },
      body: { msgtype: 'text', chattype: 'single', from: { userid: 'u1' }, text: { content: 'hello' } },
    })
    await flush()
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ providerId: 'wecom', userId: 'u1', chatId: 'u1', text: 'hello', chatType: 'single' })
    await stop()
    expect(socket.closed).toBe(true)
  })

  it('replies through the passive reply command', async () => {
    const { socket, provider } = setup()
    const stop = await provider.start(() => {})
    socket.fireOpen()
    await flush()
    const sentBefore = socket.sent.length
    const accepted = provider.reply(
      { providerId: 'wecom', userId: 'u1', chatId: 'u1', chatType: 'single', text: 'hi', raw: { reqId: 'req-1', chatId: 'u1', chatType: 'single' } },
      'answer',
    )
    await flush()
    const replyFrame = socket.sent[sentBefore] as { cmd: string; headers: { req_id: string }; body: unknown }
    expect(replyFrame.cmd).toBe('aibot_respond_msg')
    expect(replyFrame.headers.req_id).toBe('req-1')
    socket.fireMessage({ headers: { req_id: 'req-1' }, errcode: 0 })
    await expect(accepted).resolves.toBe(true)
    await stop()
  })

  it('rejects non-text messages with a hint without calling the handler', async () => {
    const { socket, provider } = setup()
    const handler = vi.fn()
    const stop = await provider.start(handler)
    socket.fireOpen()
    await flush()
    socket.fireMessage({
      cmd: 'aibot_msg_callback',
      headers: { req_id: 'req-2' },
      body: { msgtype: 'image', chattype: 'single', from: { userid: 'u1' }, image: {} },
    })
    await flush()
    expect(handler).not.toHaveBeenCalled()
    const replyFrame = socket.sent.find(frame => frame.cmd === 'aibot_respond_msg')
    expect(replyFrame).toBeDefined()
    await stop()
  })

  it('requires botId and secret', () => {
    expect(() => createWeComProvider({ kind: 'wecom' }, () => {})).toThrow('botId and secret')
  })
})
