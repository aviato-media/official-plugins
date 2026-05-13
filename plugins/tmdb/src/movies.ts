import type {
  ArtworkReference,
  EntityReference,
  ExternalId,
  IndexResult,
  SearchResult,
} from '@aviato-media/plugin-sdk'

import {
  fetchMovieCredits,
  fetchMovieDetails,
  fetchMovieLogos,
  fetchMovieReleaseDates,
  resolveCertification,
  searchMovies,
} from './tmdb.js'

// ── Detail building ───────────────────────────────────

export async function buildMovieResult (
  tmdbId: number,
  apiKey: string,
  language: string,
  certificationCountry?: string,
): Promise<IndexResult> {
  const movie = await fetchMovieDetails(tmdbId, apiKey, language)
  if (!movie) {
    return {
      success: false,
      error: 'Movie not found on TMDb',
    }
  }

  const [credits, logoPath, releaseDates] = await Promise.all([
    fetchMovieCredits(tmdbId, apiKey),
    fetchMovieLogos(tmdbId, apiKey).catch(() => null),
    fetchMovieReleaseDates(tmdbId, apiKey).catch(() => []),
  ])

  // Resolve content certification from release dates
  // Prefer theatrical (3), then digital (4), physical (5), then any release type
  const certEntries = releaseDates.flatMap(r => {
    const sorted = [...r.release_dates].sort((a, b) => {
      const order = (t: number) => t === 3 ? 0 : t === 4 ? 1 : t === 5 ? 2 : 3
      return order(a.type) - order(b.type)
    })
    const best = sorted.find(rd => rd.certification.trim() !== '')
    return best ? [{
      countryCode: r.iso_3166_1,
      certification: best.certification,
    }] : []
  })
  const contentRating = resolveCertification(certEntries, certificationCountry, movie.originCountry)

  const fields: Record<string, unknown> = {
    overview: movie.overview,
    releaseDate: movie.releaseDate,
    year: movie.releaseDate ? Number(movie.releaseDate.slice(0, 4)) : undefined,
    voteAverage: movie.voteAverage,
    runtime: movie.runtime,
    tagline: movie.tagline,
    genres: movie.genres,
    ...(contentRating ? {
      contentRating,
    } : {}),
  }

  const entities: EntityReference[] = []
  const artwork: ArtworkReference[] = []

  if (movie.posterPath) {
    artwork.push({
      type: 'poster',
      url: movie.posterPath,
    })
  }
  if (movie.backdropPath) {
    artwork.push({
      type: 'backdrop',
      url: movie.backdropPath,
    })
  }
  if (logoPath) {
    artwork.push({
      type: 'logo',
      url: logoPath,
    })
  }

  for (const genre of movie.genres) {
    entities.push({
      entityType: 'genre',
      name: genre,
      role: 'genre',
      complete: true,
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

  for (const director of credits.directors) {
    entities.push({
      entityType: 'person',
      name: director.name,
      role: 'director',
      complete: false,
      externalIds: [{
        provider: 'tmdb',
        id: String(director.id),
      }],
      imageUrl: director.profilePath ?? undefined,
    })
  }

  const canonicalIds: ExternalId[] = [{
    provider: 'tmdb',
    id: String(tmdbId),
    url: `https://www.themoviedb.org/movie/${tmdbId}`,
  }]
  if (movie.imdbId) {
    canonicalIds.push({
      provider: 'imdb',
      id: movie.imdbId,
      url: `https://www.imdb.com/title/${movie.imdbId}`,
    })
  }

  return {
    success: true,
    metadata: {
      title: movie.title,
      fields,
      canonicalIds,
      entities,
      artwork,
    },
  }
}

// ── Search ────────────────────────────────────────────

export async function searchMoviesInternal (
  query: string,
  year: number | undefined,
  apiKey: string,
  language: string,
): Promise<SearchResult> {
  const movies = await searchMovies(query, year, apiKey, language)

  return {
    results: movies.map(m => ({
      title: m.title,
      year: m.releaseDate ? Number(m.releaseDate.slice(0, 4)) : undefined,
      overview: m.overview || undefined,
      imageUrl: m.posterPath ?? undefined,
      canonicalIds: [{
        provider: 'tmdb',
        id: String(m.id),
      }],
    })),
  }
}
