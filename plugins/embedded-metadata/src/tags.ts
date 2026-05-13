import type { ExternalId } from '@aviato-media/plugin-sdk'

const TAG_KEY_MAP: Record<string, string> = {
  // Title
  '©nam': 'title',
  'title': 'title',

  // Year/Date
  '©day': 'year',
  'date': 'year',
  'date_released': 'year',
  'year': 'year',

  // Description
  'description': 'description',
  'comment': 'description',
  'summary': 'description',
  'desc': 'description',
  'ldes': 'description',

  // Genre — value may be a colon-separated list (m4b convention).
  '©gen': 'genre',
  'genre': 'genre',

  // Album
  '©alb': 'album',
  'album': 'album',

  // Media kind
  'stik': 'mediaKind',
  'media_type': 'mediaKind',

  // Encoder
  'encoder': 'encoder',
}

// Author/narrator are handled outside TAG_KEY_MAP so we can apply explicit
// precedence (album_artist beats artist) regardless of source iteration order.
const AUTHOR_KEYS = ['aart', 'album_artist', 'albumartist', '©art', 'artist']
const NARRATOR_KEYS = ['©wrt', 'composer']
const HANDLED_OUTSIDE_MAP = new Set([...AUTHOR_KEYS, ...NARRATOR_KEYS])

const CANONICAL_ID_KEYS: Record<string, string> = {
  'imdb': 'imdb',
  'tmdb': 'tmdb',
  'tvdb': 'tvdb',
}

// Uniform toLowerCase() is safe for all key families: iTunes atoms (©nam, ©ART)
// are stored lowercase in TAG_KEY_MAP, and toLowerCase() preserves the © character.
export function normalizeTagKey (key: string): string | undefined {
  return TAG_KEY_MAP[key.toLowerCase()]
}

export function parseYear (value: string): number | undefined {
  const match = value.match(/^(\d{4})/)
  if (!match) {
    return undefined
  }
  const year = parseInt(match[1], 10)
  if (year < 1800 || year > 2200) {
    return undefined
  }
  return year
}

/**
 * Parse a genre string into a list. m4b producers conventionally pack multiple
 * genres into a single tag separated by colons (e.g. "Fiction:Sci-Fi:Dystopian").
 * Single-value tags ("Sci-Fi") return a one-element list.
 */
export function parseGenres (value: string): string[] {
  return value.split(':').map(s => s.trim()).filter(Boolean)
}

export function extractCanonicalIds (tags: Record<string, string>): ExternalId[] {
  const ids: ExternalId[] = []
  for (const [key, value] of Object.entries(tags)) {
    const provider = CANONICAL_ID_KEYS[key.toLowerCase()]
    if (provider && value) {
      ids.push({
        provider,
        id: normalizeCanonicalId(provider, value),
      })
    }
  }
  return ids
}

// Plex-tagged files store TMDb IDs in the agent format `tv/10283` or
// `movie/12345`. The library context already disambiguates media type, so
// strip the prefix at the boundary and persist the raw numeric id — keeps
// every downstream consumer free of the parsing quirk.
function normalizeCanonicalId (provider: string, value: string): string {
  if (provider === 'tmdb') {
    return value.replace(/^(?:tv|movies?)\//i, '')
  }
  return value
}

/** Look up the first non-empty value among `candidates` (case-insensitive). */
function pickFirst (tags: Record<string, string>, candidates: string[]): string | undefined {
  const lowered: Record<string, string> = {}
  for (const [k, v] of Object.entries(tags)) {
    if (v) {
      lowered[k.toLowerCase()] = v
    }
  }
  for (const key of candidates) {
    const value = lowered[key.toLowerCase()]
    if (value) {
      return value
    }
  }
  return undefined
}

export interface NormalizedTags {
  title?: string
  year?: number
  genres?: string[]
  canonicalIds: ExternalId[]
  fields: Record<string, unknown>
}

export function normalizeTags (tags: Record<string, string>): NormalizedTags {
  const result: NormalizedTags = {
    canonicalIds: extractCanonicalIds(tags),
    fields: {},
  }

  // Author: prefer album_artist (the audiobook m4b convention) over artist.
  // `artist` is also written as a backward-compatible alias so non-audiobook
  // consumers that already read it keep working.
  const author = pickFirst(tags, AUTHOR_KEYS)
  if (author) {
    result.fields.author = author
    result.fields.artist = author
  }

  // Narrator: m4b stores this in the composer atom (©wrt).
  const narrator = pickFirst(tags, NARRATOR_KEYS)
  if (narrator) {
    result.fields.narrator = narrator
  }

  const seen = new Set<string>()

  for (const [key, value] of Object.entries(tags)) {
    if (!value) {
      continue
    }
    const lk = key.toLowerCase()
    if (HANDLED_OUTSIDE_MAP.has(lk)) {
      continue
    }

    const normalized = TAG_KEY_MAP[lk]
    if (!normalized || seen.has(normalized)) {
      continue
    }
    seen.add(normalized)

    if (normalized === 'title') {
      result.title = value
    } else if (normalized === 'year') {
      result.year = parseYear(value)
    } else if (normalized === 'genre') {
      const list = parseGenres(value)
      if (list.length > 0) {
        result.genres = list
      }
    } else {
      result.fields[normalized] = value
    }
  }

  return result
}
