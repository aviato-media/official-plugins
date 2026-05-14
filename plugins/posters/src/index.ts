import type { Bundle, BundleAsset } from '@aviato-media/plugin-sdk'
import { createPlugin } from '@aviato-media/plugin-sdk'
import { basename } from 'path'

import { detectArtworkType, getMediaStem, mimeTypeForImage } from './utils.js'

const PLUGIN_ID = '@aviato-media/posters'

export interface ProbePayload extends Record<string, unknown> {
  itemId: string
  bundle: Bundle
}

const { hooks } = createPlugin({})

/**
 * Walk the bundle's auxiliary files for image sidecars (poster.jpg,
 * fanart.png, <stem>-poster.jpg, folder.jpg, ...) and emit each as a
 * `BundleAsset`. One asset per detected artwork type — duplicates within
 * the same type are skipped so the unique (item, type, source) index in
 * the assets table doesn't trip when a folder has both poster.jpg and
 * <stem>-poster.jpg.
 *
 * Returns `null` when nothing matches so the hook dispatcher passes
 * through unchanged.
 */
export function processProbe (payload: ProbePayload): ProbePayload | null {
  const { itemId, bundle } = payload
  const auxFiles = bundle.files?.auxiliary ?? []
  const mediaFiles = bundle.files?.media ?? []
  const mediaStems = mediaFiles.map(f => getMediaStem(f.filename))

  const existingTypes = new Set(
    (bundle.assets ?? []).map(a => a.type),
  )

  const newAssets: BundleAsset[] = []
  const claimedTypes = new Set<string>()

  for (const file of auxFiles) {
    const filename = basename(file.path)
    const type = detectArtworkType(filename, mediaStems)
    if (!type) {
      continue
    }
    // Earlier hooks (or this loop) may have already supplied an asset of
    // this type — skip so we don't churn the assets row or trip the
    // unique index for the same (item, type, source).
    if (existingTypes.has(type) || claimedTypes.has(type)) {
      continue
    }
    claimedTypes.add(type)

    newAssets.push({
      type,
      path: file.path,
      source: PLUGIN_ID,
      mimeType: mimeTypeForImage(file.extension),
    })
  }

  if (newAssets.length === 0) {
    return null
  }

  const updatedBundle: Bundle = {
    ...bundle,
    assets: [...(bundle.assets ?? []), ...newAssets],
  }

  return {
    itemId,
    bundle: updatedBundle,
  }
}

hooks.on('pipeline.probe.afterProcess', async (raw): Promise<Record<string, unknown> | null> => {
  return processProbe(raw as unknown as ProbePayload)
})
