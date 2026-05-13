import type { Bundle, BundleAsset, BundleChapter, BundleMediaFile } from '@aviato-media/plugin-sdk'
import { createPlugin } from '@aviato-media/plugin-sdk'
import { pluginTmpDir } from '@aviato-media/plugin-sdk/tmpdir'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

import { parseDocx } from './parsers/docx.js'
import { parseEpub } from './parsers/epub.js'
import { parsePdf } from './parsers/pdf.js'
import type { ExtractedChapter, ExtractedCover, ParsedBookMetadata } from './types.js'

const PLUGIN_ID = 'aviato-metadata-books'
const SUPPORTED = new Set(['epub', 'pdf', 'docx'])

/**
 * Normalize a file extension to a bare lowercase form (no leading dot).
 * The bundle builder copies `LibraryFile.extension` straight through, and the
 * server stores it without a dot — so plugin code must accept either form.
 */
function normalizeExt (raw: string): string {
  return raw.toLowerCase().replace(/^\./, '')
}

export interface ProbePayload extends Record<string, unknown> {
  itemId: string
  bundle: Bundle
}

export interface ProcessOptions {
  /** Directory for persisted cover images. Override in tests. */
  coverDir?: string
}

/**
 * Walk the bundle's media files, parse each supported ebook, and return an
 * updated payload merging the extracted metadata, ISBN, and cover assets into
 * the bundle. Returns `null` if no supported file was found — the hook
 * dispatcher passes through unchanged in that case.
 */
export async function processProbe (
  payload: ProbePayload,
  opts: ProcessOptions = {},
): Promise<ProbePayload | null> {
  const { itemId, bundle } = payload
  const mediaFiles = bundle.files?.media ?? []
  const coverDir = opts.coverDir ?? await pluginTmpDir(PLUGIN_ID)

  let mergedFields: ParsedBookMetadata = {}
  let isbn: string | undefined
  const newAssets: BundleAsset[] = []
  const newChapters: BundleChapter[] = []
  let touched = false

  for (const file of mediaFiles) {
    const ext = normalizeExt(file.extension)
    if (!SUPPORTED.has(ext)) {
      continue
    }
    const localPath = file.localPath ?? file.path
    if (!localPath) {
      continue
    }

    try {
      const buffer = await readBuffer(localPath)
      const parsed = await dispatchParser(ext, buffer)
      touched = true

      // Companion files (e.g. a PDF alongside an audiobook) only contribute
      // a file-level thumbnail — their embedded metadata, ISBN, and chapters
      // would override the primary file's data.
      const isCompanion = file.type === 'companion'

      if (!isCompanion) {
        mergedFields = mergeFields(mergedFields, parsed.metadata)
        const parsedIsbn = parsed.metadata.isbn
        if (parsedIsbn && !isbn) {
          isbn = parsedIsbn
        }
      }

      if (parsed.cover) {
        const asset = await persistCover(coverDir, itemId, file, parsed.cover)
        if (asset) {
          newAssets.push(asset)
        }
      }

      if (!isCompanion && parsed.chapters && parsed.chapters.length > 0) {
        newChapters.push(...toBundleChapters(file, parsed.chapters))
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`[${PLUGIN_ID}] ${file.filename}: ${msg}\n`)
    }
  }

  if (!touched) {
    return null
  }

  const bundleMetadata = toBundleMetadata(mergedFields)
  const updatedBundle: Bundle = {
    ...bundle,
    metadata: {
      ...bundle.metadata,
      ...bundleMetadata,
    },
  }

  if (isbn) {
    updatedBundle.ids = {
      ...bundle.ids,
      isbn: {
        id: isbn,
      },
    }
  }

  if (newAssets.length > 0) {
    updatedBundle.assets = [...(bundle.assets ?? []), ...newAssets]
  }

  if (newChapters.length > 0) {
    updatedBundle.chapters = [...(bundle.chapters ?? []), ...newChapters]
  }

  return {
    itemId,
    bundle: updatedBundle,
  }
}

function toBundleChapters (
  file: BundleMediaFile,
  chapters: ExtractedChapter[],
): BundleChapter[] {
  const sorted = [...chapters].sort((a, b) => a.startPage - b.startPage)
  return sorted.map((ch, i) => {
    const next = sorted[i + 1]
    return {
      mediaFileUri: file.uri,
      mediaFileId: file.id,
      startTime: ch.startPage,
      endTime: next ? next.startPage : null,
      title: ch.title,
      role: 'chapter',
      metadata: ch.href ? {
        href: ch.href,
      } : null,
    }
  })
}

const { hooks } = createPlugin({})

hooks.on('pipeline.probe.afterProcess', async (raw): Promise<Record<string, unknown> | null> => {
  return processProbe(raw as unknown as ProbePayload)
})

async function dispatchParser (
  extension: string,
  buffer: Uint8Array,
): Promise<{ metadata: ParsedBookMetadata,
  cover?: ExtractedCover,
  chapters?: ExtractedChapter[] }> {
  switch (normalizeExt(extension)) {
    case 'epub':
      return parseEpub(buffer)
    case 'pdf':
      return parsePdf(buffer)
    case 'docx':
      return parseDocx(buffer)
    default:
      return {
        metadata: {},
      }
  }
}

async function readBuffer (path: string): Promise<Uint8Array> {
  const file = Bun.file(path)
  return new Uint8Array(await file.arrayBuffer())
}

/**
 * Last-non-empty value wins per field. EPUB tends to be richest, but we don't
 * encode a per-format preference here — files are processed in the order the
 * bundler returns them, and the orchestrator's confidence model handles
 * cross-plugin precedence.
 */
function mergeFields (a: ParsedBookMetadata, b: ParsedBookMetadata): ParsedBookMetadata {
  const out: ParsedBookMetadata = {
    ...a,
  }
  for (const [key, value] of Object.entries(b) as Array<[keyof ParsedBookMetadata, unknown]>) {
    if (value !== undefined && value !== '' && value !== null) {
      ;(out[key] as unknown) = value
    }
  }
  return out
}

/**
 * Drop ISBN before serializing to bundle.metadata — it lives under bundle.ids
 * instead and would otherwise leak into the library item's display fields.
 */
function toBundleMetadata (fields: ParsedBookMetadata): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'isbn') {
      continue
    }
    if (value !== undefined && value !== '' && value !== null) {
      out[key] = value
    }
  }
  return out
}

async function persistCover (
  coverDir: string,
  itemId: string,
  file: BundleMediaFile,
  cover: ExtractedCover,
): Promise<BundleAsset | undefined> {
  await mkdir(coverDir, {
    recursive: true,
  })
  const ext = mimeToExt(cover.mimeType)
  const baseName = file.id ?? `${itemId}-${file.filename}`
  const outPath = join(coverDir, `${baseName}.cover.${ext}`)
  await writeFile(outPath, cover.data)

  // Companions (e.g. a PDF accompanying an audiobook) emit a file-level
  // thumbnail so the Extras row can show it without overriding the item's
  // primary poster. Primary files emit an item-level poster — the server
  // filters file-scoped rows out of getAssetsForItems, so a `mediaFileId`
  // here would hide the cover from the item details page.
  if (file.type === 'companion') {
    return {
      type: 'thumbnail',
      path: outPath,
      source: PLUGIN_ID,
      mimeType: cover.mimeType,
      mediaFileId: file.id,
    }
  }

  return {
    type: 'poster',
    path: outPath,
    source: PLUGIN_ID,
    mimeType: cover.mimeType,
  }
}

function mimeToExt (mimeType: string): string {
  switch (mimeType) {
    case 'image/png':
      return 'png'
    case 'image/gif':
      return 'gif'
    case 'image/webp':
      return 'webp'
    default:
      return 'jpg'
  }
}
