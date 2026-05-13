// Intentional copy of packages/server/src/libraries/ingestion/filename-parsers/tv.ts.
// Duplicated because plugins run in isolated processes and cannot import from
// the server. The path-derived series-name extraction here is not replicable
// by simple regex stripping; clean-tv-search-query.test.ts depends on it.
// Drop this file once @aviato-media/plugin-sdk re-publishes parseTvFilename.

export interface ParsedEpisode {
  seriesName: string
  season: number
  episode: number
  episodeEnd?: number
  title?: string
  year?: number
  resolution?: string
  source?: string
  codec?: string
}

const RESOLUTIONS = ['2160p', '4k', '1080p', '720p', '480p', '360p']
const SOURCES = ['bluray', 'bdrip', 'brrip', 'webrip', 'web-dl', 'webdl', 'hdtv', 'dvdrip', 'remux']
const CODECS = ['x264', 'x265', 'h264', 'h265', 'hevc', 'avc', 'xvid', 'av1', 'vp9']

// Common TV episode patterns ordered by specificity
const EPISODE_PATTERNS = [
  // S01E02 or S01E02E03 (multi-episode)
  /^(.+?)[\s._-]+S(\d{1,2})E(\d{1,3})(?:[-E](\d{1,3}))?/i,
  // 1x02
  /^(.+?)[\s._-]+(\d{1,2})x(\d{1,3})/i,
  // Season 1 Episode 2
  /^(.+?)[\s._-]+Season\s*(\d{1,2})[\s._-]+Episode\s*(\d{1,3})/i,
  // s01.e02
  /^(.+?)[\s._-]+s(\d{1,2})[\s._-]*e(\d{1,3})/i,
]

// Path-based patterns: /Series Name/Season 01/episode.mkv or /Series Name/S01/episode.mkv
const PATH_SEASON_PATTERN = /[/\\](?:Season\s*|S)(\d{1,2})[/\\]/i
const PATH_SERIES_PATTERN = /[/\\]([^/\\]+)[/\\](?:Season\s*|S)\d/i

/**
 * Parse a TV show episode from filename and optionally full path.
 * Returns null if the file doesn't look like a TV episode.
 */
export function parseTvFilename (filename: string, filePath?: string): ParsedEpisode | null {
  // Remove extension
  const name = filename.replace(/\.[^.]+$/, '')

  // Try each episode pattern against the filename
  for (const pattern of EPISODE_PATTERNS) {
    const match = name.match(pattern)
    if (match) {
      const seriesRaw = match[1]
      const season = parseInt(match[2], 10)
      const episode = parseInt(match[3], 10)
      const episodeEnd = match[4] ? parseInt(match[4], 10) : undefined

      return buildResult(seriesRaw, season, episode, episodeEnd, name, filename)
    }
  }

  // Try path-based detection
  if (filePath) {
    const seasonMatch = filePath.match(PATH_SEASON_PATTERN)
    const seriesMatch = filePath.match(PATH_SERIES_PATTERN)

    if (seasonMatch && seriesMatch) {
      const season = parseInt(seasonMatch[1], 10)
      // Try S##E## in filename first (handles "S01E01.mkv" without show name prefix)
      const sxeMatch = name.match(/S\d{1,2}E(\d{1,3})(?:[-E](\d{1,3}))?/i)
      if (sxeMatch) {
        const episode = parseInt(sxeMatch[1], 10)
        const episodeEnd = sxeMatch[2] ? parseInt(sxeMatch[2], 10) : undefined
        return buildResult(seriesMatch[1], season, episode, episodeEnd, name, filename)
      }
      // Try bare episode number or E-prefix: "01.mp4", "E01.mp4", "Episode 1.mp4",
      // "Show - 01.mp4" (anime-style)
      const epMatch = name.match(/(?:^|[\s._-])(?:E|Episode[\s._-]*)(\d{1,3})(?:[\s._-]|$)/i)
        ?? name.match(/(?:^|[\s._-])(\d{1,3})$/)
        ?? name.match(/^(\d{1,3})$/)
      if (epMatch) {
        const episode = parseInt(epMatch[1], 10)
        return buildResult(seriesMatch[1], season, episode, undefined, name, filename)
      }
    }
  }

  return null
}

function buildResult (
  seriesRaw: string,
  season: number,
  episode: number,
  episodeEnd: number | undefined,
  name: string,
  filename: string,
): ParsedEpisode {
  // Clean series name
  const seriesName = seriesRaw
    .replace(/^\[.*?\]\s*/, '') // strip leading release group tags like [YTS.MX]
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Extract year from series name
  let year: number | undefined
  const yearMatch = seriesName.match(/\s*\(?((?:19|20)\d{2})\)?$/)
  if (yearMatch) {
    year = parseInt(yearMatch[1], 10)
  }
  const cleanSeries = seriesName.replace(/\s*\(?((?:19|20)\d{2})\)?$/, '').trim()

  // Extract quality info
  const lowerFilename = filename.toLowerCase()
  const resolution = RESOLUTIONS.find(r => lowerFilename.includes(r))
  const source = SOURCES.find(s => lowerFilename.includes(s))
  const codec = CODECS.find(c => lowerFilename.includes(c))

  // Try to extract episode title (text after episode number, before quality indicators)
  let title: string | undefined
  const afterEp = name.match(/E\d{1,3}(?:[-E]\d{1,3})?\s*[-._\s]+(.+)/i)
  if (afterEp) {
    let epTitle = afterEp[1]
    // Remove quality indicators
    for (const indicator of [...RESOLUTIONS, ...SOURCES, ...CODECS]) {
      const idx = epTitle.toLowerCase().indexOf(indicator)
      if (idx >= 0) {
        epTitle = epTitle.substring(0, idx)
      }
    }
    epTitle = epTitle.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim()
    if (epTitle.length > 0) {
      title = epTitle
    }
  }

  return {
    seriesName: cleanSeries,
    season,
    episode,
    episodeEnd,
    title,
    year,
    resolution,
    source,
    codec,
  }
}
