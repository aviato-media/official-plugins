import type { Bundle, BundleAsset } from '@aviato-media/plugin-sdk'
import { createPlugin } from '@aviato-media/plugin-sdk'
import { pluginTmpDir } from '@aviato-media/plugin-sdk/tmpdir'
import { stat } from 'fs/promises'
import { join } from 'path'

import {
  buildAudioArgs,
  buildImageArgs,
  buildVideoArgs,
  calculateTimestamp,
  detectVideoRotation,
  isAudio,
  isImage,
  isVideo,
  runFfmpeg,
} from './ffmpeg'

const PLUGIN_ID = 'aviato-thumbnails'

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
      const timestamp = calculateTimestamp(duration)
      const rotation = await detectVideoRotation(client, fileLocalPath)
      success = await runFfmpeg(client, buildVideoArgs(fileLocalPath, outputPath, timestamp, { rotation }))

      if (!success) {
        success = await runFfmpeg(client, buildVideoArgs(fileLocalPath, outputPath, '00:00:01', { rotation }))
      }
    } else if (isImage(extension)) {
      success = await runFfmpeg(client, buildImageArgs(fileLocalPath, outputPath))
    } else {
      // Audio: -map 0:v? exits 0 even when no embedded cover exists, leaving an
      // empty/missing output. Confirm a real image was written before claiming
      // success — and treat absent art as a silent skip, not a failure.
      const ran = await runFfmpeg(client, buildAudioArgs(fileLocalPath, outputPath))
      if (ran) {
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
        source: 'aviato-thumbnails',
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
