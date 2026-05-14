import type { Bundle, BundleAsset, BundleMetadata, PluginClient } from '@aviato-media/plugin-sdk'
import { createPlugin } from '@aviato-media/plugin-sdk'
import { pluginTmpDir } from '@aviato-media/plugin-sdk/tmpdir'
import { mkdir } from 'fs/promises'

import { extractCoverArt } from './extract-artwork.js'
import type { ProbeOutput } from './probe.js'
import { detectCoverArtStream, parseProbeOutput, runFfprobe } from './probe.js'

const PLUGIN_ID = '@aviato-media/embedded-metadata'
const DEFAULT_FFPROBE_TIMEOUT = 15_000
const DEFAULT_FFMPEG_TIMEOUT = 30_000

// Mirrors the server's PROBEABLE_EXTENSIONS in libraries/ingestion/probe.ts.
const PROBEABLE = new Set([
  'mkv', 'mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', 'ts', 'm2ts', 'vob', 'ogv', '3gp',
  'mp3', 'flac', 'aac', 'ogg', 'opus', 'wav', 'wma', 'm4a', 'm4b', 'alac', 'ape', 'dsf', 'dff', 'wv',
])

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
  ffprobeTimeout?: number
  ffmpegTimeout?: number
  extractArtwork?: boolean
  /** Override the PluginClient (used for testing). */
  client?: PluginClient
}

const { client, hooks } = createPlugin({})

/**
 * Walk the bundle's media files, run ffprobe on each container, and merge
 * extracted tags, canonical IDs, and embedded cover art into the bundle.
 * Returns `null` if no probeable file was touched — the hook dispatcher
 * passes through unchanged in that case.
 */
export async function processProbe (
  payload: ProbePayload,
  opts: ProcessOptions = {},
): Promise<ProbePayload | null> {
  const { itemId, bundle } = payload
  const mediaFiles = bundle.files?.media ?? []
  const coverDir = opts.coverDir ?? await pluginTmpDir(PLUGIN_ID)
  const ffprobeTimeout = opts.ffprobeTimeout ?? DEFAULT_FFPROBE_TIMEOUT
  const ffmpegTimeout = opts.ffmpegTimeout ?? DEFAULT_FFMPEG_TIMEOUT
  const shouldExtractArtwork = opts.extractArtwork !== false
  const pc = opts.client ?? client

  const mergedMetadata: Record<string, unknown> = {}
  const mergedIds: Record<string, { id: string }> = {}
  const newAssets: BundleAsset[] = []
  let touched = false

  for (const file of mediaFiles) {
    const ext = normalizeExt(file.extension)
    if (!PROBEABLE.has(ext)) {
      continue
    }
    const localPath = file.localPath ?? file.path
    if (!localPath) {
      continue
    }

    let probeOutput: ProbeOutput
    try {
      probeOutput = await runFfprobe(pc, localPath, ffprobeTimeout)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`[${PLUGIN_ID}] ${file.filename}: ffprobe failed: ${msg}\n`)
      continue
    }

    touched = true
    const parsed = parseProbeOutput(probeOutput)

    if (parsed.title && mergedMetadata.title === undefined) {
      mergedMetadata.title = parsed.title
    }
    if (parsed.year && mergedMetadata.year === undefined) {
      mergedMetadata.year = parsed.year
    }

    const formatDuration = probeOutput.format?.duration
    if (formatDuration && mergedMetadata.duration === undefined) {
      const duration = parseFloat(formatDuration)
      if (!Number.isNaN(duration)) {
        mergedMetadata.duration = duration
      }
    }

    if (parsed.genres && parsed.genres.length > 0 && mergedMetadata.genres === undefined) {
      mergedMetadata.genres = parsed.genres
    }

    for (const cid of parsed.canonicalIds) {
      if (!mergedIds[cid.provider]) {
        mergedIds[cid.provider] = {
          id: cid.id,
        }
      }
    }

    for (const [key, value] of Object.entries(parsed.fields)) {
      if (mergedMetadata[key] === undefined) {
        mergedMetadata[key] = value
      }
    }

    if (shouldExtractArtwork && probeOutput.streams) {
      const coverStream = detectCoverArtStream(probeOutput.streams)
      if (coverStream) {
        try {
          await mkdir(coverDir, {
            recursive: true,
          })
          const asset = await extractCoverArt({
            client: pc,
            filePath: localPath,
            outputDir: coverDir,
            itemId,
            file,
            source: PLUGIN_ID,
            timeout: ffmpegTimeout,
          })
          if (asset) {
            newAssets.push(asset)
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          process.stderr.write(`[${PLUGIN_ID}] ${file.filename}: cover extraction failed: ${msg}\n`)
        }
      }
    }
  }

  if (!touched) {
    return null
  }

  const updatedBundle: Bundle = {
    ...bundle,
    metadata: {
      ...bundle.metadata,
      ...(mergedMetadata as BundleMetadata),
    },
  }

  if (Object.keys(mergedIds).length > 0) {
    updatedBundle.ids = {
      ...bundle.ids,
      ...mergedIds,
    }
  }

  if (newAssets.length > 0) {
    updatedBundle.assets = [...(bundle.assets ?? []), ...newAssets]
  }

  return {
    itemId,
    bundle: updatedBundle,
  }
}

hooks.on('pipeline.probe.afterProcess', async (raw): Promise<Record<string, unknown> | null> => {
  return processProbe(raw as unknown as ProbePayload)
})
