import type {
  ArtworkReference,
  EntityReference,
  ExternalId,
  IndexResult,
  SearchCandidate,
} from '@aviato-media/plugin-sdk'

import type {
  AudibleRegion,
  AudnexAuthor,
  AudnexBook,
  AudnexNarrator,
  AudnexSeries,
} from './audnex.js'
import { REGION_TLD } from './audnex.js'

// ── Series sequence cleaning ─────────────────────────
//
// Audnex returns series positions as free-form strings: "Book 1",
// "2, Dramatized Adaptation", "Book .5", "part a". Strip surrounding
// text and return only the numeric portion. If no number is present,
// return the input unchanged (callers may still want the raw label).
export function cleanSeriesSequence (sequence: string | null | undefined): string {
  if (!sequence) {
    return ''
  }
  const match = sequence.match(/\.\d+|\d+(?:\.\d+)?/)
  return match ? match[0] : sequence
}

// ── Web URL builders for canonical IDs ───────────────

function audibleBookUrl (asin: string, region: AudibleRegion): string {
  return `https://www.audible${REGION_TLD[region]}/pd/${encodeURIComponent(asin)}`
}

function audibleSeriesUrl (asin: string, region: AudibleRegion): string {
  return `https://www.audible${REGION_TLD[region]}/series/${encodeURIComponent(asin)}`
}

// ── Helpers ──────────────────────────────────────────

function joinNames (people: { name: string }[] | undefined): string | undefined {
  if (!people || people.length === 0) {
    return undefined
  }
  return people.map(p => p.name).join(', ')
}

function parseYear (releaseDate: string | undefined): number | undefined {
  if (!releaseDate) {
    return undefined
  }
  const year = parseInt(releaseDate.slice(0, 4), 10)
  return Number.isFinite(year) ? year : undefined
}

function dedupeNames (genres: { name: string }[] | undefined): string[] {
  if (!genres) {
    return []
  }
  return [...new Set(genres.map(g => g.name).filter(Boolean))]
}

// ── Entity builders ──────────────────────────────────

function buildAuthorEntity (author: AudnexAuthor, sortOrder: number): EntityReference {
  const externalIds: ExternalId[] = []
  if (author.asin) {
    externalIds.push({
      provider: 'audible',
      id: author.asin,
    })
  }
  return {
    entityType: 'person',
    name: author.name,
    role: 'author',
    complete: true,
    sortOrder,
    externalIds: externalIds.length > 0 ? externalIds : undefined,
  }
}

function buildNarratorEntity (narrator: AudnexNarrator, sortOrder: number): EntityReference {
  return {
    entityType: 'person',
    name: narrator.name,
    role: 'narrator',
    complete: true,
    sortOrder,
  }
}

function buildGenreEntity (name: string): EntityReference {
  return {
    entityType: 'genre',
    name,
    role: 'genre',
    complete: true,
  }
}

function buildSeriesEntity (
  series: AudnexSeries,
  region: AudibleRegion,
  sortOrder: number,
): EntityReference {
  const externalIds: ExternalId[] = []
  if (series.asin) {
    externalIds.push({
      provider: 'audible',
      id: series.asin,
      url: audibleSeriesUrl(series.asin, region),
    })
  }
  const sequence = cleanSeriesSequence(series.position)
  const positionNum = sequence ? parseFloat(sequence) : undefined
  return {
    entityType: 'series',
    name: series.name,
    role: 'series',
    complete: true,
    sortOrder,
    externalIds: externalIds.length > 0 ? externalIds : undefined,
    linkMetadata: {
      ...(series.position ? {
        position: series.position,
      } : {}),
      ...(Number.isFinite(positionNum as number) ? {
        sequence: positionNum,
      } : {}),
    },
  }
}

// ── Public API ───────────────────────────────────────

export interface BuildResultParams {
  book: AudnexBook
  region: AudibleRegion
}

/**
 * Map an audnex.us book record into an IndexResult ready for the server.
 * Always returns `success: true` — the caller is responsible for handling
 * upstream errors/null responses.
 */
export function buildIndexResult ({ book, region }: BuildResultParams): IndexResult {
  const { asin } = book
  const authorString = joinNames(book.authors)
  const narratorString = joinNames(book.narrators)
  const year = parseYear(book.releaseDate)
  const { seriesPrimary } = book
  const { seriesSecondary } = book
  const primarySequence = cleanSeriesSequence(seriesPrimary?.position)
  const seriesPositionNum = primarySequence ? parseFloat(primarySequence) : undefined

  // Combine genres + tags — Aviato treats them uniformly today.
  const genreNames = dedupeNames(book.genres)

  const fields: Record<string, unknown> = {
    asin,
    ...(book.subtitle ? {
      subtitle: book.subtitle,
    } : {}),
    ...(authorString ? {
      author: authorString,
    } : {}),
    ...(narratorString ? {
      narrator: narratorString,
    } : {}),
    ...(book.publisherName ? {
      publisher: book.publisherName,
    } : {}),
    ...(year ? {
      year,
    } : {}),
    ...(book.summary ? {
      description: book.summary,
    } : {}),
    ...(book.isbn ? {
      isbn: book.isbn,
    } : {}),
    ...(book.language ? {
      language: book.language,
    } : {}),
    ...(typeof book.runtimeLengthMin === 'number' && Number.isFinite(book.runtimeLengthMin) ? {
      duration: book.runtimeLengthMin * 60,
    } : {}),
    ...(book.formatType ? {
      formatType: book.formatType,
      abridged: book.formatType === 'abridged',
    } : {}),
    ...(seriesPrimary ? {
      series: seriesPrimary.name,
      ...(Number.isFinite(seriesPositionNum as number) ? {
        seriesPosition: seriesPositionNum,
      } : {}),
    } : {}),
    ...(genreNames.length > 0 ? {
      genres: genreNames,
    } : {}),
  }

  const entities: EntityReference[] = []
  ;(book.authors ?? []).forEach((a, i) => entities.push(buildAuthorEntity(a, i)))
  ;(book.narrators ?? []).forEach((n, i) => entities.push(buildNarratorEntity(n, i)))
  for (const name of genreNames) {
    entities.push(buildGenreEntity(name))
  }
  if (seriesPrimary) {
    entities.push(buildSeriesEntity(seriesPrimary, region, 0))
  }
  if (seriesSecondary) {
    entities.push(buildSeriesEntity(seriesSecondary, region, 1))
  }

  const canonicalIds: ExternalId[] = [{
    provider: 'audible',
    id: asin,
    url: audibleBookUrl(asin, region),
  }]
  if (book.isbn) {
    canonicalIds.push({
      provider: 'isbn',
      id: book.isbn,
    })
  }

  const artwork: ArtworkReference[] = []
  if (book.image) {
    artwork.push({
      type: 'poster',
      url: book.image,
      aspect: 'square',
    })
  }

  return {
    success: true,
    metadata: {
      title: book.title,
      fields,
      canonicalIds,
      entities,
      artwork,
    },
  }
}

/**
 * Map an audnex.us book record into a SearchCandidate for the user-facing
 * search picker.
 */
export function buildSearchCandidate (
  book: AudnexBook,
  region: AudibleRegion,
): SearchCandidate {
  const author = joinNames(book.authors)
  return {
    title: book.title,
    year: parseYear(book.releaseDate),
    overview: author ? `by ${author}` : undefined,
    imageUrl: book.image,
    canonicalIds: [{
      provider: 'audible',
      id: book.asin,
      url: audibleBookUrl(book.asin, region),
    }],
  }
}
