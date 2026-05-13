import { describe, expect, test } from 'bun:test'

import { searchMovies, searchSeries } from '../tmdb.js'

const TMDB_API_KEY = 'f35f01368f484cda58577ea1a8375e28'

describe('searchMovies (TMDB integration)', () => {
  test('returns results for "Spider-Verse"', async () => {
    const results = await searchMovies('Spider-Verse', undefined, TMDB_API_KEY, 'en-US')

    expect(results.length).toBeGreaterThan(0)

    // Should find "Spider-Man: Into the Spider-Verse"
    const spiderVerse = results.find(m => m.title.includes('Spider-Verse'))
    expect(spiderVerse).toBeDefined()
    expect(spiderVerse!.id).toBeGreaterThan(0)
    expect(spiderVerse!.overview).toBeTruthy()
    expect(spiderVerse!.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('returns results with year filter', async () => {
    const results = await searchMovies('Spider-Verse', 2018, TMDB_API_KEY, 'en-US')

    expect(results.length).toBeGreaterThan(0)

    const first = results[0]
    expect(first.title).toContain('Spider-Verse')
    expect(first.releaseDate).toContain('2018')
  })

  test('returns poster URLs', async () => {
    const results = await searchMovies('The Matrix', undefined, TMDB_API_KEY, 'en-US')

    expect(results.length).toBeGreaterThan(0)

    const withPoster = results.find(m => m.posterPath !== null)
    expect(withPoster).toBeDefined()
    expect(withPoster!.posterPath).toContain('https://image.tmdb.org')
  })

  test('returns empty array for nonsense query', async () => {
    const results = await searchMovies('xyzzy12345noresults67890', undefined, TMDB_API_KEY, 'en-US')

    expect(results).toEqual([])
  })
})

describe('searchSeries (TMDB integration)', () => {
  test('returns results for "Breaking Bad"', async () => {
    const results = await searchSeries('Breaking Bad', undefined, TMDB_API_KEY, 'en-US')

    expect(results.length).toBeGreaterThan(0)

    const bb = results.find(s => s.name.includes('Breaking Bad'))
    expect(bb).toBeDefined()
    expect(bb!.id).toBeGreaterThan(0)
    expect(bb!.overview).toBeTruthy()
  })

  test('returns results with year filter', async () => {
    const results = await searchSeries('Breaking Bad', 2008, TMDB_API_KEY, 'en-US')

    expect(results.length).toBeGreaterThan(0)

    const first = results[0]
    expect(first.name).toContain('Breaking Bad')
  })

  test('returns empty array for nonsense query', async () => {
    const results = await searchSeries('xyzzy12345noresults67890', undefined, TMDB_API_KEY, 'en-US')

    expect(results).toEqual([])
  })
})
