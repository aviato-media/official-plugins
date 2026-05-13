export class TmdbError extends Error {
  constructor (message: string, public readonly retryable: boolean) {
    super(message)
    this.name = 'TmdbError'
  }
}

const TMDB_BASE = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

// ── Shared helpers ────────────────────────────────────

async function tmdbFetch (url: string): Promise<Response>
async function tmdbFetch (url: string, allow404: true): Promise<Response | null>
async function tmdbFetch (url: string, allow404?: boolean): Promise<Response | null> {
  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    throw new TmdbError(`TMDb network error: ${(err as Error).message}`, true)
  }
  if (!res.ok) {
    if (allow404 && res.status === 404) {
      return null
    }
    throw new TmdbError(`TMDb API error: ${res.status}`, res.status === 429 || res.status >= 500)
  }
  return res
}

function posterUrl (path: string | null): string | null {
  return path ? `${TMDB_IMAGE_BASE}/w780${path}` : null
}

function stillUrl (path: string | null): string | null {
  return path ? `${TMDB_IMAGE_BASE}/original${path}` : null
}

function backdropUrl (path: string | null): string | null {
  return path ? `${TMDB_IMAGE_BASE}/w1920${path}` : null
}

function profileUrl (path: string | null): string | null {
  return path ? `${TMDB_IMAGE_BASE}/w185${path}` : null
}

function params (apiKey: string, extra?: Record<string, string>): URLSearchParams {
  return new URLSearchParams({
    api_key: apiKey,
    ...extra,
  })
}

// ── Shared types ──────────────────────────────────────

export interface TmdbPerson {
  id: number
  name: string
  biography: string | null
  birthday: string | null
  deathday: string | null
  placeOfBirth: string | null
  profilePath: string | null
  homepage: string | null
  imdbId: string | null
}

// ── Movie types ───────────────────────────────────────

export interface TmdbMovie {
  id: number
  title: string
  overview: string
  releaseDate: string
  posterPath: string | null
  backdropPath: string | null
  voteAverage: number
  genres: string[]
  runtime: number | null
  tagline: string | null
  imdbId: string | null
  originCountry: string[]
}

export interface TmdbMovieCredits {
  cast: Array<{
    id: number
    name: string
    character: string
    order: number
    profilePath: string | null
  }>
  directors: Array<{
    id: number
    name: string
    profilePath: string | null
  }>
}

// ── TV types ──────────────────────────────────────────

export interface TmdbSeries {
  id: number
  name: string
  overview: string
  firstAirDate: string
  posterPath: string | null
  backdropPath: string | null
  voteAverage: number
  genres: string[]
  status: string
  numberOfSeasons: number
  imdbId: string | null
  tvdbId: number | null
  originCountry: string[]
}

export interface TmdbEpisode {
  id: number
  name: string
  overview: string
  airDate: string | null
  seasonNumber: number
  episodeNumber: number
  voteAverage: number
  stillPath: string | null
  runtime: number | null
}

export interface TmdbSeason {
  id: number
  name: string
  overview: string
  airDate: string | null
  seasonNumber: number
  posterPath: string | null
  episodeCount: number
}

export interface TmdbSeriesCredits {
  cast: Array<{
    id: number
    name: string
    character: string
    order: number
    profilePath: string | null
  }>
  creators: Array<{
    id: number
    name: string
    profilePath: string | null
  }>
}

// ── Movie endpoints ───────────────────────────────────

export async function searchMovies (
  query: string,
  year: number | undefined,
  apiKey: string,
  language: string,
): Promise<Array<{
  id: number
  title: string
  overview: string
  releaseDate: string
  posterPath: string | null
}>> {
  const p = params(apiKey, {
    query,
    language,
  })
  if (year) {
    p.set('year', String(year))
  }

  const res = await tmdbFetch(`${TMDB_BASE}/search/movie?${p}`)
  const data = await res.json() as { results: Array<Record<string, unknown>> }
  return (data.results ?? []).slice(0, 10).map(m => ({
    id: m.id as number,
    title: m.title as string,
    overview: (m.overview as string) ?? '',
    releaseDate: (m.release_date as string) ?? '',
    posterPath: posterUrl(m.poster_path as string | null),
  }))
}

export async function fetchMovieDetails (
  movieId: number,
  apiKey: string,
  language: string,
): Promise<TmdbMovie | null> {
  const res = await tmdbFetch(`${TMDB_BASE}/movie/${movieId}?${params(apiKey, {
    language,
  })}`)
  const data = await res.json() as Record<string, unknown>

  return {
    id: data.id as number,
    title: data.title as string,
    overview: data.overview as string,
    releaseDate: data.release_date as string,
    posterPath: posterUrl(data.poster_path as string | null),
    backdropPath: backdropUrl(data.backdrop_path as string | null),
    voteAverage: data.vote_average as number,
    genres: ((data.genres as Array<{ name: string }>) ?? []).map(g => g.name),
    runtime: data.runtime as number | null,
    tagline: data.tagline as string | null,
    imdbId: (data.imdb_id as string) || null,
    originCountry: ((data.origin_country as string[]) ?? []).length > 0
      ? (data.origin_country as string[])
      : ((data.production_countries as Array<{ iso_3166_1: string }>) ?? []).map(c => c.iso_3166_1),
  }
}

export async function fetchMovieCredits (
  movieId: number,
  apiKey: string,
): Promise<TmdbMovieCredits> {
  const res = await tmdbFetch(`${TMDB_BASE}/movie/${movieId}/credits?${params(apiKey)}`)
  const data = await res.json() as {
    cast: Array<{
      id: number
      name: string
      character: string
      order: number
      profile_path: string | null
    }>
    crew: Array<{
      id: number
      name: string
      job: string
      profile_path: string | null
    }>
  }

  return {
    cast: (data.cast ?? []).slice(0, 20).map(c => ({
      id: c.id,
      name: c.name,
      character: c.character,
      order: c.order,
      profilePath: profileUrl(c.profile_path),
    })),
    directors: (data.crew ?? [])
      .filter(c => c.job === 'Director')
      .map(c => ({
        id: c.id,
        name: c.name,
        profilePath: profileUrl(c.profile_path),
      })),
  }
}

export async function fetchMovieLogos (
  movieId: number,
  apiKey: string,
): Promise<string | null> {
  const res = await tmdbFetch(`${TMDB_BASE}/movie/${movieId}/images?${params(apiKey, {
    include_image_language: 'en,null',
  })}`)
  return pickBestLogo(await res.json() as { logos: LogoEntry[] })
}

// ── TV endpoints ──────────────────────────────────────

export async function searchSeries (
  query: string,
  year: number | undefined,
  apiKey: string,
  language: string,
): Promise<Array<{
  id: number
  name: string
  overview: string
  firstAirDate: string
  posterPath: string | null
}>> {
  const p = params(apiKey, {
    query,
    language,
  })
  if (year) {
    p.set('first_air_date_year', String(year))
  }

  const res = await tmdbFetch(`${TMDB_BASE}/search/tv?${p}`)
  const data = await res.json() as { results: Array<Record<string, unknown>> }
  return (data.results ?? []).slice(0, 10).map(s => ({
    id: s.id as number,
    name: s.name as string,
    overview: (s.overview as string) ?? '',
    firstAirDate: (s.first_air_date as string) ?? '',
    posterPath: posterUrl(s.poster_path as string | null),
  }))
}

export async function fetchSeriesDetails (
  seriesId: number,
  apiKey: string,
  language: string,
): Promise<TmdbSeries | null> {
  const res = await tmdbFetch(`${TMDB_BASE}/tv/${seriesId}?${params(apiKey, {
    language,
    append_to_response: 'external_ids',
  })}`)
  const data = await res.json() as Record<string, unknown>
  const externalIds = data.external_ids as Record<string, unknown> | undefined

  return {
    id: data.id as number,
    name: data.name as string,
    overview: data.overview as string,
    firstAirDate: data.first_air_date as string,
    posterPath: posterUrl(data.poster_path as string | null),
    backdropPath: backdropUrl(data.backdrop_path as string | null),
    voteAverage: data.vote_average as number,
    genres: ((data.genres as Array<{ name: string }>) ?? []).map(g => g.name),
    status: data.status as string,
    numberOfSeasons: data.number_of_seasons as number,
    imdbId: (externalIds?.imdb_id as string) || null,
    tvdbId: (externalIds?.tvdb_id as number) || null,
    originCountry: (data.origin_country as string[]) ?? [],
  }
}

export async function fetchSeasonDetails (
  seriesId: number,
  seasonNumber: number,
  apiKey: string,
  language: string,
): Promise<TmdbSeason | null> {
  const res = await tmdbFetch(
    `${TMDB_BASE}/tv/${seriesId}/season/${seasonNumber}?${params(apiKey, {
      language,
    })}`,
    true,
  )
  if (!res) {
    return null
  }

  const data = await res.json() as Record<string, unknown>
  return {
    id: data.id as number,
    name: data.name as string,
    overview: (data.overview as string) ?? '',
    airDate: data.air_date as string | null,
    seasonNumber: data.season_number as number,
    posterPath: posterUrl(data.poster_path as string | null),
    episodeCount: (data.episode_count as number) ?? 0,
  }
}

export async function fetchEpisodeDetails (
  seriesId: number,
  season: number,
  episode: number,
  apiKey: string,
  language: string,
): Promise<TmdbEpisode | null> {
  const res = await tmdbFetch(
    `${TMDB_BASE}/tv/${seriesId}/season/${season}/episode/${episode}?${params(apiKey, {
      language,
    })}`,
    true,
  )
  if (!res) {
    return null
  }

  const data = await res.json() as Record<string, unknown>
  return {
    id: data.id as number,
    name: data.name as string,
    overview: data.overview as string,
    airDate: data.air_date as string | null,
    seasonNumber: data.season_number as number,
    episodeNumber: data.episode_number as number,
    voteAverage: data.vote_average as number,
    stillPath: stillUrl(data.still_path as string | null),
    runtime: data.runtime as number | null,
  }
}

export async function fetchSeriesCredits (
  seriesId: number,
  apiKey: string,
): Promise<TmdbSeriesCredits> {
  const res = await tmdbFetch(`${TMDB_BASE}/tv/${seriesId}/credits?${params(apiKey)}`, true)
  if (!res) {
    return {
      cast: [],
      creators: [],
    }
  }

  const data = await res.json() as {
    cast: Array<{
      id: number
      name: string
      character: string
      order: number
      profile_path: string | null
    }>
    crew: Array<{
      id: number
      name: string
      job: string
      profile_path: string | null
    }>
  }

  return {
    cast: (data.cast ?? []).slice(0, 20).map(c => ({
      id: c.id,
      name: c.name,
      character: c.character,
      order: c.order,
      profilePath: profileUrl(c.profile_path),
    })),
    creators: (data.crew ?? [])
      .filter(c => c.job === 'Executive Producer' || c.job === 'Creator')
      .slice(0, 5)
      .map(c => ({
        id: c.id,
        name: c.name,
        profilePath: profileUrl(c.profile_path),
      })),
  }
}

export async function fetchSeriesLogos (
  seriesId: number,
  apiKey: string,
): Promise<string | null> {
  const res = await tmdbFetch(`${TMDB_BASE}/tv/${seriesId}/images?${params(apiKey, {
    include_image_language: 'en,null',
  })}`)
  return pickBestLogo(await res.json() as { logos: LogoEntry[] })
}

// ── Bulk image listing for artwork-search picker ─────

export interface TmdbImageEntry {
  filePath: string
  width: number
  height: number
  voteAverage: number
  voteCount: number
  language: string | null
}

export interface TmdbAllImages {
  posters: TmdbImageEntry[]
  backdrops: TmdbImageEntry[]
  logos: TmdbImageEntry[]
}

interface TmdbImagesResponse {
  posters?: Array<{ file_path: string,
    width: number,
    height: number,
    vote_average: number,
    vote_count: number,
    iso_639_1: string | null }>
  backdrops?: Array<{ file_path: string,
    width: number,
    height: number,
    vote_average: number,
    vote_count: number,
    iso_639_1: string | null }>
  logos?: Array<{ file_path: string,
    width: number,
    height: number,
    vote_average: number,
    vote_count: number,
    iso_639_1: string | null }>
}

function mapImageEntries (entries: TmdbImagesResponse['posters'] | TmdbImagesResponse['backdrops'] | TmdbImagesResponse['logos']): TmdbImageEntry[] {
  if (!entries) {
    return []
  }
  return entries
    .map(e => ({
      filePath: e.file_path,
      width: e.width,
      height: e.height,
      voteAverage: e.vote_average,
      voteCount: e.vote_count,
      language: e.iso_639_1,
    }))
    // Highest-rated first; ties broken by vote count, then by upload order
    // (preserved from the TMDb response).
    .sort((a, b) => b.voteAverage - a.voteAverage || b.voteCount - a.voteCount)
}

/**
 * Fetch posters, backdrops, and logos for a movie or series in a single
 * TMDb call. Includes language-tagged AND language-neutral assets so the
 * picker can show alternates across regions.
 */
export async function fetchAllImages (
  mediaType: MediaType,
  tmdbId: number,
  apiKey: string,
): Promise<TmdbAllImages | null> {
  const path = mediaType === 'tv' ? 'tv' : 'movie'
  const res = await tmdbFetch(`${TMDB_BASE}/${path}/${tmdbId}/images?${params(apiKey, {
    // include all languages; the picker UI can filter client-side
    include_image_language: 'en,null,ja,fr,de,es,it,pt,zh,ko',
  })}`, true)
  if (!res) {
    return null
  }
  const data = await res.json() as TmdbImagesResponse
  return {
    posters: mapImageEntries(data.posters),
    backdrops: mapImageEntries(data.backdrops),
    logos: mapImageEntries(data.logos),
  }
}

/** Resolve a TMDb image filePath into a full URL at the given size preset. */
export function tmdbImageUrl (path: string, size: 'w500' | 'w780' | 'w1920' | 'original' = 'original'): string {
  return `${TMDB_IMAGE_BASE}/${size}${path}`
}

// ── Shared endpoints ──────────────────────────────────

export type MediaType = 'movies' | 'tv'

export async function resolveTmdbId (
  canonicalIds: Array<{ provider: string,
    id: string }>,
  apiKey: string,
  mediaType: MediaType,
): Promise<number | null> {
  const tmdbEntry = canonicalIds.find(e => e.provider === 'tmdb')
  if (tmdbEntry) {
    // Plex-style files embed TMDb IDs as `tv/123` or `movie/123` in their
    // tag metadata; strip the leading agent prefix so `Number()` parses the
    // numeric id rather than producing NaN.
    const raw = tmdbEntry.id.replace(/^(?:tv|movies?)\//i, '')
    const numeric = Number(raw)
    if (Number.isFinite(numeric)) {
      return numeric
    }
  }

  for (const entry of canonicalIds) {
    if (entry.provider === 'imdb' || entry.provider === 'tvdb') {
      const tmdbId = await findByExternalId(entry.id, entry.provider, apiKey, mediaType)
      if (tmdbId) {
        return tmdbId
      }
    }
  }

  return null
}

export async function findByExternalId (
  externalId: string,
  externalSource: string,
  apiKey: string,
  mediaType: 'movies' | 'tv',
): Promise<number | null> {
  const sourceMap: Record<string, string> = {
    imdb: 'imdb_id',
    tvdb: 'tvdb_id',
  }
  const source = sourceMap[externalSource]
  if (!source) {
    return null
  }

  const res = await tmdbFetch(`${TMDB_BASE}/find/${externalId}?${params(apiKey, {
    external_source: source,
  })}`)
  const data = await res.json() as {
    movie_results: Array<{ id: number }>
    tv_results: Array<{ id: number }>
  }

  if (mediaType === 'movies') {
    return data.movie_results?.[0]?.id ?? null
  }
  return data.tv_results?.[0]?.id ?? null
}

export async function fetchPerson (
  personId: number,
  apiKey: string,
  language: string,
): Promise<TmdbPerson | null> {
  const res = await tmdbFetch(`${TMDB_BASE}/person/${personId}?${params(apiKey, {
    language,
  })}`)
  const data = await res.json() as Record<string, unknown>
  return {
    id: data.id as number,
    name: data.name as string,
    biography: (data.biography as string) || null,
    birthday: (data.birthday as string) || null,
    deathday: (data.deathday as string) || null,
    placeOfBirth: (data.place_of_birth as string) || null,
    profilePath: profileUrl(data.profile_path as string | null),
    homepage: (data.homepage as string) || null,
    imdbId: (data.imdb_id as string) || null,
  }
}

// ── Certification endpoints ──────────────────────────

export interface TmdbReleaseDateEntry {
  iso_3166_1: string
  release_dates: Array<{
    certification: string
    type: number
  }>
}

export interface TmdbContentRatingEntry {
  iso_3166_1: string
  rating: string
}

/**
 * Fetch per-country release dates (includes certifications) for a movie.
 * TMDB endpoint: /movie/{id}/release_dates
 */
export async function fetchMovieReleaseDates (
  movieId: number,
  apiKey: string,
): Promise<TmdbReleaseDateEntry[]> {
  const res = await tmdbFetch(`${TMDB_BASE}/movie/${movieId}/release_dates?${params(apiKey)}`)
  if (!res) {
    return []
  }
  const data = await res.json() as { results: TmdbReleaseDateEntry[] }
  return data.results ?? []
}

/**
 * Fetch per-country content ratings for a TV series.
 * TMDB endpoint: /tv/{id}/content_ratings
 */
export async function fetchTvContentRatings (
  seriesId: number,
  apiKey: string,
): Promise<TmdbContentRatingEntry[]> {
  const res = await tmdbFetch(`${TMDB_BASE}/tv/${seriesId}/content_ratings?${params(apiKey)}`)
  if (!res) {
    return []
  }
  const data = await res.json() as { results: TmdbContentRatingEntry[] }
  return data.results ?? []
}

/**
 * Resolve a single certification string from a list of country→certification entries.
 * Fallback chain: preferredCountry → originCountry(s) → US → first non-empty → undefined.
 */
export function resolveCertification (
  entries: Array<{ countryCode: string,
    certification: string }>,
  preferredCountry: string | undefined,
  originCountries: string[],
): string | undefined {
  if (entries.length === 0) {
    return undefined
  }

  const find = (cc: string) =>
    entries.find(e => e.countryCode === cc && e.certification.trim() !== '')?.certification

  // 1. Preferred country
  if (preferredCountry) {
    const hit = find(preferredCountry)
    if (hit) {
      return hit
    }
  }

  // 2. Origin country(s)
  for (const cc of originCountries) {
    const hit = find(cc)
    if (hit) {
      return hit
    }
  }

  // 3. US fallback
  if (preferredCountry !== 'US' && !originCountries.includes('US')) {
    const hit = find('US')
    if (hit) {
      return hit
    }
  }

  // 4. First available non-empty certification
  const any = entries.find(e => e.certification.trim() !== '')
  return any?.certification

  // 5. undefined (no certifications at all)
}

// ── Logo helpers ──────────────────────────────────────

interface LogoEntry {
  file_path: string
  iso_639_1: string | null
  vote_average: number
}

function pickBestLogo (data: { logos: LogoEntry[] }): string | null {
  const logos = data.logos ?? []
  if (logos.length === 0) {
    return null
  }
  const best = logos
    .sort((a, b) => {
      const langOrder = (l: string | null) => l === 'en' ? 0 : l === null ? 1 : 2
      const diff = langOrder(a.iso_639_1) - langOrder(b.iso_639_1)
      return diff !== 0 ? diff : b.vote_average - a.vote_average
    })[0]
  return `${TMDB_IMAGE_BASE}/original${best.file_path}`
}
