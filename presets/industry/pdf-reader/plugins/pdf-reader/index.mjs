'use strict'
// Static agent-plane plugin: registers the `read_pdf` tool.
// Pure ESM that imports only Node builtins (plus the sibling extractor), so it
// resolves from any preset directory regardless of node_modules location.

import { extractText } from './extract.mjs'

const MAX_PDF_BYTES = 100 * 1024 * 1024

export default {
  name: 'pdf-reader',
  inject: ['tools', 'fs'],
  apply(ctx) {
    ctx.tools.register({
      name: 'read_pdf',
      description:
        '提取 PDF 文件的文字内容。传入文件路径（工作区或服务器上的绝对/相对路径），返回纯文本、页数和是否截断。适合阅读 PDF 论文、文档、报告等。',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'PDF 文件的路径（绝对路径，或相对工作区的相对路径）。',
          },
          max_chars: {
            type: 'number',
            description: '返回文本的最大字符数，默认 80000，超出部分截断。',
          },
        },
        required: ['file_path'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            pages: { type: 'number' },
            charCount: { type: 'number' },
            truncated: { type: 'boolean' },
            text: { type: 'string' },
          },
          required: ['text'],
        },
        render(_args, value) {
          const text = value && typeof value.text === 'string' ? value.text : ''
          const note = value && value.truncated ? '[已截断]\n' : ''
          return [{ type: 'text', text: note + text }]
        },
      },
      async execute(args, exec) {
        if (!args || typeof args.file_path !== 'string' || !args.file_path.trim()) {
          throw new Error('缺少 file_path 参数')
        }
        const signal = exec && exec.signal
        const target = await ctx.fs.resolve(args.file_path.trim())
        const info = await ctx.fs.stat(target, signal)
        if (!info) throw new Error('文件不存在: ' + args.file_path)
        const bytes = await ctx.fs.readBytes(target, signal, MAX_PDF_BYTES)
        const r = extractText(bytes)
        const maxChars =
          typeof args.max_chars === 'number' && args.max_chars > 0
            ? Math.floor(args.max_chars)
            : 80000
        let text = r.text
        let truncated = r.truncated
        if (text.length > maxChars) {
          text = text.slice(0, maxChars)
          truncated = true
        }
        return { path: args.file_path, pages: r.pages, charCount: text.length, truncated, text }
      },
    })
  },
}
