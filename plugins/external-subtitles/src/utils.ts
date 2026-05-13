import { extname } from 'path'

export const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt', '.ass', '.ssa', '.sub'])

export function getVideoStem (filename: string): string {
  const dotIndex = filename.lastIndexOf('.')
  return dotIndex > 0 ? filename.substring(0, dotIndex) : filename
}

/**
 * Derive a language tag from the subtitle filename relative to its media stem.
 * "movie.en.srt" against stem "movie" → "en".
 * "movie.ja.forced.ass" → "ja.forced" (preserves modifier suffixes).
 * Returns "und" when the subtitle filename doesn't carry any language hint.
 */
export function detectLanguage (subtitleFilename: string, videoStem: string): string {
  const subBase = getVideoStem(subtitleFilename)
  if (subBase === videoStem) {
    return 'und'
  }
  if (subBase.startsWith(`${videoStem}.`)) {
    const suffix = subBase.substring(videoStem.length + 1)
    return suffix || 'und'
  }
  return 'und'
}

export function getSubtitleFormat (filename: string): string {
  const ext = extname(filename).toLowerCase()
  switch (ext) {
    case '.srt': return 'srt'
    case '.vtt': return 'vtt'
    case '.ass': return 'ass'
    case '.ssa': return 'ssa'
    case '.sub': return 'sub'
    default: return 'srt'
  }
}

export interface MediaFileStem {
  uri: string
  stem: string
}

/**
 * Match a subtitle filename to one of the bundle's media files by stem.
 * Sorted longest-first so a sidecar named "Movie - Director's Cut.en.srt"
 * binds to the director's cut rather than collapsing to "Movie".
 */
export function matchSubtitleToMediaFile (
  subtitleFilename: string,
  mediaFiles: MediaFileStem[],
): string | undefined {
  const subBase = getVideoStem(subtitleFilename)
  const sorted = [...mediaFiles].sort((a, b) => b.stem.length - a.stem.length)
  for (const mf of sorted) {
    if (subBase === mf.stem) {
      return mf.uri
    }
    if (subBase.startsWith(`${mf.stem}.`)) {
      return mf.uri
    }
  }
  return undefined
}

/**
 * ffprobe codec → BundleSubtitle.format. Image-based subtitle codecs
 * (PGS, DVD) are kept as their raw codec name so downstream consumers
 * can decide whether they're playable.
 */
export function formatForCodec (codec: string): string {
  switch (codec.toLowerCase()) {
    case 'subrip': return 'srt'
    case 'ass': return 'ass'
    case 'ssa': return 'ass'
    case 'webvtt': return 'vtt'
    case 'mov_text': return 'mov_text'
    case 'hdmv_pgs_subtitle': return 'pgs'
    case 'dvd_subtitle': return 'dvd_subtitle'
    default: return codec.toLowerCase()
  }
}
