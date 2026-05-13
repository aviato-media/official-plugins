import { describe, expect, test } from 'bun:test'

import { extractCanonicalIds, normalizeTagKey, normalizeTags, parseGenres, parseYear } from '../tags.js'

describe('normalizeTagKey', () => {
  test('maps iTunes atom keys for non-author fields', () => {
    expect(normalizeTagKey('©nam')).toBe('title')
    expect(normalizeTagKey('©day')).toBe('year')
    expect(normalizeTagKey('©gen')).toBe('genre')
    expect(normalizeTagKey('©alb')).toBe('album')
  })

  test('maps generic keys case-insensitively', () => {
    expect(normalizeTagKey('title')).toBe('title')
    expect(normalizeTagKey('Title')).toBe('title')
    expect(normalizeTagKey('TITLE')).toBe('title')
    expect(normalizeTagKey('DATE')).toBe('year')
    expect(normalizeTagKey('date')).toBe('year')
    expect(normalizeTagKey('year')).toBe('year')
    expect(normalizeTagKey('GENRE')).toBe('genre')
  })

  test('maps description variants', () => {
    expect(normalizeTagKey('description')).toBe('description')
    expect(normalizeTagKey('DESCRIPTION')).toBe('description')
    expect(normalizeTagKey('comment')).toBe('description')
    expect(normalizeTagKey('SUMMARY')).toBe('description')
    expect(normalizeTagKey('desc')).toBe('description')
    expect(normalizeTagKey('ldes')).toBe('description')
  })

  test('maps media kind variants', () => {
    expect(normalizeTagKey('stik')).toBe('mediaKind')
    expect(normalizeTagKey('media_type')).toBe('mediaKind')
  })

  test('maps encoder', () => {
    expect(normalizeTagKey('encoder')).toBe('encoder')
    expect(normalizeTagKey('ENCODER')).toBe('encoder')
  })

  test('returns undefined for unknown keys', () => {
    expect(normalizeTagKey('unknown_tag')).toBeUndefined()
    expect(normalizeTagKey('creation_time')).toBeUndefined()
    expect(normalizeTagKey('handler_name')).toBeUndefined()
  })
})

describe('parseYear', () => {
  test('extracts year from ISO date string', () => {
    expect(parseYear('2024-03-15')).toBe(2024)
    expect(parseYear('2024-03-15T10:30:00Z')).toBe(2024)
  })

  test('extracts plain year', () => {
    expect(parseYear('2024')).toBe(2024)
    expect(parseYear('1982')).toBe(1982)
  })

  test('returns undefined for invalid values', () => {
    expect(parseYear('')).toBeUndefined()
    expect(parseYear('not-a-date')).toBeUndefined()
    expect(parseYear('123')).toBeUndefined()
    expect(parseYear('99999')).toBeUndefined()
  })
})

describe('parseGenres', () => {
  test('splits colon-separated audiobook genres', () => {
    expect(parseGenres('Fiction:Science Fiction:Dystopian')).toEqual([
      'Fiction',
      'Science Fiction',
      'Dystopian',
    ])
  })

  test('returns single-element list for plain values', () => {
    expect(parseGenres('Sci-Fi')).toEqual(['Sci-Fi'])
  })

  test('trims whitespace and drops empties', () => {
    expect(parseGenres(' Fiction : Sci-Fi : ')).toEqual(['Fiction', 'Sci-Fi'])
  })

  test('returns empty list for empty input', () => {
    expect(parseGenres('')).toEqual([])
  })
})

describe('extractCanonicalIds', () => {
  test('extracts IMDb ID from tags', () => {
    const ids = extractCanonicalIds({
      IMDB: 'tt0083658',
    })
    expect(ids).toEqual([{
      provider: 'imdb',
      id: 'tt0083658',
    }])
  })

  test('extracts TMDb ID from tags', () => {
    const ids = extractCanonicalIds({
      TMDB: '78',
    })
    expect(ids).toEqual([{
      provider: 'tmdb',
      id: '78',
    }])
  })

  test('strips Plex agent prefix from TMDb IDs', () => {
    expect(extractCanonicalIds({
      TMDB: 'tv/10283',
    })).toEqual([{
      provider: 'tmdb',
      id: '10283',
    }])
    expect(extractCanonicalIds({
      TMDB: 'movie/27205',
    })).toEqual([{
      provider: 'tmdb',
      id: '27205',
    }])
  })

  test('extracts TVDB ID from tags', () => {
    const ids = extractCanonicalIds({
      TVDB: '12345',
    })
    expect(ids).toEqual([{
      provider: 'tvdb',
      id: '12345',
    }])
  })

  test('extracts multiple IDs', () => {
    const ids = extractCanonicalIds({
      IMDB: 'tt0083658',
      TMDB: '78',
    })
    expect(ids).toHaveLength(2)
    expect(ids).toContainEqual({
      provider: 'imdb',
      id: 'tt0083658',
    })
    expect(ids).toContainEqual({
      provider: 'tmdb',
      id: '78',
    })
  })

  test('handles case variations', () => {
    const ids = extractCanonicalIds({
      IMDb: 'tt0083658',
      TMDb: '78',
      TVDb: '12345',
    })
    expect(ids).toHaveLength(3)
  })

  test('returns empty array when no IDs found', () => {
    const ids = extractCanonicalIds({
      title: 'some movie',
    })
    expect(ids).toEqual([])
  })
})

describe('normalizeTags', () => {
  test('normalizes a full set of MP4 tags (movie use case)', () => {
    const result = normalizeTags({
      '©nam': 'Blade Runner',
      '©day': '1982-06-25',
      '©gen': 'Sci-Fi',
      '©ART': 'Ridley Scott',
      'desc': 'A blade runner must pursue and terminate four replicants.',
      'encoder': 'HandBrake',
    })

    expect(result.title).toBe('Blade Runner')
    expect(result.year).toBe(1982)
    expect(result.canonicalIds).toEqual([])
    expect(result.genres).toEqual(['Sci-Fi'])
    expect(result.fields.artist).toBe('Ridley Scott')
    expect(result.fields.author).toBe('Ridley Scott')
    expect(result.fields.description).toBe('A blade runner must pursue and terminate four replicants.')
    expect(result.fields.encoder).toBe('HandBrake')
  })

  test('extracts audiobook (m4b) metadata: author, narrator, description, genres', () => {
    const result = normalizeTags({
      '©nam': 'The Three-Body Problem',
      '©ART': 'Cixin Liu',
      'aart': 'Cixin Liu',
      '©wrt': 'Luke Daniels',
      'comment': 'Earth makes contact with a hostile civilization.',
      '©gen': 'Fiction:Science Fiction:Hard SF',
    })

    expect(result.title).toBe('The Three-Body Problem')
    expect(result.fields.author).toBe('Cixin Liu')
    expect(result.fields.narrator).toBe('Luke Daniels')
    expect(result.fields.description).toBe('Earth makes contact with a hostile civilization.')
    expect(result.genres).toEqual(['Fiction', 'Science Fiction', 'Hard SF'])
  })

  test('album_artist takes precedence over artist when both are present', () => {
    const result = normalizeTags({
      '©ART': 'Narrator Name',
      'aart': 'Author Name',
    })
    expect(result.fields.author).toBe('Author Name')
    expect(result.fields.artist).toBe('Author Name')
  })

  test('falls back to artist when no album_artist is set', () => {
    const result = normalizeTags({
      '©ART': 'Ridley Scott',
    })
    expect(result.fields.author).toBe('Ridley Scott')
    expect(result.fields.artist).toBe('Ridley Scott')
  })

  test('normalizes generic Matroska album_artist key', () => {
    const result = normalizeTags({
      ALBUM_ARTIST: 'Author Name',
    })
    expect(result.fields.author).toBe('Author Name')
  })

  test('normalizes MKV tags with canonical IDs', () => {
    const result = normalizeTags({
      TITLE: 'Blade Runner',
      DATE_RELEASED: '1982',
      GENRE: 'Sci-Fi',
      IMDB: 'tt0083658',
      TMDB: '78',
    })

    expect(result.title).toBe('Blade Runner')
    expect(result.year).toBe(1982)
    expect(result.genres).toEqual(['Sci-Fi'])
    expect(result.canonicalIds).toContainEqual({
      provider: 'imdb',
      id: 'tt0083658',
    })
    expect(result.canonicalIds).toContainEqual({
      provider: 'tmdb',
      id: '78',
    })
  })

  test('handles empty tags', () => {
    const result = normalizeTags({})
    expect(result.title).toBeUndefined()
    expect(result.year).toBeUndefined()
    expect(result.genres).toBeUndefined()
    expect(result.canonicalIds).toEqual([])
    expect(result.fields).toEqual({})
  })

  test('first value wins for duplicate normalized keys', () => {
    const result = normalizeTags({
      title: 'First Title',
      '©nam': 'Second Title',
    })
    expect(result.title).toBe('First Title')
  })
})
