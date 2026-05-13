import type {
  ArtworkReference,
  EntityReference,
  ExternalId,
  IndexResult,
  SearchResult,
} from '@aviato-media/plugin-sdk'

import type { TmdbContentRatingEntry } from './tmdb.js'
import {
  fetchEpisodeDetails,
  fetchSeriesCredits,
  fetchSeriesDetails,
  fetchSeriesLogos,
  fetchTvContentRatings,
  resolveCertification,
  searchSeries,
} from './tmdb.js'

// ── Caches (per-process, for multi-episode efficiency) ─

const seriesCache = new Map<number, Awaited<ReturnType<typeof fetchSeriesDetails>>>()
const creditsCache = new Map<number, Awaited<ReturnType<typeof fetchSeriesCredits>>>()
const logoCache = new Map<number, string | null>()
const contentRatingsCache = new Map<number, TmdbContentRatingEntry[]>()

// ── Detail building ───────────────────────────────────

export async function buildSeriesResult (
  seriesId: number,
  season: number | undefined,
  episode: number | undefined,
  apiKey: string,
  language: string,
  certificationCountry?: string,
): Promise<IndexResult> {
  // Use series cache
  let series = seriesCache.get(seriesId) ?? null
  if (!series) {
    series = await fetchSeriesDetails(seriesId, apiKey, language)
    seriesCache.set(seriesId, series)
  }

  if (!series) {
    return {
      success: false,
      error: 'Series not found on TMDb',
    }
  }

  const fields: Record<string, unknown> = {
    tmdbSeriesId: series.id,
    seriesName: series.name,
    seriesOverview: series.overview,
    firstAirDate: series.firstAirDate,
    seriesVoteAverage: series.voteAverage,
    seriesStatus: series.status,
    numberOfSeasons: series.numberOfSeasons,
  }

  const entities: EntityReference[] = []
  const artwork: ArtworkReference[] = []

  if (series.posterPath) {
    artwork.push({
      type: 'poster',
      url: series.posterPath,
    })
  }
  if (series.backdropPath) {
    artwork.push({
      type: 'backdrop',
      url: series.backdropPath,
    })
  }

  for (const genre of series.genres) {
    entities.push({
      entityType: 'genre',
      name: genre,
      role: 'genre',
      complete: true,
    })
  }

  // Show + season hierarchy
  const showEntity: EntityReference = {
    entityType: 'show',
    name: series.name,
    role: 'show',
    complete: false,
    externalIds: [{
      provider: 'tmdb',
      id: String(series.id),
    }],
  }

  // Always link the show entity to the episode item
  entities.push(showEntity)

  if (season !== undefined) {
    entities.push({
      entityType: 'season',
      name: `Season ${season}`,
      role: 'season',
      complete: false,
      linkMetadata: {
        seasonNumber: season,
      },
      parentEntities: [showEntity],
    })
  }

  // Episode label
  let epLabel = ''
  if (season !== undefined && episode !== undefined) {
    epLabel = `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
    fields.season = season
    fields.episode = episode
  }

  // Fetch episode details
  let episodeTitle: string | undefined
  if (season !== undefined && episode !== undefined) {
    const ep = await fetchEpisodeDetails(seriesId, season, episode, apiKey, language)
    if (ep) {
      episodeTitle = ep.name
      fields.episodeTitle = ep.name
      fields.episodeOverview = ep.overview
      fields.airDate = ep.airDate
      fields.episodeVoteAverage = ep.voteAverage
      fields.episodeRuntime = ep.runtime

      if (ep.stillPath) {
        artwork.push({
          type: 'thumbnail',
          url: ep.stillPath,
        })
      }
    }
  }

  // Credits + logo + content ratings (cached per series)
  let credits = creditsCache.get(seriesId)
  let logoPath = logoCache.get(seriesId)
  let contentRatings = contentRatingsCache.get(seriesId)
  if (!credits) {
    const [fetchedCredits, fetchedLogo, fetchedRatings] = await Promise.all([
      fetchSeriesCredits(seriesId, apiKey),
      fetchSeriesLogos(seriesId, apiKey).catch(() => null),
      fetchTvContentRatings(seriesId, apiKey).catch(() => []),
    ])
    credits = fetchedCredits
    logoPath = fetchedLogo as string | null
    contentRatings = fetchedRatings
    creditsCache.set(seriesId, credits)
    logoCache.set(seriesId, logoPath)
    contentRatingsCache.set(seriesId, contentRatings)
  }

  // Resolve content certification
  const certEntries = (contentRatings ?? []).map(r => ({
    countryCode: r.iso_3166_1,
    certification: r.rating,
  }))
  const contentRating = resolveCertification(certEntries, certificationCountry, series.originCountry)
  if (contentRating) {
    fields.contentRating = contentRating
  }
  if (logoPath) {
    artwork.push({
      type: 'logo',
      url: logoPath,
    })
  }

  for (const actor of credits.cast) {
    entities.push({
      entityType: 'person',
      name: actor.name,
      role: 'cast',
      complete: false,
      externalIds: [{
        provider: 'tmdb',
        id: String(actor.id),
      }],
      imageUrl: actor.profilePath ?? undefined,
      linkMetadata: {
        character: actor.character,
        billingOrder: actor.order,
      },
      sortOrder: actor.order,
    })
  }

  for (const creator of credits.creators) {
    entities.push({
      entityType: 'person',
      name: creator.name,
      role: 'creator',
      complete: false,
      externalIds: [{
        provider: 'tmdb',
        id: String(creator.id),
      }],
      imageUrl: creator.profilePath ?? undefined,
    })
  }

  // Build display title — episode title only, show context comes from entity links
  let displayTitle = series.name
  if (epLabel) {
    displayTitle = episodeTitle || epLabel
  }

  const canonicalIds: ExternalId[] = [{
    provider: 'tmdb',
    id: String(seriesId),
    url: `https://www.themoviedb.org/tv/${seriesId}`,
  }]
  if (series.imdbId) {
    canonicalIds.push({
      provider: 'imdb',
      id: series.imdbId,
      url: `https://www.imdb.com/title/${series.imdbId}`,
    })
  }
  if (series.tvdbId) {
    canonicalIds.push({
      provider: 'tvdb',
      id: String(series.tvdbId),
      url: `https://www.thetvdb.com/dereferrer/series/${series.tvdbId}`,
    })
  }

  return {
    success: true,
    metadata: {
      title: displayTitle,
      fields,
      canonicalIds,
      entities,
      artwork,
    },
  }
}

// ── Search ────────────────────────────────────────────

export async function searchSeriesInternal (
  query: string,
  year: number | undefined,
  apiKey: string,
  language: string,
): Promise<SearchResult> {
  const series = await searchSeries(query, year, apiKey, language)

  return {
    results: series.map(s => ({
      title: s.name,
      year: s.firstAirDate ? Number(s.firstAirDate.slice(0, 4)) : undefined,
      overview: s.overview || undefined,
      imageUrl: s.posterPath ?? undefined,
      canonicalIds: [{
        provider: 'tmdb',
        id: String(s.id),
      }],
    })),
  }
}

// ── Entity detail (show) ──────────────────────────────

export async function getSeriesLogo (
  seriesId: number,
  apiKey: string,
): Promise<string | null> {
  if (logoCache.has(seriesId)) {
    return logoCache.get(seriesId) ?? null
  }
  const logo = await fetchSeriesLogos(seriesId, apiKey).catch(() => null)
  logoCache.set(seriesId, logo)
  return logo
}

export { fetchSeriesDetails }
