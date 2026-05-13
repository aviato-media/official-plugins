import type {
  ArtworkCandidate,
  ArtworkReference,
  ArtworkSearchRequest,
  ArtworkSearchResult,
  DiscoveredFile,
  ExternalId,
  IndexRequest,
  IndexResult,
  MatchDetailRequest,
  SearchRequest,
  SearchResult,
} from '@aviato-media/plugin-sdk'
import { createPlugin, getBundleValue, getConfidentCanonicalIds, mergeConfidentFields } from '@aviato-media/plugin-sdk'
import { basename, extname } from 'path'

import { DEFAULT_TMDB_API_KEY } from './default-api-key.js'
import { buildMovieResult, searchMoviesInternal } from './movies.js'
import { parseTvFilename } from './parse-tv-filename.js'
import type { MediaType } from './tmdb.js'
import { fetchAllImages, fetchPerson, fetchSeasonDetails, resolveTmdbId as resolveTmdbIdFromApi, TmdbError, tmdbImageUrl } from './tmdb.js'
import { buildSeriesResult, fetchSeriesDetails, getSeriesLogo, searchSeriesInternal } from './tv.js'

// ── Config ─────────────────────────────────────────────

function parseJsonConfig (value: string | undefined): Record<string, unknown> {
  if (!value) {
    return {}
  }
  try {
    return JSON.parse(value) as Record<string, unknown>
  } catch {
    return {}
  }
}

const VIDEO_EXTENSIONS = new Set([
  '.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.m2ts',
])

// Patterns to strip from a TV search query when the title looks like a raw filename
const TV_EPISODE_STRIP = /[\s._-]+S\d{1,2}E\d{1,3}.*/i
const TV_SEASON_X_STRIP = /[\s._-]+\d{1,2}x\d{1,3}.*/i
const TV_SEASON_WORD_STRIP = /[\s._-]+Season\s*\d{1,2}.*/i
const QUALITY_INDICATORS = /[\s._-]+(?:2160p|4k|1080p|720p|480p|360p|bluray|bdrip|brrip|webrip|web-dl|webdl|hdtv|dvdrip|remux|x264|x265|h264|h265|hevc|avc|xvid|av1|vp9).*/i

/**
 * Clean a title string for use as a TV series search query.
 * Prefers parseTvFilename on the raw filename when a file URI is available;
 * falls back to stripping S##E## patterns, quality indicators, and
 * normalising separators from the title string directly.
 */
export function cleanTvSearchQuery (title: string, fileUri?: string): string {
  // First try the structured parser on the original filename — it's the most reliable
  if (fileUri) {
    const filename = basename(fileUri)
    const parsed = parseTvFilename(filename, fileUri)
    if (parsed?.seriesName) {
      return parsed.seriesName
    }
  }

  // Fallback: strip known TV/quality patterns from the title string
  let cleaned = title
  // Strip leading bracketed release groups like [YTS.MX]
  cleaned = cleaned.replace(/^\[.*?\]\s*/, '')
  cleaned = cleaned.replace(TV_EPISODE_STRIP, '')
  cleaned = cleaned.replace(TV_SEASON_X_STRIP, '')
  cleaned = cleaned.replace(TV_SEASON_WORD_STRIP, '')
  cleaned = cleaned.replace(QUALITY_INDICATORS, '')

  // Normalise separators
  cleaned = cleaned.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim()

  return cleaned || title
}

const config = parseJsonConfig(process.env.AVIATO_PLUGIN_CONFIG)
const tmdbApiKey = (config.tmdbApiKey as string | undefined) ?? DEFAULT_TMDB_API_KEY
const language = (config.language as string) ?? 'en-US'

// ── Media-type dispatch helpers ───────────────────────

function resolveMediaType (libraryType: string): MediaType {
  // libraryType may be a media type ("tv") or a library plugin ID ("aviato-library-tv")
  if (/\btv\b/i.test(libraryType)) {
    return 'tv'
  }
  return 'movies'
}

async function resolveTmdbId (
  canonicalIds: ExternalId[],
  mediaType: MediaType,
): Promise<number | null> {
  if (!tmdbApiKey) {
    return null
  }
  return resolveTmdbIdFromApi(canonicalIds, tmdbApiKey, mediaType)
}

async function getMatchDetailInternal (
  canonicalIds: ExternalId[],
  mediaType: MediaType,
  season?: number,
  episode?: number,
  certificationCountry?: string,
): Promise<IndexResult> {
  if (!tmdbApiKey) {
    return {
      success: false,
      error: 'TMDb API key not configured',
    }
  }

  const tmdbId = await resolveTmdbId(canonicalIds, mediaType)
  if (!tmdbId) {
    return {
      success: false,
      error: 'Could not resolve TMDb ID from canonical IDs',
    }
  }

  if (mediaType === 'tv') {
    return buildSeriesResult(tmdbId, season, episode, tmdbApiKey, language, certificationCountry)
  }
  return buildMovieResult(tmdbId, tmdbApiKey, language, certificationCountry)
}

async function searchInternal (
  query: string,
  year: number | undefined,
  mediaType: MediaType,
): Promise<SearchResult> {
  if (!tmdbApiKey) {
    return {
      results: [],
    }
  }

  if (mediaType === 'tv') {
    return searchSeriesInternal(query, year, tmdbApiKey, language)
  }
  return searchMoviesInternal(query, year, tmdbApiKey, language)
}

// ── Plugin registration ────────────────────────────────

createPlugin({
  'artwork-search': {
    async search (params: ArtworkSearchRequest): Promise<ArtworkSearchResult> {
      if (!tmdbApiKey) {
        return {
          results: [],
        }
      }

      const mediaType = resolveMediaType(params.mediaType)
      let tmdbId = await resolveTmdbId(params.canonicalIds, mediaType)
      // Fallback for items indexed before applyIndexResult started persisting
      // metadata.canonicalIds — without a stored tmdb id we still have title
      // and year, so do a quick fuzzy lookup and use the top match.
      if (!tmdbId && params.title) {
        try {
          const search = await searchInternal(params.title, params.year, mediaType)
          const fallbackTmdb = search.results[0]?.canonicalIds.find(c => c.provider === 'tmdb')
          if (fallbackTmdb) {
            tmdbId = Number(fallbackTmdb.id)
          }
        } catch {
          // Search errors fall through to the empty-results return below.
        }
      }
      if (!tmdbId || !Number.isFinite(tmdbId)) {
        return {
          results: [],
        }
      }

      let images
      try {
        images = await fetchAllImages(mediaType, tmdbId, tmdbApiKey)
      } catch {
        return {
          results: [],
        }
      }
      if (!images) {
        return {
          results: [],
        }
      }

      const wantTypes = new Set<ArtworkReference['type']>(
        params.types ?? ['poster', 'backdrop', 'logo'],
      )
      const results: ArtworkCandidate[] = []

      const pushAll = (entries: typeof images.posters, type: ArtworkReference['type'], previewSize: 'w500' | 'w780' | 'w1920' | 'original') => {
        if (!wantTypes.has(type)) {
          return
        }
        for (const entry of entries) {
          results.push({
            type,
            url: tmdbImageUrl(entry.filePath, 'original'),
            thumbnailUrl: tmdbImageUrl(entry.filePath, previewSize),
            language: entry.language ?? undefined,
            width: entry.width,
            height: entry.height,
            voteAverage: entry.voteAverage,
            voteCount: entry.voteCount,
          })
        }
      }

      pushAll(images.posters, 'poster', 'w500')
      pushAll(images.backdrops, 'backdrop', 'w780')
      pushAll(images.logos, 'logo', 'w500')

      // Optional language preference — keep matching language first while
      // preserving the rest so the picker still shows alternatives.
      if (params.language) {
        const lang = params.language.split('-')[0]
        results.sort((a, b) => {
          const aMatch = a.language === lang ? 0 : 1
          const bMatch = b.language === lang ? 0 : 1
          return aMatch - bMatch
        })
      }

      return {
        results,
      }
    },
  },
  indexer: {
    async supports (file: DiscoveredFile): Promise<boolean> {
      const ext = extname(file.filename).toLowerCase()
      return VIDEO_EXTENSIONS.has(ext)
    },

    async index (request: IndexRequest): Promise<IndexResult> {
      const { metadata } = request
      const mediaType = resolveMediaType(request.options.mediaType ?? request.options.libraryType)
      const { certificationCountry } = request.options
      const warnings: string[] = []

      // Get season/episode from bundle fields (relevant for TV)
      const season = getBundleValue(metadata.fields.season ?? []) as number | undefined
      const episode = getBundleValue(metadata.fields.episode ?? []) as number | undefined

      try {
        // 1. Check for confident canonical IDs — skip search if we have them
        const confidentIds = getConfidentCanonicalIds(metadata)
        if (confidentIds.length > 0 && tmdbApiKey) {
          const result = await getMatchDetailInternal(confidentIds, mediaType, season, episode, certificationCountry)
          if (result.success && result.metadata) {
            mergeConfidentFields(metadata, result.metadata.fields)
            return result
          }
          warnings.push(`Canonical ID lookup failed: ${result.error}`)
        }

        // 2. Build search query from bundle
        const title = getBundleValue(metadata.title)
        const year = getBundleValue(metadata.year)

        if (!title) {
          return {
            success: false,
            error: 'No title available in metadata bundle',
          }
        }

        // For TV content, clean the title to extract just the series name.
        // Raw titles from FFprobe tags often contain episode info and quality
        // indicators (e.g. "Silicon Valley - S01E01 - Minimum Viable Product
        // Bluray-1080p Remux") which cause TMDB search to return no results.
        const searchTitle = mediaType === 'tv'
          ? cleanTvSearchQuery(title, request.file.uri)
          : title

        // Build a baseline display title from what we know
        const epLabel = (mediaType === 'tv' && season !== undefined && episode !== undefined)
          ? `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
          : undefined

        if (!tmdbApiKey) {
          const fields: Record<string, unknown> = {
            year,
            season,
            episode,
          }
          mergeConfidentFields(metadata, fields)
          return {
            success: true,
            metadata: {
              title: epLabel ? `${title} - ${epLabel}` : title,
              fields,
            },
            warnings: ['TMDb API key not configured, using bundle metadata only'],
          }
        }

        // 3. Search TMDb
        const searchResult = await searchInternal(searchTitle, year, mediaType)
        if (searchResult.results.length === 0) {
          const fields: Record<string, unknown> = {
            year,
            season,
            episode,
          }
          mergeConfidentFields(metadata, fields)
          return {
            success: true,
            metadata: {
              title: epLabel ? `${title} - ${epLabel}` : title,
              fields,
            },
            warnings: [...warnings, 'No TMDb match found, using bundle metadata only'],
          }
        }

        // 4. Pick best match and fetch full details
        const best = searchResult.results[0]
        const detailResult = await getMatchDetailInternal(best.canonicalIds, mediaType, season, episode, certificationCountry)

        if (detailResult.success && detailResult.metadata) {
          mergeConfidentFields(metadata, detailResult.metadata.fields)
          if (warnings.length > 0) {
            detailResult.warnings = [...(detailResult.warnings ?? []), ...warnings]
          }
          return detailResult
        }

        // Detail fetch failed — return basic metadata
        const fields: Record<string, unknown> = {
          year: best.year,
          season,
          episode,
        }
        mergeConfidentFields(metadata, fields)
        return {
          success: true,
          metadata: {
            title: epLabel ? `${best.title} - ${epLabel}` : best.title,
            fields,
          },
          warnings: [...warnings, `TMDb detail fetch failed: ${detailResult.error}`],
        }
      } catch (err) {
        if (err instanceof TmdbError && err.retryable) {
          return {
            success: false,
            error: err.message,
            retryable: true,
          }
        }

        // Non-retryable error — degrade gracefully
        const title = getBundleValue(metadata.title)
        const year = getBundleValue(metadata.year)
        const epLabel = (mediaType === 'tv' && season !== undefined && episode !== undefined)
          ? `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
          : undefined
        const fields: Record<string, unknown> = {
          year,
          season,
          episode,
        }
        mergeConfidentFields(metadata, fields)

        return {
          success: true,
          metadata: {
            title: epLabel ? `${title ?? 'Unknown'} - ${epLabel}` : (title ?? 'Unknown'),
            fields,
          },
          warnings: [`TMDb lookup failed: ${err instanceof Error ? err.message : String(err)}`],
        }
      }
    },

    async search (params: SearchRequest): Promise<SearchResult> {
      return searchInternal(params.query, params.year, resolveMediaType(params.mediaType ?? params.libraryType))
    },

    async getMatchDetail (params: MatchDetailRequest): Promise<IndexResult> {
      const mediaType = resolveMediaType(params.mediaType ?? params.libraryType)
      return getMatchDetailInternal(
        params.canonicalIds, mediaType, undefined, undefined, params.certificationCountry,
      )
    },

    async getEntityDetail (request) {
      if (!tmdbApiKey) {
        return {
          success: false,
          error: 'TMDb API key not configured',
        }
      }

      if (request.entityType !== 'person' && request.entityType !== 'show' && request.entityType !== 'season') {
        return {
          success: false,
          unsupported: true,
          error: `Unsupported entityType: ${request.entityType}`,
        }
      }

      try {
        if (request.entityType === 'season') {
          // Seasons need the parent show's TMDb ID and a season number
          const parentShow = request.parents?.find(p => p.entityType === 'show')
          const parentTmdbId = parentShow?.externalIds?.find(e => e.provider === 'tmdb')?.id
          if (!parentTmdbId) {
            return {
              success: false,
              error: 'No parent show with TMDb ID found for season',
            }
          }

          // Parse season number from name (e.g. "Season 1" → 1)
          const seasonMatch = request.name.match(/season\s*(\d+)/i)
          const seasonNumber = seasonMatch ? Number(seasonMatch[1]) : null
          if (seasonNumber == null) {
            return {
              success: false,
              error: `Could not parse season number from name: ${request.name}`,
            }
          }

          const season = await fetchSeasonDetails(Number(parentTmdbId), seasonNumber, tmdbApiKey, language)
          if (!season) {
            return {
              success: false,
              error: `Season ${seasonNumber} not found on TMDb for show ${parentTmdbId}`,
            }
          }

          const artwork: ArtworkReference[] = []
          if (season.posterPath) {
            artwork.push({
              type: 'poster',
              url: season.posterPath,
            })
          }

          return {
            success: true,
            entity: {
              entityType: 'season',
              name: season.name,
              role: 'season',
              complete: true,
              imageUrl: season.posterPath ?? undefined,
              externalIds: [{
                provider: 'tmdb',
                id: String(season.id),
                url: `https://www.themoviedb.org/tv/${parentTmdbId}/season/${seasonNumber}`,
              }],
              artwork: artwork.length > 0 ? artwork : undefined,
              metadata: {
                ...(season.overview ? {
                  description: season.overview,
                } : {}),
                ...(season.airDate ? {
                  airDate: season.airDate,
                } : {}),
                episodeCount: season.episodeCount,
                seasonNumber: season.seasonNumber,
              },
            },
          }
        }

        const tmdbId = request.externalIds?.find(e => e.provider === 'tmdb')?.id
        if (!tmdbId) {
          return {
            success: false,
            error: 'No TMDb ID provided',
          }
        }

        if (request.entityType === 'person') {
          const person = await fetchPerson(Number(tmdbId), tmdbApiKey, language)
          if (!person) {
            return {
              success: false,
              error: 'Person not found on TMDb',
            }
          }

          const externalLinks = []
          if (person.homepage) {
            externalLinks.push({
              label: 'Homepage',
              url: person.homepage,
            })
          }
          if (person.imdbId) {
            externalLinks.push({
              label: 'IMDb',
              url: `https://www.imdb.com/name/${person.imdbId}`,
            })
          }

          return {
            success: true,
            entity: {
              entityType: 'person',
              name: person.name,
              role: 'person',
              complete: true,
              imageUrl: person.profilePath ?? undefined,
              externalIds: [
                {
                  provider: 'tmdb',
                  id: String(person.id),
                  url: `https://www.themoviedb.org/person/${person.id}`,
                },
                ...(person.imdbId ? [{
                  provider: 'imdb',
                  id: person.imdbId,
                  url: `https://www.imdb.com/name/${person.imdbId}`,
                }] : []),
              ],
              metadata: {
                biography: person.biography,
                birthday: person.birthday,
                deathday: person.deathday,
                placeOfBirth: person.placeOfBirth,
              },
              externalLinks: externalLinks.length > 0 ? externalLinks : undefined,
            },
          }
        }

        // entityType === 'show'
        const series = await fetchSeriesDetails(Number(tmdbId), tmdbApiKey, language)
        if (!series) {
          return {
            success: false,
            error: 'Show not found on TMDb',
          }
        }

        const entityArtwork: ArtworkReference[] = []
        if (series.posterPath) {
          entityArtwork.push({
            type: 'poster',
            url: series.posterPath,
          })
        }
        if (series.backdropPath) {
          entityArtwork.push({
            type: 'backdrop',
            url: series.backdropPath,
          })
        }
        const entityLogo = await getSeriesLogo(series.id, tmdbApiKey)
        if (entityLogo) {
          entityArtwork.push({
            type: 'logo',
            url: entityLogo,
          })
        }

        return {
          success: true,
          entity: {
            entityType: 'show',
            name: series.name,
            role: 'show',
            complete: true,
            externalIds: [
              {
                provider: 'tmdb',
                id: String(series.id),
                url: `https://www.themoviedb.org/tv/${series.id}`,
              },
            ],
            artwork: entityArtwork,
            metadata: {
              overview: series.overview,
              firstAirDate: series.firstAirDate,
              status: series.status,
              numberOfSeasons: series.numberOfSeasons,
              voteAverage: series.voteAverage,
            },
          },
        }
      } catch (err) {
        const retryable = err instanceof TmdbError && err.retryable
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          retryable,
        }
      }
    },
  },
})
