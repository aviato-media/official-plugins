import { describe, expect, test } from 'bun:test'

import {
  __testing,
  buildRecordingQuery,
  buildSearchAttempts,
  primaryArtistName,
} from '../musicbrainz.js'

describe('primaryArtistName', () => {
  test('returns undefined for empty input', () => {
    expect(primaryArtistName(undefined)).toBeUndefined()
    expect(primaryArtistName('')).toBeUndefined()
    expect(primaryArtistName('   ')).toBeUndefined()
  })

  test('passes through single artist', () => {
    expect(primaryArtistName('Yo-Yo Ma')).toBe('Yo-Yo Ma')
    expect(primaryArtistName('Pied Piper')).toBe('Pied Piper')
  })

  test('preserves hyphens within names', () => {
    expect(primaryArtistName('Yo-Yo Ma')).toBe('Yo-Yo Ma')
  })

  test('splits on comma', () => {
    expect(primaryArtistName('Yo-Yo Ma, Kathryn Stott')).toBe('Yo-Yo Ma')
    expect(primaryArtistName('Yo-Yo Ma, Edgar Meyer, Mark O\'Connor')).toBe('Yo-Yo Ma')
  })

  test('splits on ampersand', () => {
    expect(primaryArtistName('Simon & Garfunkel')).toBe('Simon')
    expect(primaryArtistName('Foo & Bar')).toBe('Foo')
  })

  test('splits on slash and semicolon', () => {
    expect(primaryArtistName('Foo / Bar')).toBe('Foo')
    expect(primaryArtistName('Foo; Bar')).toBe('Foo')
  })

  test('splits on feat / ft / featuring / with / vs', () => {
    expect(primaryArtistName('Drake feat. Future')).toBe('Drake')
    expect(primaryArtistName('Drake feat Future')).toBe('Drake')
    expect(primaryArtistName('Drake ft. Future')).toBe('Drake')
    expect(primaryArtistName('Drake featuring Future')).toBe('Drake')
    expect(primaryArtistName('Drake with Future')).toBe('Drake')
    expect(primaryArtistName('Drake vs. Future')).toBe('Drake')
  })

  test('does not split on feat substring inside a word', () => {
    expect(primaryArtistName('Featherweight')).toBe('Featherweight')
  })

  test('trims surrounding whitespace', () => {
    expect(primaryArtistName('  Yo-Yo Ma  ')).toBe('Yo-Yo Ma')
    expect(primaryArtistName(' Yo-Yo Ma , Kathryn Stott')).toBe('Yo-Yo Ma')
  })
})

describe('buildRecordingQuery', () => {
  test('escapes Lucene special characters', () => {
    const query = buildRecordingQuery({ title: 'Foo: Bar (Live)' })
    expect(query).toBe('recording:"Foo\\: Bar \\(Live\\)"')
  })

  test('builds title-only query', () => {
    expect(buildRecordingQuery({ title: 'Cantique' })).toBe('recording:"Cantique"')
  })

  test('builds title + artist query', () => {
    expect(buildRecordingQuery({
      title: 'Cantique',
      artist: 'Yo-Yo Ma',
    }))
      .toBe('recording:"Cantique" AND artist:"Yo\\-Yo Ma"')
  })

  test('builds full query with title + artist + release', () => {
    expect(buildRecordingQuery({
      title: 'Cantique',
      artist: 'Yo-Yo Ma',
      album: 'Merci',
    })).toBe('recording:"Cantique" AND artist:"Yo\\-Yo Ma" AND release:"Merci"')
  })
})

describe('buildSearchAttempts', () => {
  test('yields strict→looser progression with all fields', () => {
    const attempts = buildSearchAttempts({
      title: 'Cantique',
      artist: 'Yo-Yo Ma',
      album: 'Merci',
    })
    expect(attempts).toEqual([
      {
        title: 'Cantique',
        artist: 'Yo-Yo Ma',
        album: 'Merci',
      },
      {
        title: 'Cantique',
        artist: 'Yo-Yo Ma',
      },
      {
        title: 'Cantique',
        album: 'Merci',
      },
    ])
  })

  test('omits artist branch when artist missing', () => {
    expect(buildSearchAttempts({
      title: 'Cantique',
      album: 'Merci',
    }))
      .toEqual([{
        title: 'Cantique',
        album: 'Merci',
      }])
  })

  test('omits album branch when album missing', () => {
    expect(buildSearchAttempts({
      title: 'Cantique',
      artist: 'Yo-Yo Ma',
    }))
      .toEqual([{
        title: 'Cantique',
        artist: 'Yo-Yo Ma',
      }])
  })

  test('returns empty when only title (avoids unsafe broad match)', () => {
    expect(buildSearchAttempts({ title: 'Cantique' })).toEqual([])
  })
})

describe('rateLimitWait', () => {
  test('serializes concurrent callers ≥ 1100ms apart', async () => {
    __testing.resetRateLimiter()
    const timestamps: number[] = []
    const fire = async () => {
      await __testing.rateLimitWait()
      timestamps.push(Date.now())
    }
    // Kick off 3 concurrent waiters; without a queue they would all
    // proceed in the same tick. With the queue they fan out 1100ms apart.
    await Promise.all([fire(), fire(), fire()])
    expect(timestamps).toHaveLength(3)
    expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(1090)
    expect(timestamps[2] - timestamps[1]).toBeGreaterThanOrEqual(1090)
  }, 10_000)
})
