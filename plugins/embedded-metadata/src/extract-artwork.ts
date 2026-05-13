import type { BundleAsset, BundleMediaFile, PluginClient } from '@aviato-media/plugin-sdk'
import { join } from 'path'

export interface ExtractCoverArtOpts {
  client: PluginClient
  filePath: string
  outputDir: string
  itemId: string
  file: BundleMediaFile
  source: string
  timeout: number
}

export async function extractCoverArt (opts: ExtractCoverArtOpts): Promise<BundleAsset | undefined> {
  const baseName = opts.file.id ?? `${opts.itemId}-${opts.file.filename}`
  const outputPath = join(opts.outputDir, `${baseName}.cover.jpg`)

  const result = await opts.client.run('ffmpeg', [
    '-i', opts.filePath,
    '-map', '0:v', '-map', '-0:V',
    '-c', 'copy',
    '-f', 'image2',
    '-y', outputPath,
  ], {
    label: 'ffmpeg',
    timeout: opts.timeout,
  })

  if (result.exitCode !== 0) {
    throw new Error(`ffmpeg exited with code ${result.exitCode}: ${result.stderr}`)
  }

  // Cover is the item's poster, not a file-level asset. The server's
  // getAssetsForItems explicitly filters out rows with a fileId, so tagging
  // mediaFileId here would hide the cover from the item details page.
  return {
    type: 'poster',
    path: outputPath,
    source: opts.source,
    mimeType: 'image/jpeg',
  }
}
