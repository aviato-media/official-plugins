import { describe, expect, it } from 'bun:test'

import type { MediaFileStem } from '../utils.js'
import {
  detectLanguage,
  formatForCodec,
  getSubtitleFormat,
  getVideoStem,
  matchSubtitleToMediaFile,
} from '../utils.js'

describe('getVideoStem', () => {
  it('extracts stem from normal file', () => {
    expect(getVideoStem('movie.mkv')).toBe('movie')
  })

  it('returns filename when no extension', () => {
    expect(getVideoStem('README')).toBe('README')
  })

  it('handles multiple dots', () => {
    expect(getVideoStem('movie.2024.directors.cut.mkv')).toBe('movie.2024.directors.cut')
  })

  it('handles dotfile (leading dot)', () => {
    expect(getVideoStem('.hidden')).toBe('.hidden')
  })

  it('handles dotfile with extension', () => {
    expect(getVideoStem('.hidden.mkv')).toBe('.hidden')
  })
})

describe('detectLanguage', () => {
  it('returns und for matching stem with no language suffix', () => {
    expect(detectLanguage('movie.srt', 'movie')).toBe('und')
  })

  it('detects en language code', () => {
    expect(detectLanguage('movie.en.srt', 'movie')).toBe('en')
  })

  it('detects ja language code', () => {
    expect(detectLanguage('movie.ja.srt', 'movie')).toBe('ja')
  })

  it('detects forced subtitle suffix', () => {
    expect(detectLanguage('movie.ja.forced.ass', 'movie')).toBe('ja.forced')
  })

  it('returns und when stem does not align with the subtitle filename', () => {
    expect(detectLanguage('other.en.srt', 'movie')).toBe('und')
  })
})

describe('getSubtitleFormat', () => {
  it('detects srt format', () => {
    expect(getSubtitleFormat('movie.srt')).toBe('srt')
  })

  it('detects ass format', () => {
    expect(getSubtitleFormat('movie.ass')).toBe('ass')
  })

  it('detects vtt format', () => {
    expect(getSubtitleFormat('movie.vtt')).toBe('vtt')
  })

  it('detects ssa format', () => {
    expect(getSubtitleFormat('movie.ssa')).toBe('ssa')
  })

  it('detects sub format', () => {
    expect(getSubtitleFormat('movie.sub')).toBe('sub')
  })

  it('defaults to srt for unknown extension', () => {
    expect(getSubtitleFormat('movie.txt')).toBe('srt')
  })
})

describe('matchSubtitleToMediaFile', () => {
  const mediaFiles: MediaFileStem[] = [
    {
      uri: '/media/Movie.mkv',
      stem: 'Movie',
    },
  ]

  it('matches by exact stem', () => {
    expect(matchSubtitleToMediaFile('Movie.srt', mediaFiles)).toBe('/media/Movie.mkv')
  })

  it('matches with language suffix', () => {
    expect(matchSubtitleToMediaFile('Movie.en.srt', mediaFiles)).toBe('/media/Movie.mkv')
  })

  it('returns undefined when no stem matches', () => {
    expect(matchSubtitleToMediaFile('Other.srt', mediaFiles)).toBeUndefined()
  })

  it('returns undefined for an empty media file list', () => {
    expect(matchSubtitleToMediaFile('Movie.srt', [])).toBeUndefined()
  })

  it('prefers the longer stem when ambiguous prefixes exist', () => {
    const multi: MediaFileStem[] = [
      {
        uri: '/media/Movie.mkv',
        stem: 'Movie',
      },
      {
        uri: '/media/Movie - Directors Cut.mkv',
        stem: 'Movie - Directors Cut',
      },
    ]
    expect(matchSubtitleToMediaFile('Movie - Directors Cut.en.srt', multi))
      .toBe('/media/Movie - Directors Cut.mkv')
  })

  it('falls back to a shorter stem when the longer one does not match', () => {
    const multi: MediaFileStem[] = [
      {
        uri: '/media/Movie.mkv',
        stem: 'Movie',
      },
      {
        uri: '/media/Movie - Directors Cut.mkv',
        stem: 'Movie - Directors Cut',
      },
    ]
    expect(matchSubtitleToMediaFile('Movie.en.srt', multi)).toBe('/media/Movie.mkv')
  })
})

describe('formatForCodec', () => {
  it('maps subrip to srt', () => {
    expect(formatForCodec('subrip')).toBe('srt')
  })

  it('maps ssa to ass', () => {
    expect(formatForCodec('ssa')).toBe('ass')
  })

  it('maps webvtt to vtt', () => {
    expect(formatForCodec('webvtt')).toBe('vtt')
  })

  it('preserves PGS as pgs', () => {
    expect(formatForCodec('hdmv_pgs_subtitle')).toBe('pgs')
  })

  it('falls back to the codec name', () => {
    expect(formatForCodec('mov_text')).toBe('mov_text')
  })
})
