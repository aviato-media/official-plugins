import type { Bundle } from '@aviato-media/plugin-sdk'
import { createPlugin } from '@aviato-media/plugin-sdk'
import { basename } from 'path'

import {
  formatForCodec,
  getSubtitleFormat,
  getVideoStem,
  matchSubtitleToMediaFile,
  type MediaFileStem,
  SUBTITLE_EXTENSIONS,
} from './utils.js'

type BundleSubtitle = NonNullable<Bundle['subtitles']>[number]

const PLUGIN_ID = 'aviato-external-subtitles'

export interface ProbePayload extends Record<string, unknown> {
  itemId: string
  bundle: Bundle
}

const { hooks } = createPlugin({})

/**
 * Walk the bundle for subtitles from two sources:
 *
 *   1. External sidecar files in `bundle.files.auxiliary` whose extension is
 *      .srt/.ass/.ssa/.vtt/.sub. Language is derived from the trailing
 *      filename segment (e.g. "movie.en.srt" → "en", "movie.ja.forced.ass"
 *      → "ja.forced"). Each subtitle is bound to the most specific media
 *      file stem so multi-file folders (TV episode packs, multi-cut movies)
 *      keep their associations correct.
 *
 *   2. Embedded subtitle streams already extracted by `__system:ffprobe`
 *      and stored on `mediaFile.fileInfo.subtitleStreams`. We don't shell
 *      out to ffprobe again — the system probe runs first and the results
 *      live on the bundle.
 *
 * Returns `null` when nothing was added so the hook dispatcher passes
 * through unchanged.
 */
export function processProbe (payload: ProbePayload): ProbePayload | null {
  const { itemId, bundle } = payload
  const mediaFiles = bundle.files?.media ?? []
  const auxFiles = bundle.files?.auxiliary ?? []

  const mediaStems: MediaFileStem[] = mediaFiles.map(mf => ({
    uri: mf.uri,
    stem: getVideoStem(mf.filename),
  }))

  const newSubtitles: BundleSubtitle[] = []

  for (const file of auxFiles) {
    const ext = file.extension.toLowerCase().startsWith('.')
      ? file.extension.toLowerCase()
      : `.${file.extension.toLowerCase()}`
    if (!SUBTITLE_EXTENSIONS.has(ext)) {
      continue
    }

    const filename = basename(file.path)
    const subBase = getVideoStem(filename)

    // Language hint: anything between the matched media stem and the
    // extension (e.g. "movie.en.forced.srt" → "en.forced"). Falls back to
    // "und" when no media file claims this subtitle stem.
    const matchedMediaUri = matchSubtitleToMediaFile(filename, mediaStems)
    let language = 'und'
    if (matchedMediaUri) {
      const matched = mediaStems.find(m => m.uri === matchedMediaUri)
      if (matched && subBase.startsWith(`${matched.stem}.`)) {
        language = subBase.substring(matched.stem.length + 1) || 'und'
      }
    } else {
      // No media stem matched — pull a single trailing segment as a hint.
      // Caps at 3 chars so we don't mistake a movie title fragment for a
      // language tag.
      const parts = subBase.split('.')
      const tail = parts[parts.length - 1]
      if (parts.length > 1 && tail.length <= 3) {
        language = tail
      }
    }

    newSubtitles.push({
      type: 'external',
      path: file.path,
      language,
      format: getSubtitleFormat(filename),
      source: PLUGIN_ID,
      ...(matchedMediaUri ? {
        mediaFileUri: matchedMediaUri,
      } : {}),
    })
  }

  for (const mf of mediaFiles) {
    const streams = mf.fileInfo?.subtitleStreams ?? []
    for (const stream of streams) {
      newSubtitles.push({
        type: 'embedded',
        language: stream.language ?? 'und',
        format: formatForCodec(stream.codec),
        streamIndex: stream.index,
        source: PLUGIN_ID,
        mediaFileUri: mf.uri,
      })
    }
  }

  if (newSubtitles.length === 0) {
    return null
  }

  // De-duplicate against any subtitles a prior hook contributed for the
  // same (mediaFileUri, type, streamIndex|path) so re-runs don't churn.
  const existing = bundle.subtitles ?? []
  const seen = new Set(existing.map(subtitleKey))
  const merged: BundleSubtitle[] = [...existing]
  for (const sub of newSubtitles) {
    const key = subtitleKey(sub)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    merged.push(sub)
  }

  if (merged.length === existing.length) {
    return null
  }

  return {
    itemId,
    bundle: {
      ...bundle,
      subtitles: merged,
    },
  }
}

function subtitleKey (sub: BundleSubtitle): string {
  return `${sub.type}|${sub.mediaFileUri ?? ''}|${sub.streamIndex ?? ''}|${sub.path ?? ''}|${sub.language ?? ''}|${sub.format}`
}

hooks.on('pipeline.probe.afterProcess', async (raw): Promise<Record<string, unknown> | null> => {
  return processProbe(raw as unknown as ProbePayload)
})
