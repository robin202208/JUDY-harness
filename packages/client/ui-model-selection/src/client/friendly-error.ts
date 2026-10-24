/**
 * Friendly wording for model and operation failures.
 *
 * The Host reports precise, machine-shaped errors; those strings are useful in
 * logs and useless in a toast. This maps the few shapes a person can act on and
 * leaves every other message untouched.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelKey } from './locales.ts'

/** Ordered patterns; the first match wins. */
const RULES: readonly (readonly [RegExp, ModelKey])[] = [
  [/session-not-found|session ".*" not found/i, 'friendly.sessionNotFound'],
  [/api key invalid|invalid api key|\b401\b|unauthorized/i, 'friendly.auth'],
  [/missing[_-]credential/i, 'friendly.credential'],
  [/transport failure|transport error|connection lost|websocket/i, 'friendly.transport'],
  [/timeout|timed out|超时/i, 'friendly.timeout'],
  [/rate limit|too many requests|\b429\b|限流/i, 'friendly.rateLimit'],
  [/context length|token limit|maximum context/i, 'friendly.context'],
  [/permission denied|EACCES/i, 'friendly.permission'],
]

/**
 * Translate a raw error message into wording a non-technical user can act on.
 * @param t - the model namespace translator.
 * @param message - raw Host or transport message.
 * @returns friendly wording, or the original message when no rule matches.
 */
export function friendlyError(t: TranslateNS<'model'>, message: string): string {
  for (const [pattern, key] of RULES) {
    if (pattern.test(message)) return t(key)
  }
  return message
}
