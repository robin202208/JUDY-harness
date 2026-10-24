/** WeCom (企业微信) Smart Robot adapter over its WebSocket gateway. */

import WebSocket from 'ws'
import type { ProviderConfig } from '../config.ts'
import type { ImInbound, ImProvider } from './types.ts'

const WEBSOCKET_URL = 'wss://openws.work.weixin.qq.com'
const RECONNECT_BACKOFF_SECONDS = [2, 5, 10, 30, 60]
const HEARTBEAT_MS = 30_000
const STALE_MS = 90_000
const REPLY_TIMEOUT_MS = 20_000

/** Minimal socket surface the adapter needs; tests supply a fake. */
export interface WeComSocketLike {
  /** True while frames may be sent. */
  readonly isOpen: boolean
  send(payload: string): void
  close(): void
  terminate(): void
  onOpen(listener: () => void): void
  onMessage(listener: (data: string) => void): void
  onError(listener: (error: Error) => void): void
  onClose(listener: () => void): void
}

/** Socket construction seam for tests. */
export interface WeComDeps {
  createSocket(url: string): WeComSocketLike
}

/** Reply context stored on every inbound WeCom message. */
interface WeComReplyContext {
  readonly reqId: string
  readonly chatId: string
  readonly chatType: 'single' | 'group'
}

interface PendingRequest {
  resolve: (frame: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const errcodeOf = (frame: Record<string, unknown>): number => (typeof frame.errcode === 'number' ? frame.errcode : 0)
const errmsgOf = (frame: Record<string, unknown>): string => (typeof frame.errmsg === 'string' ? frame.errmsg : '')

/** Read a platform string field without stringifying arbitrary objects. */
const textOf = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '')

/** Wrap the `ws` package in the adapter's socket surface. */
const defaultSocket = (url: string): WeComSocketLike => {
  const socket = new WebSocket(url, { handshakeTimeout: 15_000 })
  return {
    get isOpen() { return socket.readyState === WebSocket.OPEN },
    send: (payload) => { socket.send(payload) },
    close: () => { socket.close() },
    terminate: () => { socket.terminate() },
    onOpen: (listener) => { socket.on('open', listener) },
    onMessage: (listener) => {
      socket.on('message', (data) => {
        const raw = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data)
        listener(raw.toString('utf8'))
      })
    },
    onError: (listener) => { socket.on('error', listener) },
    onClose: (listener) => { socket.on('close', listener) },
  }
}

/**
 * Create the WeCom Smart Robot adapter.
 * @param config - one provider instance from the bundle configuration.
 * @param log - bridge logger.
 * @param deps - socket construction seam; defaults to the `ws` client.
 * @returns the adapter; throws when credentials are missing.
 */
export function createWeComProvider(
  config: ProviderConfig,
  log: (message: string) => void,
  deps: WeComDeps = { createSocket: defaultSocket },
): ImProvider {
  const botId = (config.botId ?? '').trim()
  const secret = (config.secret ?? '').trim()
  if (botId === '' || secret === '') throw new Error('wecom provider requires botId and secret')
  const id = (config.id ?? '').trim() || 'wecom'

  let socket: WeComSocketLike | undefined
  let stopped = false
  let backoffIndex = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let lastFrameAt = Date.now()
  let onMessage: ((message: ImInbound) => void) | undefined
  const pending = new Map<string, PendingRequest>()

  const newReqId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`

  const sendFrame = (frame: unknown): void => {
    if (socket === undefined || !socket.isOpen) throw new Error('wecom websocket not open')
    socket.send(JSON.stringify(frame))
  }

  const failPending = (error: Error): void => {
    for (const [reqId, entry] of pending) {
      clearTimeout(entry.timer)
      entry.reject(error)
      pending.delete(reqId)
    }
  }

  const request = (cmd: string, reqId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(reqId)
        reject(new Error(`wecom ${cmd} timed out`))
      }, REPLY_TIMEOUT_MS)
      pending.set(reqId, { resolve, reject, timer })
      try {
        sendFrame({ cmd, headers: { req_id: reqId }, body })
      } catch (error) {
        clearTimeout(timer)
        pending.delete(reqId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })

  const scheduleReconnect = (): void => {
    if (stopped) return
    const delay = RECONNECT_BACKOFF_SECONDS[Math.min(backoffIndex, RECONNECT_BACKOFF_SECONDS.length - 1)] ?? 60
    backoffIndex += 1
    log(`wecom reconnect in ${String(delay)}s`)
    reconnectTimer = setTimeout(connect, delay * 1000)
  }

  const startHeartbeat = (): void => {
    clearInterval(heartbeatTimer)
    heartbeatTimer = setInterval(() => {
      if (Date.now() - lastFrameAt > STALE_MS) {
        log('wecom connection stale; forcing reconnect')
        try {
          socket?.terminate()
        } catch { /* already closing */ }
        return
      }
      try {
        sendFrame({ cmd: 'ping', headers: { req_id: newReqId('ping') }, body: {} })
      } catch (error) {
        log(`wecom heartbeat failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }, HEARTBEAT_MS)
  }

  const reply = async (inbound: ImInbound, text: string): Promise<boolean> => {
    const context = inbound.raw as WeComReplyContext
    const body = { msgtype: 'markdown', markdown: { content: text } }
    try {
      const ack = await request('aibot_respond_msg', context.reqId, body)
      if (errcodeOf(ack) === 0) return true
      log(`wecom passive reply rejected ${String(errcodeOf(ack))} ${errmsgOf(ack)}`)
    } catch (error) {
      log(`wecom passive reply failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (context.chatType === 'group') return false
    try {
      const ack = await request('aibot_send_msg', newReqId('send'), { chatid: context.chatId, ...body })
      return errcodeOf(ack) === 0
    } catch (error) {
      log(`wecom proactive send failed: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  const handleCallback = async (payload: Record<string, unknown>): Promise<void> => {
    const body = (payload.body ?? {}) as Record<string, unknown>
    const headers = (payload.headers ?? {}) as Record<string, unknown>
    const reqId = textOf(headers.req_id) || textOf(payload.req_id)
    const msgtype = textOf(body.msgtype)
    const from = body.from as { userid?: unknown } | undefined
    const userId = textOf(from?.userid)
    const chattype = textOf(body.chattype) === 'group' ? 'group' : 'single'
    const chatId = chattype === 'group' ? textOf(body.chatid) : userId
    if (userId === '' && chatId === '') {
      log('wecom callback without sender')
      return
    }
    const text = body.text as { content?: unknown } | undefined
    const nativeText = typeof text?.content === 'string' ? text.content.trim() : ''
    const inbound: ImInbound = {
      providerId: id,
      userId,
      chatId,
      chatType: chattype,
      text: nativeText !== '' ? nativeText : `[${msgtype} 消息]`,
      raw: { reqId, chatId, chatType: chattype },
    }
    if (msgtype !== 'text') {
      await reply(inbound, `目前只支持文本消息（收到的是 ${msgtype}）。`)
      return
    }
    onMessage?.(inbound)
  }

  const onFrame = (data: string): void => {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(data) as Record<string, unknown>
    } catch {
      return
    }
    lastFrameAt = Date.now()
    const headers = (payload.headers ?? {}) as Record<string, unknown>
    const reqId = textOf(headers.req_id) || textOf(payload.req_id)
    const cmd = typeof payload.cmd === 'string' ? payload.cmd : ''
    if (cmd === 'ping' || reqId === 'ping') return
    const entry = pending.get(reqId)
    if (entry !== undefined) {
      pending.delete(reqId)
      clearTimeout(entry.timer)
      entry.resolve(payload)
      return
    }
    if (cmd === 'aibot_msg_callback' || cmd === 'aibot_callback') {
      handleCallback(payload).catch((error: unknown) => { log(`wecom callback failed: ${String(error)}`) })
      return
    }
    if (cmd === '' || cmd === 'aibot_event_callback') return
    log(`wecom unhandled frame ${cmd}`)
  }

  const connect = (): void => {
    if (stopped) return
    const current = deps.createSocket(WEBSOCKET_URL)
    socket = current
    current.onOpen(() => {
      void (async () => {
        try {
          const ack = await request('aibot_subscribe', newReqId('subscribe'), {
            bot_id: botId,
            secret,
            device_id: `judy-im-${Math.random().toString(16).slice(2, 10)}`,
          })
          if (errcodeOf(ack) !== 0) {
            log(`wecom subscribe failed ${String(errcodeOf(ack))} ${errmsgOf(ack)}`)
            return
          }
          backoffIndex = 0
          startHeartbeat()
          log('wecom subscribed')
        } catch (error) {
          log(`wecom subscribe error: ${error instanceof Error ? error.message : String(error)}`)
        }
      })()
    })
    current.onMessage(onFrame)
    current.onError((error) => { log(`wecom websocket error: ${error.message}`) })
    current.onClose(() => {
      clearInterval(heartbeatTimer)
      failPending(new Error('wecom websocket closed'))
      if (socket === current) socket = undefined
      scheduleReconnect()
    })
  }

  return {
    kind: 'wecom',
    id,
    start(handler) {
      onMessage = handler
      connect()
      const dispose = (): Promise<void> => {
        stopped = true
        clearTimeout(reconnectTimer)
        clearInterval(heartbeatTimer)
        failPending(new Error('wecom bridge unloading'))
        try {
          socket?.close()
        } catch { /* already closed */ }
        onMessage = undefined
        return Promise.resolve()
      }
      return Promise.resolve(dispose)
    },
    reply,
  }
}
