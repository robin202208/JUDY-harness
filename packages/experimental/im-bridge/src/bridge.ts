/** One Agent Session per IM conversation, one FIFO queue per conversation. */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, AgentOptions } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { ProviderConfig } from './config.ts'
import type { ImInbound, ImProvider } from './providers/types.ts'

const POLL_MS = 300
const SETTLE_RETRY_MS = 700

/** Bridge options for one provider instance. */
export interface ChatBridgeOptions {
  /** Provider configuration (allowlist, session target, timeouts). */
  readonly config: ProviderConfig
  /** Bridge-scoped logger. */
  readonly log: (message: string) => void
}

/** Plain text of one assistant message. */
function messageText(message: Message): string {
  return message.content
    .map(block => block.type === 'text' ? block.text : '')
    .filter(text => text !== '')
    .join('\n')
    .trim()
}

/** Last assistant text currently visible in the session log. */
function lastAssistantText(session: Session): string {
  const messages = session.deriveMessages()
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message !== undefined && message.role === 'assistant') {
      const text = messageText(message)
      if (text !== '') return text
    }
  }
  return ''
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

/**
 * Owns the chat → Session mapping for one provider instance: queues messages
 * per conversation, creates or resumes the Agent, runs one turn, and replies.
 */
export class ChatBridge {
  private readonly queues = new Map<string, Promise<void>>()
  private readonly handles = new Map<string, AgentHandle>()
  private readonly aliases = new Map<string, SessionId>()
  private stopped = false

  constructor(
    private readonly ctx: Context,
    private readonly provider: ImProvider,
    private readonly options: ChatBridgeOptions,
  ) {}

  /** Route one inbound message through its conversation queue. */
  handle(inbound: ImInbound): void {
    const allowed = (this.options.config.allowedUsers ?? [])
      .map(user => user.trim().toLowerCase())
      .filter(Boolean)
    if (allowed.length > 0 && !allowed.includes(inbound.userId.trim().toLowerCase())) {
      this.options.log(`ignoring sender outside allowlist (${inbound.userId})`)
      return
    }
    const chatKey = `${inbound.chatType}:${inbound.chatId}`
    const previous = this.queues.get(chatKey) ?? Promise.resolve()
    const next = previous
      .then(() => this.process(inbound, chatKey))
      .catch((error: unknown) => { this.options.log(`queued turn failed: ${error instanceof Error ? error.message : String(error)}`) })
    this.queues.set(chatKey, next)
    void next.finally(() => { if (this.queues.get(chatKey) === next) this.queues.delete(chatKey) })
  }

  /** Dispose live Agent handles; the owning plugin calls this on unload. */
  async dispose(): Promise<void> {
    this.stopped = true
    const handles = [...this.handles.values()]
    this.handles.clear()
    for (const handle of handles) {
      try {
        await handle.dispose()
      } catch (error) {
        this.options.log(`agent dispose failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  private async process(inbound: ImInbound, chatKey: string): Promise<void> {
    if (this.stopped) return
    const text = inbound.text.trim()
    if (text === '') {
      await this.reply(inbound, '目前只支持文本消息。')
      return
    }
    try {
      const agent = await this.ensureAgent(chatKey)
      const answer = await this.runTurn(agent, text)
      await this.reply(inbound, answer === '' ? '（本轮没有产生文本回复）' : answer)
    } catch (error) {
      this.options.log(`turn failed: ${error instanceof Error ? error.message : String(error)}`)
      await this.reply(inbound, `⚠️ 处理失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async reply(inbound: ImInbound, text: string): Promise<void> {
    const limit = this.options.config.maxMessageLength ?? 4000
    const body = text.length > limit ? `${text.slice(0, Math.max(0, limit - 20))}\n\n…(内容过长已截断)` : text
    try {
      const accepted = await this.provider.reply(inbound, body)
      if (!accepted) this.options.log('provider rejected the reply')
    } catch (error) {
      this.options.log(`reply failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private sessionIdFor(chatKey: string): SessionId {
    const existing = this.aliases.get(chatKey)
    if (existing !== undefined) return existing
    const digest = createHash('sha1').update(chatKey).digest('hex').slice(0, 12)
    const kind = this.provider.kind
    const instance = this.provider.id.replaceAll(/[^a-zA-Z0-9_-]/gu, '-')
    return brandString<SessionId>(`im-${kind}-${instance}-${digest}`)
  }

  private agentOptions(): AgentOptions | undefined {
    const config = this.options.config
    if (config.provider !== undefined && config.provider !== '' && config.model !== undefined && config.model !== '') {
      return { provider: config.provider, model: config.model }
    }
    try {
      const selection = this.ctx.agentDefaultModel.currentSelection()
      return {
        provider: selection.provider,
        model: selection.model,
        ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
      }
    } catch (error) {
      this.options.log(`default model lookup failed: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  private setup(): ((agentCtx: Context) => Promise<void>) | undefined {
    const preset = this.options.config.preset ?? ''
    if (preset === '') return undefined
    return async (agentCtx) => { await this.ctx.agentPresets.mount(agentCtx, preset) }
  }

  private async ensureAgent(chatKey: string): Promise<Agent> {
    const sessionId = this.sessionIdFor(chatKey)
    const live = this.ctx.agents.get(sessionId)
    if (live !== undefined) return live
    const agentOptions = this.agentOptions()
    const setup = this.setup()
    const config = this.options.config
    const meta = {
      ...(config.workspace !== undefined && config.workspace !== '' ? { cwd: config.workspace } : {}),
      ...(config.preset !== undefined && config.preset !== '' ? { agentPreset: config.preset } : {}),
    }
    const options = { ...agentOptions === undefined ? {} : { agentOptions }, ...setup === undefined ? {} : { setup } }
    try {
      const handle = await this.ctx.agents.create({ sessionId, meta, ...options })
      this.handles.set(sessionId, handle)
      return handle.agent
    } catch (error) {
      if (!/already exists/iu.test(String(error instanceof Error ? error.message : error))) throw error
      try {
        const handle = await this.ctx.agents.resume({ resumeSessionId: sessionId, ...options })
        this.handles.set(sessionId, handle)
        return handle.agent
      } catch (resumeError) {
        this.options.log(`resume rejected the stored log, starting a fresh session: ${String(resumeError)}`)
        const freshId = brandString<SessionId>(`${sessionId}-${Date.now().toString(36).slice(-4)}`)
        this.aliases.set(chatKey, freshId)
        const handle = await this.ctx.agents.create({ sessionId: freshId, meta, ...options })
        this.handles.set(freshId, handle)
        return handle.agent
      }
    }
  }

  private async runTurn(agent: Agent, text: string): Promise<string> {
    const session = agent.session
    const baseline = session.seq
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    const deadline = Date.now() + (this.options.config.turnTimeoutMs ?? 240000)
    let observed = false
    while (Date.now() < deadline) {
      await sleep(POLL_MS)
      if (session.seq > baseline || agent.status === 'running') observed = true
      if (observed && agent.status === 'idle') {
        const answer = lastAssistantText(session)
        if (answer !== '') return answer
        await sleep(SETTLE_RETRY_MS)
        const retry = lastAssistantText(session)
        if (retry !== '') return retry
        this.options.log('turn settled without assistant text')
        return ''
      }
    }
    throw new Error(`agent turn did not settle within ${String(Math.round((this.options.config.turnTimeoutMs ?? 240000) / 1000))}s`)
  }
}
