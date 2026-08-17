'use strict'
// In-process PDF text extractor for the static preset plugin. Pure ESM that
// imports only Node builtins, so it resolves from any preset directory.

import { inflateSync } from 'node:zlib'

const MAX_CHARS = 300000

function fail(msg) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(msg) }))
  process.exit(0)
}

function decodeBase64(s) {
  let t = String(s)
  const m = /^data:[^,]*;?base64,/.exec(t)
  if (m) t = t.slice(m[0].length)
  t = t.replace(/[^A-Za-z0-9+/=]/g, '')
  return Buffer.from(t, 'base64')
}

// ---------------------------------------------------------------------------
// Encodings
// ---------------------------------------------------------------------------
// CP1252 (WinAnsi) high bytes 0x80..0x9F. \u0000 marks an undefined slot.
const WIN_SPECIAL = [
  '\u20AC', '\u0000', '\u201A', '\u0192', '\u201E', '\u2026', '\u2020', '\u2021',
  '\u02C6', '\u2030', '\u0160', '\u2039', '\u0152', '\u0000', '\u017D', '\u0000',
  '\u0000', '\u2018', '\u2019', '\u201C', '\u201D', '\u2022', '\u2013', '\u2014',
  '\u02DC', '\u2122', '\u0161', '\u203A', '\u0153', '\u0000', '\u017E', '\u0178',
]
function latin1High() {
  let s = ''
  for (let b = 0xA0; b <= 0xFF; b++) s += String.fromCharCode(b)
  return s
}
const WINANSI_HIGH = WIN_SPECIAL.join('') + latin1High()
// Approximations for other single-byte encodings (rare in text PDFs; embedded
// fonts usually carry a ToUnicode CMap which takes priority).
const STANDARD_HIGH = WINANSI_HIGH
const MACROMAN_HIGH = WINANSI_HIGH
const SYMBOL_HIGH = '\u0000'.repeat(128)
const ZAPF_HIGH = '\u0000'.repeat(128)

function simpleChar(b, encoding) {
  if (b < 0x80) {
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) return ''
    return String.fromCharCode(b)
  }
  const idx = b - 0x80
  const enc = (encoding || 'WinAnsiEncoding').toLowerCase()
  let table = WINANSI_HIGH
  if (enc === 'standardencoding') table = STANDARD_HIGH
  else if (enc === 'macromanencoding') table = MACROMAN_HIGH
  else if (enc === 'symbol') table = SYMBOL_HIGH
  else if (enc === 'zapfdingbats') table = ZAPF_HIGH
  return table.charAt(idx) || ''
}

// ---------------------------------------------------------------------------
// Small byte helpers
// ---------------------------------------------------------------------------
function hexToBytes(hex) {
  const clean = String(hex).replace(/[^0-9a-fA-F]/g, '')
  const buf = Buffer.alloc(Math.ceil(clean.length / 2))
  for (let k = 0; k < clean.length; k += 2) {
    buf[k / 2] = parseInt(clean.slice(k, k + 2).padEnd(2, '0'), 16)
  }
  return buf
}

function hexToUtf16(hex) {
  if (!hex) return ''
  const bytes = Buffer.from(hex, 'hex')
  let out = ''
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1])
  }
  return out
}

// Parse a ToUnicode CMap stream into Map<code, string>.
function parseToUnicode(buf) {
  const s = buf.toString('latin1')
  const map = new Map()
  let m
  const bfchar = /beginbfchar([\s\S]*?)endbfchar/g
  while ((m = bfchar.exec(s))) {
    const pairs = m[1].match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g) || []
    for (const p of pairs) {
      const pm = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/.exec(p)
      if (pm) map.set(parseInt(pm[1], 16), hexToUtf16(pm[2]))
    }
  }
  const bfrange = /beginbfrange([\s\S]*?)endbfrange/g
  while ((m = bfrange.exec(s))) {
    const rows = m[1].match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g) || []
    for (const r of rows) {
      const rm = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/.exec(r)
      if (!rm) continue
      const c1 = parseInt(rm[1], 16)
      const c2 = parseInt(rm[2], 16)
      const dst = rm[3]
      if (dst) {
        const dstBytes = Buffer.from(dst, 'hex')
        const dstStart = (dstBytes[0] << 8) | dstBytes[1]
        for (let c = c1; c <= c2; c++) map.set(c, String.fromCharCode(dstStart + (c - c1)))
      }
    }
  }
  return map
}

function decodeStringBytes(bytes, font) {
  if (!font) {
    return bytes.toString('latin1').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
  }
  const tu = font.toUnicode
  let out = ''
  if (font.isType0) {
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const code = (bytes[i] << 8) | bytes[i + 1]
      if (tu && tu.has(code)) out += tu.get(code)
      else out += String.fromCharCode(code)
    }
    if (bytes.length % 2 === 1) out += simpleChar(bytes[bytes.length - 1], font.encoding)
  } else {
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]
      if (tu && tu.has(b)) out += tu.get(b)
      else out += simpleChar(b, font.encoding)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// String / dict parsing
// ---------------------------------------------------------------------------
function readLiteral(s, i) {
  // s[i] === '('; returns { bytes, end }
  i++
  let depth = 1
  const bytes = []
  while (i < s.length && depth > 0) {
    const c = s[i]
    if (c === '\\') {
      const n = s[i + 1]
      if (n === 'n') { bytes.push(0x0a); i += 2 }
      else if (n === 'r') { bytes.push(0x0d); i += 2 }
      else if (n === 't') { bytes.push(0x09); i += 2 }
      else if (n === 'b') { bytes.push(0x08); i += 2 }
      else if (n === 'f') { bytes.push(0x0c); i += 2 }
      else if (n === '(' || n === ')' || n === '\\') { bytes.push(n.charCodeAt(0)); i += 2 }
      else if (n === '\n') { i += 2 }
      else if (n === '\r') { i += 2; if (s[i] === '\n') i++ }
      else if (/[0-7]/.test(n)) {
        let oct = ''
        let j = i + 1
        while (j < s.length && j < i + 4 && /[0-7]/.test(s[j])) { oct += s[j]; j++ }
        bytes.push(parseInt(oct, 8) & 0xff)
        i = j
      } else { bytes.push(n ? n.charCodeAt(0) : 0x5c); i += 2 }
    } else if (c === '(') { depth++; bytes.push(0x28); i++ }
    else if (c === ')') { depth--; if (depth > 0) bytes.push(0x29); i++ }
    else { bytes.push(c.charCodeAt(0)); i++ }
  }
  return { bytes: Buffer.from(bytes), end: i }
}

function matchDict(s, from) {
  const start = s.indexOf('<<', from)
  if (start < 0) return null
  let i = start + 2
  let depth = 1
  while (i < s.length) {
    const c = s[i]
    if (c === '(') { const r = readLiteral(s, i); i = r.end; continue }
    if (c === '<') {
      if (s[i + 1] === '<') { depth++; i += 2; continue }
      const j = s.indexOf('>', i + 1); i = j < 0 ? s.length : j + 1; continue
    }
    if (c === '>') {
      if (s[i + 1] === '>') { depth--; i += 2; if (depth === 0) return { str: s.slice(start + 2, i - 2), end: i }; continue }
      i++; continue
    }
    i++
  }
  return null
}

function parseDict(dictStr) {
  // dictStr is the content between << and >>.
  let i = 0
  function ws() { while (i < dictStr.length && /\s/.test(dictStr[i])) i++ }
  function readValue() {
    ws()
    if (i >= dictStr.length) return null
    const c = dictStr[i]
    if (c === '/') {
      let j = i + 1
      while (j < dictStr.length && !/[()<>[\]{}/%\s]/.test(dictStr[j])) j++
      const v = { t: 'name', v: dictStr.slice(i + 1, j) }
      i = j
      return v
    }
    if (c === '(') { const r = readLiteral(dictStr, i); i = r.end; return { t: 'str', v: r.bytes } }
    if (c === '<') {
      if (dictStr[i + 1] === '<') { i += 2; return { t: 'dict', v: readDictBody() } }
      const j = dictStr.indexOf('>', i + 1)
      const v = hexToBytes(dictStr.slice(i + 1, j < 0 ? dictStr.length : j))
      i = j < 0 ? dictStr.length : j + 1
      return { t: 'str', v }
    }
    if (c === '[') {
      i++
      const arr = []
      for (;;) {
        ws()
        if (i >= dictStr.length || dictStr[i] === ']') { if (dictStr[i] === ']') i++; break }
        const v = readValue()
        if (!v) break
        arr.push(v)
      }
      return { t: 'arr', v: arr }
    }
    const num = /^-?\d+(?:\.\d+)?/.exec(dictStr.slice(i))
    if (num) {
      i += num[0].length
      ws()
      const rrm = /^(\d+)\s+R\b/.exec(dictStr.slice(i))
      if (rrm) { i += rrm[0].length; return { t: 'ref', v: parseInt(num[0], 10) } }
      return { t: 'num', v: parseFloat(num[0]) }
    }
    const bare = /^[^\s()<>[\]{}/%]+/.exec(dictStr.slice(i))
    if (bare) { i += bare[0].length; return { t: 'bare', v: bare[0] } }
    return null
  }
  function readDictBody() {
    const sub = new Map()
    for (;;) {
      ws()
      if (i >= dictStr.length) break
      if (dictStr.startsWith('>>', i)) { i += 2; break }
      if (dictStr[i] === '/') {
        const key = readValue()
        const val = readValue()
        if (key && key.t === 'name' && val) sub.set(key.v, val)
      } else { i++ }
    }
    return sub
  }
  return readDictBody()
}

// ---------------------------------------------------------------------------
// Stream decoding
// ---------------------------------------------------------------------------
function decodeStream(streamBuf, dict) {
  const filterVal = dict.get('Filter')
  const filters = []
  if (filterVal) {
    if (filterVal.t === 'name') filters.push(filterVal.v)
    else if (filterVal.t === 'arr') for (const f of filterVal.v) if (f.t === 'name') filters.push(f.v)
  }
  let out = streamBuf
  for (const f of filters) out = decodeFilter(out, f)
  return out
}

function decodeFilter(buf, filterName) {
  const f = String(filterName).toLowerCase()
  if (f === 'flatedecode' || f === 'fl') {
    try { return inflateSync(buf) } catch (e) { return buf }
  }
  if (f === 'asciihexdecode' || f === 'ahx') {
    const hex = buf.toString('latin1').replace(/[^0-9a-fA-F]/g, '')
    return Buffer.from(hex.length % 2 ? hex + '0' : hex, 'hex')
  }
  if (f === 'ascii85decode' || f === 'a85') return ascii85(buf)
  if (f === 'runlengthdecode' || f === 'rl') return runLength(buf)
  if (f === 'lzwdecode' || f === 'lzw') return buf
  return buf
}

function ascii85(buf) {
  const s = buf.toString('latin1').replace(/\s/g, '')
  const out = []
  let i = 0
  while (i < s.length) {
    if (s[i] === '~') break
    if (s[i] === 'z') { out.push(0, 0, 0, 0); i++; continue }
    let group = s.slice(i, i + 5)
    i += group.length
    if (group.length < 5) {
      const pad = 5 - group.length
      group += 'u'.repeat(pad)
      let n = 0
      for (let k = 0; k < 5; k++) n = n * 85 + (group.charCodeAt(k) - 33)
      const bytes = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
      for (let k = 0; k < 4 - pad; k++) out.push(bytes[k])
      break
    }
    let n = 0
    for (let k = 0; k < 5; k++) n = n * 85 + (group.charCodeAt(k) - 33)
    out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255)
  }
  return Buffer.from(out)
}

function runLength(buf) {
  const out = []
  let i = 0
  while (i < buf.length) {
    const len = buf[i]
    i++
    if (len === 128) break
    if (len < 128) { for (let k = 0; k <= len && i < buf.length; k++) out.push(buf[i++]) }
    else { const b = buf[i++]; for (let k = 0; k < 257 - len; k++) out.push(b) }
  }
  return Buffer.from(out)
}

// ---------------------------------------------------------------------------
// Content stream tokenizer / text extraction
// ---------------------------------------------------------------------------
function readOneToken(s, i) {
  while (i < s.length && /\s/.test(s[i])) i++
  if (i >= s.length) return null
  const c = s[i]
  if (c === '/') {
    let j = i + 1
    while (j < s.length && !/[()<>[\]{}/%\s]/.test(s[j])) j++
    return { token: { t: 'name', v: s.slice(i + 1, j) }, end: j }
  }
  if (c === '(') { const r = readLiteral(s, i); return { token: { t: 'str', v: r.bytes }, end: r.end } }
  if (c === '<') {
    const j = s.indexOf('>', i + 1)
    return { token: { t: 'str', v: hexToBytes(s.slice(i + 1, j < 0 ? s.length : j)) }, end: j < 0 ? s.length : j + 1 }
  }
  const num = /^-?\d+(?:\.\d+)?/.exec(s.slice(i))
  if (num) return { token: { t: 'num', v: parseFloat(num[0]) }, end: i + num[0].length }
  const op = /^[^\s()<>[\]{}/%]+/.exec(s.slice(i))
  if (op) return { token: { t: 'op', v: op[0] }, end: i + op[0].length }
  return { token: null, end: i + 1 }
}

function tokenizeContent(s) {
  const out = []
  let i = 0
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++
    if (i >= s.length) break
    const c = s[i]
    if (c === '%') { const nl = s.indexOf('\n', i); i = nl < 0 ? s.length : nl + 1; continue }
    if (c === '/') {
      let j = i + 1
      while (j < s.length && !/[()<>[\]{}/%\s]/.test(s[j])) j++
      out.push({ t: 'name', v: s.slice(i + 1, j) }); i = j; continue
    }
    if (c === '(') { const r = readLiteral(s, i); out.push({ t: 'str', v: r.bytes }); i = r.end; continue }
    if (c === '<') {
      if (s[i + 1] === '<') { const j = s.indexOf('>>', i + 2); i = j < 0 ? s.length : j + 2; continue }
      const j = s.indexOf('>', i + 1)
      out.push({ t: 'str', v: hexToBytes(s.slice(i + 1, j < 0 ? s.length : j)) }); i = j < 0 ? s.length : j + 1; continue
    }
    if (c === '[') {
      i++
      const items = []
      for (;;) {
        while (i < s.length && /\s/.test(s[i])) i++
        if (i >= s.length) break
        if (s[i] === ']') { i++; break }
        const tk = readOneToken(s, i)
        if (!tk || !tk.token) { i = tk ? tk.end : i + 1; continue }
        items.push(tk.token); i = tk.end
      }
      out.push({ t: 'arr', items }); continue
    }
    if (c === ']' || c === '{' || c === '}') { i++; continue }
    const num = /^-?\d+(?:\.\d+)?/.exec(s.slice(i))
    if (num) { out.push({ t: 'num', v: parseFloat(num[0]) }); i += num[0].length; continue }
    const op = /^[^\s()<>[\]{}/%]+/.exec(s.slice(i))
    if (op) { out.push({ t: 'op', v: op[0] }); i += op[0].length; continue }
    i++
  }
  return out
}

function extractFromTokens(tokens, fontByName) {
  let out = ''
  let font = null
  let fontSize = 12
  let leading = 0
  let x = 0
  let y = 0
  let hasText = false
  let lastY = null

  function show(s) { out += s }
  function newline() {
    if (out.length && !out.endsWith('\n')) out += '\n'
  }
  function maybeBreak() {
    if (hasText && lastY !== null && Math.abs(y - lastY) > 0.5) newline()
  }

  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k]
    if (tk.t !== 'op') continue
    const op = tk.v
    if (op === 'BT') {
      x = 0; y = 0; leading = 0
    } else if (op === 'Tf') {
      const name = tokens[k - 2]
      const size = tokens[k - 1]
      if (name && name.t === 'name') font = (fontByName && fontByName[name.v]) || null
      if (size && size.t === 'num') fontSize = size.v
    } else if (op === 'TL') {
      const n = tokens[k - 1]
      if (n && n.t === 'num') leading = n.v
    } else if (op === 'Tm') {
      const a = tokens[k - 6], b = tokens[k - 5], c = tokens[k - 4], d = tokens[k - 3], e = tokens[k - 2], f = tokens[k - 1]
      if (a && b && c && d && e && f && a.t === 'num' && b.t === 'num' && c.t === 'num' && d.t === 'num' && e.t === 'num' && f.t === 'num') {
        x = e.v; y = f.v
      }
    } else if (op === 'Td' || op === 'TD') {
      const tx = tokens[k - 2], ty = tokens[k - 1]
      if (tx && ty && tx.t === 'num' && ty.t === 'num') {
        x += tx.v; y += ty.v
        if (op === 'TD') leading = -ty.v
      }
    } else if (op === 'T*') {
      y -= (leading || fontSize)
      newline()
    } else if (op === 'Tj') {
      const s = tokens[k - 1]
      if (s && s.t === 'str') {
        maybeBreak()
        show(decodeStringBytes(s.v, font))
        lastY = y; hasText = true
      }
    } else if (op === "'") {
      y -= (leading || fontSize)
      newline()
      const s = tokens[k - 1]
      if (s && s.t === 'str') {
        show(decodeStringBytes(s.v, font))
        lastY = y; hasText = true
      }
    } else if (op === '"') {
      y -= (leading || fontSize)
      newline()
      const s = tokens[k - 1]
      if (s && s.t === 'str') {
        show(decodeStringBytes(s.v, font))
        lastY = y; hasText = true
      }
    } else if (op === 'TJ') {
      const arr = tokens[k - 1]
      if (arr && arr.t === 'arr') {
        maybeBreak()
        for (const item of arr.items) {
          if (item.t === 'str') show(decodeStringBytes(item.v, font))
          else if (item.t === 'num' && item.v < -100) show(' ')
        }
        lastY = y; hasText = true
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Object scanning / page walk
// ---------------------------------------------------------------------------
function scanObjects(latin) {
  const offsets = new Map()
  const re = /(\d+)\s+(\d+)\s+obj\b/g
  let m
  while ((m = re.exec(latin))) {
    const num = parseInt(m[1], 10)
    if (!offsets.has(num)) offsets.set(num, m.index)
  }
  return offsets
}

function readObjectAt(latin, off) {
  const header = /^(\d+)\s+(\d+)\s+obj\b/.exec(latin.slice(off))
  if (!header) return null
  const bodyStart = off + header[0].length
  let bodyEnd = latin.indexOf('endobj', bodyStart)
  if (bodyEnd < 0) return null
  const sIdx = latin.indexOf('stream', bodyStart)
  if (sIdx >= 0 && sIdx < bodyEnd) {
    const eIdx = latin.indexOf('endstream', sIdx)
    if (eIdx >= 0) {
      const after = latin.indexOf('endobj', eIdx)
      if (after >= 0) bodyEnd = after
    }
  }
  const raw = latin.slice(bodyStart, bodyEnd)
  const dm = matchDict(raw, 0)
  let dict = new Map()
  let rest = raw
  if (dm) { dict = parseDict(dm.str); rest = raw.slice(dm.end) }
  let stream = null
  const sm = /stream(\r\n|\r|\n)/.exec(rest)
  if (sm) {
    const dataStart = sm.index + sm[0].length
    const esIdx = rest.indexOf('endstream', dataStart)
    if (esIdx >= 0) {
      let dataEnd = esIdx
      while (dataEnd > dataStart && (rest[dataEnd - 1] === '\n' || rest[dataEnd - 1] === '\r')) dataEnd--
      stream = Buffer.from(rest.slice(dataStart, dataEnd), 'latin1')
    }
  }
  return { dict, stream }
}

function collectPages(pagesRef, objects) {
  const pages = []
  const stack = [pagesRef]
  const seen = new Set()
  while (stack.length) {
    const r = stack.pop()
    if (!r || r.t !== 'ref') continue
    const num = r.v
    if (seen.has(num)) continue
    seen.add(num)
    const obj = objects.get(num)
    if (!obj) continue
    const d = obj.dict
    const type = d.get('Type')
    const typeName = type && type.t === 'name' ? type.v : null
    if (typeName === 'Page') { pages.push(obj); continue }
    const kids = d.get('Kids')
    if (kids && kids.t === 'arr') for (let x = kids.v.length - 1; x >= 0; x--) stack.push(kids.v[x])
    else if (!typeName) { const k2 = d.get('Kids'); if (k2 && k2.t === 'arr') for (let x = k2.v.length - 1; x >= 0; x--) stack.push(k2.v[x]) }
  }
  return pages
}

function resolveFonts(resourcesVal, objects) {
  const res = {}
  if (!resourcesVal || resourcesVal.t !== 'dict') return res
  const fontDict = resourcesVal.v.get('Font')
  if (!fontDict || fontDict.t !== 'dict') return res
  for (const [name, val] of fontDict.v) {
    if (val && val.t === 'ref') {
      const fobj = objects.get(val.v)
      if (fobj) res[name] = buildFontInfo(fobj, objects)
    }
  }
  return res
}

function buildFontInfo(fobj, objects) {
  const d = fobj.dict
  const subtype = d.get('Subtype')
  const isType0 = subtype && subtype.t === 'name' && subtype.v === 'Type0'
  let encoding = 'WinAnsiEncoding'
  const enc = d.get('Encoding')
  if (enc && enc.t === 'name') encoding = enc.v
  else if (enc && enc.t === 'dict') {
    const be = enc.v.get('BaseEncoding')
    if (be && be.t === 'name') encoding = be.v
  }
  let toUnicode = null
  const tu = d.get('ToUnicode')
  if (tu && tu.t === 'ref') {
    const tuObj = objects.get(tu.v)
    if (tuObj && tuObj.stream) toUnicode = parseToUnicode(decodeStream(tuObj.stream, tuObj.dict))
  }
  // Descendant font ToUnicode fallback for Type0 fonts.
  if (!toUnicode && isType0) {
    const desc = d.get('DescendantFonts')
    if (desc && desc.t === 'arr') {
      for (const dv of desc.v) {
        if (dv && dv.t === 'ref') {
          const dobj = objects.get(dv.v)
          if (dobj && dobj.dict) {
            const dtu = dobj.dict.get('ToUnicode')
            if (dtu && dtu.t === 'ref') {
              const tuObj2 = objects.get(dtu.v)
              if (tuObj2 && tuObj2.stream) { toUnicode = parseToUnicode(decodeStream(tuObj2.stream, tuObj2.dict)); break }
            }
          }
        }
      }
    }
  }
  const bf = d.get('BaseFont')
  const baseFont = bf && bf.t === 'name' ? bf.v : ''
  const lower = baseFont.toLowerCase()
  if (!toUnicode) {
    if (/symbol/.test(lower)) encoding = 'Symbol'
    else if (/zapf/.test(lower)) encoding = 'ZapfDingbats'
  }
  return { isType0, encoding, toUnicode, baseFont }
}

function extractPage(pageObj, objects) {
  const d = pageObj.dict
  const fontByName = resolveFonts(d.get('Resources'), objects)
  const contents = d.get('Contents')
  const streamObjs = []
  const collect = (v) => {
    if (!v) return
    if (v.t === 'ref') { const o = objects.get(v.v); if (o && o.stream) streamObjs.push(o) }
    else if (v.t === 'arr') for (const x of v.v) collect(x)
  }
  collect(contents)
  let text = ''
  for (const so of streamObjs) {
    const decoded = decodeStream(so.stream, so.dict)
    const tokens = tokenizeContent(decoded.toString('latin1'))
    text += extractFromTokens(tokens, fontByName)
  }
  return text
}

function cleanupText(t) {
  return t
    .replace(/\u0000/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replace(/[\u0080-\u009f]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function extractText(input) {
  const buf = Buffer.from(input)
  const latin = buf.toString('latin1')
  const objOffsets = scanObjects(latin)
  const objects = new Map()
  for (const [num, off] of objOffsets) {
    const parsed = readObjectAt(latin, off)
    if (parsed) objects.set(num, parsed)
  }
  let catalog = null
  for (const obj of objects.values()) {
    const d = obj.dict
    const t = d.get('Type')
    if (t && t.t === 'name' && t.v === 'Catalog') { catalog = obj; break }
  }
  if (!catalog) {
    for (const obj of objects.values()) {
      const p = obj.dict.get('Pages')
      if (p && p.t === 'ref') { catalog = obj; break }
    }
  }
  if (!catalog) throw new Error('PDF 目录(Catalog)未找到')
  const pages = collectPages(catalog.dict.get('Pages'), objects)
  if (!pages.length) throw new Error('未找到页面')
  const pageTexts = pages.map((p) => extractPage(p, objects))
  const joined = pageTexts.join('\n\n')
  const cleaned = cleanupText(joined)
  const truncated = cleaned.length > MAX_CHARS
  const text = truncated ? cleaned.slice(0, MAX_CHARS) : cleaned
  return { text, truncated, pages: pages.length, charCount: text.length }
}

export { extractText }
