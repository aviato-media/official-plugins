import { PDFParse } from 'pdf-parse'

import type { ExtractedCover, ParsedBookMetadata } from '../types.js'

export interface PdfParseResult {
  metadata: ParsedBookMetadata
  cover?: ExtractedCover
}

/**
 * Parse a PDF: read the Info dictionary for metadata and render page 1 as a
 * cover image via pdf-parse's getScreenshot. PDF metadata quality varies
 * wildly — many files have empty or auto-generated values like "Microsoft
 * Word", so callers should treat the returned fields as low-confidence.
 */
export async function parsePdf (buffer: Uint8Array): Promise<PdfParseResult> {
  const parser = new PDFParse({
    data: toArrayBuffer(buffer),
  })

  let metadata: ParsedBookMetadata = {}
  let cover: ExtractedCover | undefined

  try {
    const info = await parser.getInfo()
    metadata = mapInfo(info)

    try {
      const screenshot = await parser.getScreenshot({
        partial: [1],
        scale: 1,
      })
      const page = screenshot.pages[0]
      if (page?.data) {
        cover = {
          data: page.data,
          mimeType: 'image/png',
        }
      }
    } catch {
      // Cover render failed (e.g. encrypted PDF, corrupted page). The info
      // dict above may still be valid, so swallow and return what we have.
    }
  } finally {
    await parser.destroy()
  }

  return {
    metadata,
    cover,
  }
}

interface InfoLike {
  total?: number
  infoData?: {
    Title?: string
    Author?: string
    Subject?: string
    Keywords?: string
    CreationDate?: Date | string | null
  } | null
}

export function mapInfo (info: InfoLike): ParsedBookMetadata {
  const result: ParsedBookMetadata = {}
  const data = info.infoData ?? null

  if (data) {
    const title = trimOrUndef(data.Title)
    if (title) {
      result.title = title
    }
    const author = trimOrUndef(data.Author)
    if (author) {
      result.author = author
    }
    const subject = trimOrUndef(data.Subject)
    if (subject) {
      result.description = subject
    }
    const keywords = trimOrUndef(data.Keywords)
    if (keywords) {
      const first = keywords.split(/[,;]/)[0]?.trim()
      if (first) {
        result.genre = first
      }
    }
    const year = parseDateYear(data.CreationDate)
    if (year !== undefined) {
      result.year = year
    }
  }

  if (typeof info.total === 'number' && info.total > 0) {
    result.pageCount = info.total
  }

  return result
}

function trimOrUndef (value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed || undefined
}

/**
 * pdf-parse parses PDF dates into a Date object. Older raw `D:YYYYMMDD…`
 * strings may slip through with malformed input — handle both.
 */
function parseDateYear (date: Date | string | null | undefined): number | undefined {
  if (!date) {
    return undefined
  }
  if (date instanceof Date) {
    const year = date.getFullYear()
    return Number.isFinite(year) ? year : undefined
  }
  const match = String(date).replace(/^D:/, '').match(/(\d{4})/)
  if (!match) {
    return undefined
  }
  const n = Number(match[1])
  return Number.isFinite(n) ? n : undefined
}

function toArrayBuffer (buffer: Uint8Array): ArrayBuffer {
  if (buffer.byteOffset === 0 && buffer.byteLength === buffer.buffer.byteLength) {
    return buffer.buffer as ArrayBuffer
  }
  const copy = new Uint8Array(buffer.byteLength)
  copy.set(buffer)
  return copy.buffer
}
