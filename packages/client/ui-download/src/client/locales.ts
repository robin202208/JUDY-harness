/** `download` namespace dictionaries: the composer's file-browser entry. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'download'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'entry.label': '下载文件',
  'entry.title': '查看并下载 AI 产出的文件',
  'entry.aria': '下载文件',
} satisfies Record<string, string>

/** Key domain of the `download` namespace. */
export type DownloadKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'entry.label': 'Download files',
  'entry.title': 'Browse and download files produced by the AI',
  'entry.aria': 'Download files',
} satisfies Record<DownloadKey, string>
