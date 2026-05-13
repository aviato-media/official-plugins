import { describe, expect, it } from 'bun:test'

import { detectArtworkType, getMediaStem } from '../utils.js'

describe('getMediaStem', () => {
  it('extracts stem from simple filename', () => {
    expect(getMediaStem('movie.mkv')).toBe('movie')
  })

  it('extracts stem from filename with dots', () => {
    expect(getMediaStem('movie.2024.mkv')).toBe('movie.2024')
  })

  it('extracts stem from filename with spaces', () => {
    expect(getMediaStem('My Movie.mp4')).toBe('My Movie')
  })

  it('returns input when there is no extension', () => {
    expect(getMediaStem('noextension')).toBe('noextension')
  })
})

describe('detectArtworkType', () => {
  it('detects poster from exact name', () => {
    expect(detectArtworkType('poster.jpg', ['movie'])).toBe('poster')
  })

  it('detects fanart from exact name', () => {
    expect(detectArtworkType('fanart.jpg', ['movie'])).toBe('fanart')
  })

  it('detects banner from exact name', () => {
    expect(detectArtworkType('banner.png', ['movie'])).toBe('banner')
  })

  it('detects thumb from exact name', () => {
    expect(detectArtworkType('thumb.jpg', ['movie'])).toBe('thumb')
  })

  it('detects landscape from exact name', () => {
    expect(detectArtworkType('landscape.jpg', ['movie'])).toBe('landscape')
  })

  it('detects cover from folder.jpg', () => {
    expect(detectArtworkType('folder.jpg', ['movie'])).toBe('cover')
  })

  it('detects cover from cover.png', () => {
    expect(detectArtworkType('cover.png', ['movie'])).toBe('cover')
  })

  it('detects type from stem-prefixed name', () => {
    expect(detectArtworkType('Inception-poster.jpg', ['Inception'])).toBe('poster')
  })

  it('detects fanart from stem-prefixed name', () => {
    expect(detectArtworkType('Inception-fanart.jpg', ['Inception'])).toBe('fanart')
  })

  it('assumes poster for stem-only match', () => {
    expect(detectArtworkType('Inception.jpg', ['Inception'])).toBe('poster')
  })

  it('returns null for unrelated image', () => {
    expect(detectArtworkType('other-movie.jpg', ['Inception'])).toBeNull()
  })

  it('handles case-insensitive type keywords', () => {
    expect(detectArtworkType('Poster.JPG', ['movie'])).toBe('poster')
  })

  it('handles stem with dots and prefixed type', () => {
    expect(detectArtworkType('Movie.2024-poster.jpg', ['Movie.2024'])).toBe('poster')
  })

  it('matches against any of the supplied stems', () => {
    expect(detectArtworkType('S01E01-poster.jpg', ['Pilot', 'S01E01'])).toBe('poster')
  })

  it('rejects non-image extensions', () => {
    expect(detectArtworkType('poster.txt', ['movie'])).toBeNull()
    expect(detectArtworkType('Inception.nfo', ['Inception'])).toBeNull()
  })

  it('matches folder artwork even when the stem list is empty', () => {
    expect(detectArtworkType('folder.jpg', [])).toBe('cover')
  })
})
