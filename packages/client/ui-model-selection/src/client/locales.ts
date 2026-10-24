/**
 * `model` namespace dictionaries.
 *
 * `trigger.selectAria` intentionally matches `trigger.fallback` but remains a
 * separate key: the visible fallback label and the accessible name of
 * an unset trigger are free to diverge per locale, and folding it into
 * `trigger.aria` would announce the degenerate "Select model, current Select
 * model".
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'provider.account': 'DeepSeek 账号',
  'command.label': '模型',
  'command.description': '选择本会话使用的模型',
  'option.loadError': '目录加载失败：{message}',
  'trigger.fallback': '请选择模型',
  'trigger.loading': '正在加载模型…',
  'trigger.selectAria': '请选择模型',
  'trigger.aria': '选择模型，当前 {model}',
  'trigger.ariaEffort': '选择模型，当前 {model}，推理等级 {effort}',
  'menu.aria': '模型与推理等级',
  'menu.model': '模型',
  'menu.effort': '推理等级',
  'effort.providerDefault': 'Default',
  'status.loading': '正在刷新模型列表…',
  'error.action': '模型操作失败：{message}',
  'error.sessionInUse': '当前会话已被占用，可能是其他正在运行的 DSH 导致的（如其他 dsh web、桌面端），请退出其他正在运行的 DSH 后重试。',
  'action.reload': '重新加载',
  'warning.groupLoad': '{name} 加载失败：{message}',
  'search.placeholder': '搜索模型…',
  'search.clear': '清除搜索',
  'search.empty': '没有匹配的模型。',
  'empty.models': '暂无可用模型',
  'empty.efforts': '当前模型未提供推理等级。',
  'friendly.sessionNotFound': '这个会话已经不存在了（可能被删除）。点左上角「新会话」重新开始。',
  'friendly.auth': '模型服务认证失败。请联系管理员检查密钥配置。',
  'friendly.credential': '模型密钥没配置好。请联系管理员。',
  'friendly.transport': '和服务器的连接断了，正在自动重连。如果一直这样，刷新一下页面。',
  'friendly.timeout': '这次请求超时了。可以把任务拆小一点再试，或者直接重试。',
  'friendly.rateLimit': '请求太频繁了，等几秒再试。',
  'friendly.context': '这次的内容超出模型能处理的上限了。可以让我分段处理。',
  'friendly.permission': '没有权限访问某个文件或目录。换个位置再试。',
} satisfies Record<string, string>

/** The model namespace key union. */
export type ModelKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'provider.account': 'DeepSeek Account',
  'command.label': 'Model',
  'command.description': 'Select the model for this conversation',
  'option.loadError': 'Catalog failed to load: {message}',
  'trigger.fallback': 'Select model',
  'trigger.loading': 'Loading models…',
  'trigger.selectAria': 'Select model',
  'trigger.aria': 'Select model, current {model}',
  'trigger.ariaEffort': 'Select model, current {model}, reasoning effort {effort}',
  'menu.aria': 'Model and reasoning effort',
  'menu.model': 'Model',
  'menu.effort': 'Effort',
  'effort.providerDefault': 'Default',
  'status.loading': 'Refreshing model list…',
  'error.action': 'Model operation failed: {message}',
  'error.sessionInUse': 'This session is already in use, possibly by another running DSH instance (such as dsh web or the desktop app). Quit other running DSH instances and try again.',
  'action.reload': 'Reload',
  'warning.groupLoad': '{name} failed to load: {message}',
  'search.placeholder': 'Search models…',
  'search.clear': 'Clear search',
  'search.empty': 'No matching models.',
  'empty.models': 'No models available.',
  'empty.efforts': 'This model provides no reasoning effort levels.',
  'friendly.sessionNotFound': 'This session no longer exists (it may have been deleted). Start a new session from the top left.',
  'friendly.auth': 'Model service authentication failed. Ask an administrator to check the key configuration.',
  'friendly.credential': 'The model key is not configured. Ask an administrator.',
  'friendly.transport': 'The connection to the server dropped; reconnecting. If it persists, refresh the page.',
  'friendly.timeout': 'This request timed out. Break the task into smaller pieces, or retry.',
  'friendly.rateLimit': 'Too many requests. Wait a few seconds and retry.',
  'friendly.context': 'This content exceeds the model context limit. Ask for it to be split into parts.',
  'friendly.permission': 'No permission to access a file or directory. Try another location.',
} satisfies Record<ModelKey, string>
