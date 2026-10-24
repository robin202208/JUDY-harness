/** Provider contract shared by the WeCom, DingTalk and Feishu adapters. */

/** The chat platforms this bridge ships adapters for. */
export type ImProviderKind = 'wecom' | 'dingtalk' | 'feishu'

/** One inbound chat message normalised by a provider adapter. */
export interface ImInbound {
  /** Stable provider instance id from the bridge configuration. */
  readonly providerId: string
  /** Platform user id of the sender. */
  readonly userId: string
  /** Conversation id: a group chat id, or the peer user id in a direct chat. */
  readonly chatId: string
  /** Direct chat or group chat. */
  readonly chatType: 'single' | 'group'
  /** Plain text of the message; adapters replace non-text content with a placeholder. */
  readonly text: string
  /** Provider-owned reply context (reply token, request id, message id). */
  readonly raw: unknown
}

/** One connected chat platform adapter. */
export interface ImProvider {
  readonly kind: ImProviderKind
  /** Instance id from configuration, used to keep sessions apart. */
  readonly id: string
  /**
   * Connect and deliver each inbound chat message through `onMessage`.
   * @param onMessage - receives one normalised message per callback.
   * @returns an idempotent teardown for the connection.
   */
  start(onMessage: (message: ImInbound) => void): Promise<() => Promise<void>>
  /**
   * Reply to the conversation that produced `inbound`.
   * @param inbound - the message that opened the turn, carrying reply context.
   * @param text - markdown/text body, already truncated by the bridge.
   * @returns whether the platform accepted the reply.
   */
  reply(inbound: ImInbound, text: string): Promise<boolean>
}
