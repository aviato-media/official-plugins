import type { Bundle, BundleAsset } from '@aviato-media/plugin-sdk'
import { createPlugin } from '@aviato-media/plugin-sdk'
import { pluginTmpDir } from '@aviato-media/plugin-sdk/tmpdir'
import { stat } from 'fs/promises'
import { join } from 'path'

import {
  buildAudioArgs,
  buildImageArgs,
  buildTimestampCandidates,
  buildVideoArgs,
  detectVideoRotation,
  frameQuality,
  isAudio,
  isFrameDegenerate,
  isImage,
  isVideo,
  parseFrameStats,
  runFfmpeg,
} from './ffmpeg'

const PLUGIN_ID = '@aviato-media/thumbnails'

const { client, hooks } = createPlugin({})

interface ProbeProcessPayload {
  itemId: string
  bundle: Bundle
}

hooks.on('pipeline.probe.afterProcess', async (raw): Promise<Record<string, unknown> | null> => {
  const payload = raw as unknown as ProbeProcessPayload
  const { bundle, itemId } = payload

  // pluginTmpDir already mkdirs recursively + caches the resolved path.
  const outputDir = await pluginTmpDir(PLUGIN_ID)

  const resultAssets: BundleAsset[] = []
  const failedFiles: string[] = []

  for (const mediaFile of bundle.files.media) {
    const fileLocalPath = mediaFile.localPath
    if (!fileLocalPath) {
      continue
    }

    const extension = mediaFile.extension.toLowerCase()
    if (!isVideo(extension) && !isImage(extension) && !isAudio(extension)) {
      continue
    }

    const outputName = mediaFile.id
      ? `${mediaFile.id}.jpg`
      : `${itemId}-${mediaFile.filename}.jpg`
    const outputPath = join(outputDir, outputName)

    let success = false

    if (isVideo(extension)) {
      const duration = (mediaFile.fileInfo as Record<string, unknown> | undefined)?.duration as number | undefined
      const rotation = await detectVideoRotation(client, fileLocalPath)
      const candidates = buildTimestampCandidates(duration)

      // Walk candidate timestamps and accept the first non-degenerate frame.
      // Black frames are common around fades, scene cuts, and the openings of
      // many films; solid-color / low-variance frames show up in slate cards,
      // dark transitions, and blocky encoder artifacts. Shifting the seek
      // position usually finds something usable.
      //
      // analyze:true inlines signalstats into the same ffmpeg invocation so
      // the per-frame stats arrive on stdout without a second probe call.
      let bestTimestamp: string | null = null
      let bestQuality = -1
      for (const ts of candidates) {
        const result = await runFfmpeg(client, buildVideoArgs(fileLocalPath, outputPath, ts, {
          rotation,
          analyze: true,
        }))
        if (!result.ok) {
          continue
        }
        const stats = parseFrameStats(result.stdout)
        if (stats === null) {
          // signalstats output missing — accept the frame rather than
          // rejecting a possibly-fine thumbnail because of a parse miss.
          success = true
          break
        }
        if (!isFrameDegenerate(stats)) {
          success = true
          break
        }
        const quality = frameQuality(stats)
        if (quality > bestQuality) {
          bestQuality = quality
          bestTimestamp = ts
        }
      }

      // Every candidate was degenerate — re-render the highest-quality one so
      // the output file holds the best available frame, not whatever the last
      // loop iteration happened to leave on disk.
      if (!success && bestTimestamp !== null) {
        const result = await runFfmpeg(client, buildVideoArgs(fileLocalPath, outputPath, bestTimestamp, { rotation }))
        success = result.ok
      }

      // Seek-past-EOF fallback: a lying duration can make every candidate
      // fail to render. Retry at a fixed early offset before giving up.
      if (!success) {
        const result = await runFfmpeg(client, buildVideoArgs(fileLocalPath, outputPath, '00:00:01', { rotation }))
        success = result.ok
      }
    } else if (isImage(extension)) {
      const result = await runFfmpeg(client, buildImageArgs(fileLocalPath, outputPath))
      success = result.ok
    } else {
      // Audio: -map 0:v? exits 0 even when no embedded cover exists, leaving an
      // empty/missing output. Confirm a real image was written before claiming
      // success — and treat absent art as a silent skip, not a failure.
      const result = await runFfmpeg(client, buildAudioArgs(fileLocalPath, outputPath))
      if (result.ok) {
        const size = await stat(outputPath).then((s) => s.size).catch(() => 0)
        if (size > 0) {
          success = true
        }
      }
      if (!success) {
        continue
      }
    }

    if (success) {
      resultAssets.push({
        type: 'thumbnail',
        path: outputPath,
        source: PLUGIN_ID,
        mimeType: 'image/jpeg',
        mediaFileId: mediaFile.id,
      })
    } else {
      failedFiles.push(mediaFile.filename)
    }
  }

  if (resultAssets.length === 0 && failedFiles.length > 0) {
    process.stderr.write(
      `[aviato-thumbnails] Failed to generate thumbnails for ${itemId}: ${failedFiles.join(', ')}\n`,
    )
    return null
  }

  const existingAssets = bundle.assets ?? []
  return {
    ...payload,
    bundle: {
      ...bundle,
      assets: [...existingAssets, ...resultAssets],
    },
  }
})
