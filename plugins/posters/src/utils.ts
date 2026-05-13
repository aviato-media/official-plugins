import { extname } from 'path'

export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

const ARTWORK_TYPE_KEYWORDS = new Set(['poster', 'fanart', 'banner', 'thumb', 'landscape'])
const FOLDER_ARTWORK_NAMES = new Map([
  ['folder', 'cover'],
  ['cover', 'cover'],
])

export type ArtworkType = 'poster' | 'fanart' | 'banner' | 'thumb' | 'landscape' | 'cover'

export function getMediaStem (filename: string): string {
  const idx = filename.lastIndexOf('.')
  return idx === -1 ? filename : filename.substring(0, idx)
}

/**
 * Classify an image filename against a list of candidate media stems.
 * Returns the artwork type if the image matches any of these conventions:
 *   - exact keyword (poster.jpg, fanart.png, banner.webp, thumb.jpg, landscape.jpg)
 *   - folder artwork (folder.jpg → cover, cover.png → cover)
 *   - stem-prefixed (<media-stem>-poster.jpg, <media-stem>-fanart.jpg, ...)
 *   - stem-only (<media-stem>.jpg → poster)
 *
 * Returns null when nothing matches. The mediaStems list is the set of
 * primary media filenames (sans extension) for the bundle — folder artwork
 * matches without a stem so an empty list still yields cover.jpg matches.
 */
export function detectArtworkType (imageFilename: string, mediaStems: string[]): ArtworkType | null {
  const ext = extname(imageFilename).toLowerCase()
  if (!IMAGE_EXTENSIONS.has(ext)) {
    return null
  }

  const imageStem = getMediaStem(imageFilename)
  const imageStemLower = imageStem.toLowerCase()

  if (ARTWORK_TYPE_KEYWORDS.has(imageStemLower)) {
    return imageStemLower as ArtworkType
  }

  const folderType = FOLDER_ARTWORK_NAMES.get(imageStemLower)
  if (folderType) {
    return folderType as ArtworkType
  }

  for (const stem of mediaStems) {
    if (imageStem === stem) {
      return 'poster'
    }
    if (imageStem.startsWith(`${stem}-`)) {
      const suffix = imageStem.substring(stem.length + 1).toLowerCase()
      if (ARTWORK_TYPE_KEYWORDS.has(suffix)) {
        return suffix as ArtworkType
      }
    }
  }

  return null
}

export function mimeTypeForImage (extension: string): string {
  const ext = extension.toLowerCase()
  if (ext === '.png') {
    return 'image/png'
  }
  if (ext === '.webp') {
    return 'image/webp'
  }
  return 'image/jpeg'
}
