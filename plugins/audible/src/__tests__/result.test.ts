import { describe, expect, test } from 'bun:test'

import type { AudnexBook } from '../audnex.js'
import { __testing, isValidAsin, isValidRegion } from '../audnex.js'
import { buildIndexResult, buildSearchCandidate, cleanSeriesSequence } from '../result.js'

// ── cleanSeriesSequence ──────────────────────────────
// Ports the seven cases from audiobookshelf's
// test/server/providers/Audible.test.js verbatim.

describe('cleanSeriesSequence', () => {
  test('returns empty string for empty input', () => {
    expect(cleanSeriesSequence('')).toBe('')
    expect(cleanSeriesSequence(null)).toBe('')
    expect(cleanSeriesSequence(undefined)).toBe('')
  })

  test('returns sequence as-is when no number is present', () => {
    expect(cleanSeriesSequence('part a')).toBe('part a')
  })

  test('returns plain integer unchanged', () => {
    expect(cleanSeriesSequence('2')).toBe('2')
  })

  test('returns decimal number unchanged', () => {
    expect(cleanSeriesSequence('2.3')).toBe('2.3')
  })

  test('extracts integer from "Book 1"', () => {
    expect(cleanSeriesSequence('Book 1')).toBe('1')
  })

  test('extracts decimal from "Book 1.5"', () => {
    expect(cleanSeriesSequence('Book 1.5')).toBe('1.5')
  })

  test('extracts leading-decimal from "Book .5"', () => {
    expect(cleanSeriesSequence('Book .5')).toBe('.5')
  })

  test('handles trailing prose like "2, Dramatized Adaptation"', () => {
    expect(cleanSeriesSequence('2, Dramatized Adaptation')).toBe('2')
  })
})

// ── isValidAsin / isValidRegion ──────────────────────

describe('isValidAsin', () => {
  test('accepts 10-character uppercase alphanumeric', () => {
    expect(isValidAsin('B0BCJZL3DM')).toBe(true)
    expect(isValidAsin('1234567890')).toBe(true)
  })

  test('rejects too-short or too-long input', () => {
    expect(isValidAsin('B0BCJ')).toBe(false)
    expect(isValidAsin('B0BCJZL3DM1')).toBe(false)
  })

  test('rejects lowercase / mixed-case input', () => {
    expect(isValidAsin('b0bcjzl3dm')).toBe(false)
  })

  test('rejects non-alphanumeric characters', () => {
    expect(isValidAsin('B0BCJ-L3DM')).toBe(false)
    expect(isValidAsin('')).toBe(false)
    expect(isValidAsin(undefined)).toBe(false)
  })
})

describe('isValidRegion', () => {
  test('accepts known regions', () => {
    expect(isValidRegion('us')).toBe(true)
    expect(isValidRegion('uk')).toBe(true)
    expect(isValidRegion('jp')).toBe(true)
  })

  test('rejects unknown regions', () => {
    expect(isValidRegion('xx')).toBe(false)
    expect(isValidRegion('')).toBe(false)
    expect(isValidRegion(undefined)).toBe(false)
  })
})

// ── URL builders ─────────────────────────────────────

describe('buildAsinUrl', () => {
  test('builds audnex URL with no region', () => {
    expect(__testing.buildAsinUrl('B0BCJZL3DM'))
      .toBe('https://api.audnex.us/books/B0BCJZL3DM')
  })

  test('appends region when provided', () => {
    expect(__testing.buildAsinUrl('B0BCJZL3DM', 'uk'))
      .toBe('https://api.audnex.us/books/B0BCJZL3DM?region=uk')
  })
})

describe('buildCatalogSearchUrl', () => {
  test('builds .com URL by default', () => {
    const url = __testing.buildCatalogSearchUrl('Project Hail Mary', 'Andy Weir', 'us')
    expect(url).toContain('https://api.audible.com/1.0/catalog/products')
    expect(url).toContain('num_results=10')
    expect(url).toContain('products_sort_by=Relevance')
    expect(url).toContain('title=Project+Hail+Mary')
    expect(url).toContain('author=Andy+Weir')
  })

  test('uses regional TLDs', () => {
    expect(__testing.buildCatalogSearchUrl('Foo', undefined, 'uk'))
      .toContain('https://api.audible.co.uk/')
    expect(__testing.buildCatalogSearchUrl('Foo', undefined, 'jp'))
      .toContain('https://api.audible.co.jp/')
    expect(__testing.buildCatalogSearchUrl('Foo', undefined, 'au'))
      .toContain('https://api.audible.com.au/')
  })

  test('omits author when not provided', () => {
    const url = __testing.buildCatalogSearchUrl('Foo', undefined, 'us')
    expect(url).not.toContain('author=')
  })
})

// ── buildIndexResult ─────────────────────────────────

const BOOK_FIXTURE: AudnexBook = {
  asin: 'B0BCJZL3DM',
  title: 'Project Hail Mary',
  subtitle: 'A Novel',
  authors: [{
    name: 'Andy Weir',
    asin: 'B00G0WYI70',
  }],
  narrators: [{ name: 'Ray Porter' }],
  publisherName: 'Audible Studios',
  summary: 'A lone astronaut...',
  releaseDate: '2021-05-04',
  image: 'https://m.media-amazon.com/images/I/abc.jpg',
  isbn: '9780593135204',
  language: 'english',
  formatType: 'unabridged',
  runtimeLengthMin: 970,
  genres: [
    {
      name: 'Science Fiction',
      type: 'genre',
    },
    {
      name: 'Space Opera',
      type: 'tag',
    },
    {
      name: 'Science Fiction',
      type: 'tag',
    }, // dupe
  ],
  seriesPrimary: {
    name: 'Hail Mary',
    position: 'Book 1',
    asin: 'SERIES123',
  },
}

describe('buildIndexResult', () => {
  test('maps core book metadata into the IndexResult', () => {
    const result = buildIndexResult({
      book: BOOK_FIXTURE,
      region: 'us',
    })

    expect(result.success).toBe(true)
    expect(result.metadata?.title).toBe('Project Hail Mary')
    expect(result.metadata?.fields.subtitle).toBe('A Novel')
    expect(result.metadata?.fields.author).toBe('Andy Weir')
    expect(result.metadata?.fields.narrator).toBe('Ray Porter')
    expect(result.metadata?.fields.publisher).toBe('Audible Studios')
    expect(result.metadata?.fields.year).toBe(2021)
    expect(result.metadata?.fields.description).toBe('A lone astronaut...')
    expect(result.metadata?.fields.duration).toBe(970 * 60)
    expect(result.metadata?.fields.formatType).toBe('unabridged')
    expect(result.metadata?.fields.abridged).toBe(false)
  })

  test('emits ASIN as a canonical id with audible region URL', () => {
    const result = buildIndexResult({
      book: BOOK_FIXTURE,
      region: 'us',
    })
    const audible = result.metadata?.canonicalIds?.find(c => c.provider === 'audible')
    expect(audible).toBeDefined()
    expect(audible?.id).toBe('B0BCJZL3DM')
    expect(audible?.url).toBe('https://www.audible.com/pd/B0BCJZL3DM')
  })

  test('emits ISBN as a separate canonical id when present', () => {
    const result = buildIndexResult({
      book: BOOK_FIXTURE,
      region: 'us',
    })
    const isbn = result.metadata?.canonicalIds?.find(c => c.provider === 'isbn')
    expect(isbn?.id).toBe('9780593135204')
  })

  test('uses region-specific Audible URLs', () => {
    const result = buildIndexResult({
      book: BOOK_FIXTURE,
      region: 'uk',
    })
    const audible = result.metadata?.canonicalIds?.find(c => c.provider === 'audible')
    expect(audible?.url).toBe('https://www.audible.co.uk/pd/B0BCJZL3DM')
  })

  test('emits primary series as a series entity with audible canonical ID', () => {
    const result = buildIndexResult({
      book: BOOK_FIXTURE,
      region: 'us',
    })
    const seriesEntities = result.metadata?.entities?.filter(e => e.entityType === 'series')
    expect(seriesEntities).toHaveLength(1)
    expect(seriesEntities?.[0].name).toBe('Hail Mary')
    expect(seriesEntities?.[0].externalIds?.[0].provider).toBe('audible')
    expect(seriesEntities?.[0].externalIds?.[0].id).toBe('SERIES123')
    expect(seriesEntities?.[0].externalIds?.[0].url).toBe('https://www.audible.com/series/SERIES123')
    expect(seriesEntities?.[0].linkMetadata?.sequence).toBe(1)
  })

  test('emits both primary and secondary series when present', () => {
    const result = buildIndexResult({
      book: {
        ...BOOK_FIXTURE,
        seriesSecondary: {
          name: 'Andy Weir Universe',
          position: '3',
        },
      },
      region: 'us',
    })
    const seriesEntities = result.metadata?.entities?.filter(e => e.entityType === 'series')
    expect(seriesEntities).toHaveLength(2)
    expect(seriesEntities?.[1].name).toBe('Andy Weir Universe')
    expect(seriesEntities?.[1].sortOrder).toBe(1)
  })

  test('writes seriesPrimary into the series field with position', () => {
    const result = buildIndexResult({
      book: BOOK_FIXTURE,
      region: 'us',
    })
    expect(result.metadata?.fields.series).toBe('Hail Mary')
    expect(result.metadata?.fields.seriesPosition).toBe(1)
  })

  test('parses leading-decimal series position to a numeric value', () => {
    const result = buildIndexResult({
      book: {
        ...BOOK_FIXTURE,
        seriesPrimary: {
          name: 'Hail Mary',
          position: 'Book .5',
        },
      },
      region: 'us',
    })
    expect(result.metadata?.fields.seriesPosition).toBe(0.5)
    const series = result.metadata?.entities?.find(e => e.entityType === 'series')
    expect(series?.linkMetadata?.sequence).toBe(0.5)
  })

  test('combines genres and tags into a single deduped genres list', () => {
    const result = buildIndexResult({
      book: BOOK_FIXTURE,
      region: 'us',
    })
    expect(result.metadata?.fields.genres).toEqual(['Science Fiction', 'Space Opera'])
  })

  test('emits author entity with audible ASIN externalId', () => {
    const result = buildIndexResult({
      book: BOOK_FIXTURE,
      region: 'us',
    })
    const authorEntity = result.metadata?.entities?.find(e => e.role === 'author')
    expect(authorEntity?.entityType).toBe('person')
    expect(authorEntity?.name).toBe('Andy Weir')
    expect(authorEntity?.externalIds?.[0]).toEqual({
      provider: 'audible',
      id: 'B00G0WYI70',
    })
  })

  test('emits poster artwork from book image', () => {
    const result = buildIndexResult({
      book: BOOK_FIXTURE,
      region: 'us',
    })
    expect(result.metadata?.artwork).toEqual([{
      type: 'poster',
      url: 'https://m.media-amazon.com/images/I/abc.jpg',
      aspect: 'square',
    }])
  })

  test('handles missing optional fields without throwing', () => {
    const minimal: AudnexBook = {
      asin: 'B0000ABCDE',
      title: 'Minimal',
    }
    const result = buildIndexResult({
      book: minimal,
      region: 'us',
    })
    expect(result.success).toBe(true)
    expect(result.metadata?.title).toBe('Minimal')
    expect(result.metadata?.entities).toEqual([])
    expect(result.metadata?.fields.author).toBeUndefined()
    expect(result.metadata?.fields.series).toBeUndefined()
    expect(result.metadata?.fields.genres).toBeUndefined()
  })

  test('marks abridged formatType correctly', () => {
    const result = buildIndexResult({
      book: {
        ...BOOK_FIXTURE,
        formatType: 'abridged',
      },
      region: 'us',
    })
    expect(result.metadata?.fields.abridged).toBe(true)
  })
})

// ── buildSearchCandidate ─────────────────────────────

describe('buildSearchCandidate', () => {
  test('maps book to a search candidate with audible canonical id', () => {
    const candidate = buildSearchCandidate(BOOK_FIXTURE, 'us')
    expect(candidate.title).toBe('Project Hail Mary')
    expect(candidate.year).toBe(2021)
    expect(candidate.overview).toBe('by Andy Weir')
    expect(candidate.imageUrl).toBe('https://m.media-amazon.com/images/I/abc.jpg')
    expect(candidate.canonicalIds[0]).toEqual({
      provider: 'audible',
      id: 'B0BCJZL3DM',
      url: 'https://www.audible.com/pd/B0BCJZL3DM',
    })
  })

  test('omits overview when no authors', () => {
    const candidate = buildSearchCandidate({
      ...BOOK_FIXTURE,
      authors: undefined,
    }, 'us')
    expect(candidate.overview).toBeUndefined()
  })
})
