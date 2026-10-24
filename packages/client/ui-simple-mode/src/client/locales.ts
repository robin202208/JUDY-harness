/** `simple-mode` namespace dictionaries: the composer's simple/advanced toggle. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'simple-mode'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'toggle.showAdvanced': '显示高级选项',
  'toggle.hideAdvanced': '隐藏高级选项',
  'toggle.title.simple': '显示模型、权限等高级选项',
  'toggle.title.advanced': '隐藏高级选项，界面更干净',
} satisfies Record<string, string>

/** Key domain of the `simple-mode` namespace. */
export type SimpleModeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'toggle.showAdvanced': 'Show advanced options',
  'toggle.hideAdvanced': 'Hide advanced options',
  'toggle.title.simple': 'Show advanced options such as model and permissions',
  'toggle.title.advanced': 'Hide advanced options for a cleaner interface',
} satisfies Record<SimpleModeKey, string>
