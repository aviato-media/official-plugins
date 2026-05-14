import type { OpenWithPayload } from '@aviato-media/plugin-sdk'
import { describe, expect, test } from 'bun:test'

import { buildVlcOption, processOpenWith } from '../index.js'

function basePayload (overrides: Partial<OpenWithPayload> = {}): OpenWithPayload {
  return {
    itemId: 'item-1',
    item: {
      id: 'item-1',
      title: 'Movie',
      libraryId: 'lib-1',
    },
    file: {
      id: 'file-1',
      uri: 'file:///m/Movie.mkv',
      filename: 'Movie.mkv',
      extension: 'mkv',
      mimeType: 'video/x-matroska',
      fileInfo: null,
    },
    streamUrl: 'https://aviato.example/api/stream/direct/item-1?token=abc',
    subtitles: [],
    userAgent: {
      raw: 'desktop',
      platform: 'macos',
      isMobile: false,
      isTablet: false,
      isDesktop: true,
      isTV: false,
    },
    openWith: [],
    ...overrides,
  }
}

describe('openwith-vlc', () => {
  test('returns null for non-video items', () => {
    const result = buildVlcOption(basePayload({
      file: {
        id: 'f',
        uri: 'file:///m/book.epub',
        filename: 'book.epub',
        extension: 'epub',
        mimeType: 'application/epub+zip',
        fileInfo: null,
      },
    }))
    expect(result).toBeNull()
  })

  test('builds vlc:// url with the stream URL percent-encoded on macOS', () => {
    const opt = buildVlcOption(basePayload())
    expect(opt).not.toBeNull()
    expect(opt!.url).toBe('vlc://https%3A%2F%2Faviato.example%2Fapi%2Fstream%2Fdirect%2Fitem-1%3Ftoken%3Dabc')
    expect(opt!.id).toBe('vlc')
    expect(opt!.label).toBe('VLC')
  })

  test('uses vlc:// on Windows and Linux too', () => {
    for (const platform of ['windows', 'linux'] as const) {
      const opt = buildVlcOption(basePayload({
        userAgent: {
          raw: platform,
          platform,
          isMobile: false,
          isTablet: false,
          isDesktop: true,
          isTV: false,
        },
      }))
      expect(opt).not.toBeNull()
      expect(opt!.url.startsWith('vlc://')).toBe(true)
      expect(opt!.url).toBe('vlc://https%3A%2F%2Faviato.example%2Fapi%2Fstream%2Fdirect%2Fitem-1%3Ftoken%3Dabc')
    }
  })

  test('encodes characters in the stream URL that would otherwise break vlc://', () => {
    const opt = buildVlcOption(basePayload({
      streamUrl: 'https://aviato.example/api/stream/direct/My Movie?token=a#b',
    }))
    expect(opt!.url).toBe('vlc://https%3A%2F%2Faviato.example%2Fapi%2Fstream%2Fdirect%2FMy%20Movie%3Ftoken%3Da%23b')
    expect(opt!.url).not.toContain(' ')
    expect(opt!.url).not.toContain('#b')
  })

  test('builds intent:// url targeting org.videolan.vlc on Android', () => {
    const opt = buildVlcOption(basePayload({
      userAgent: {
        raw: 'android',
        platform: 'android',
        isMobile: true,
        isTablet: false,
        isDesktop: false,
        isTV: false,
      },
    }))
    expect(opt).not.toBeNull()
    expect(opt!.url).toBe('intent://aviato.example/api/stream/direct/item-1?token=abc#Intent;scheme=https;package=org.videolan.vlc;type=video/*;end')
    expect(opt!.description).toBe('Open in VLC for Android')
  })

  test('Android intent url preserves http scheme when stream is plain http', () => {
    const opt = buildVlcOption(basePayload({
      streamUrl: 'http://192.168.1.10:8080/stream/item-1',
      userAgent: {
        raw: 'android',
        platform: 'android',
        isMobile: true,
        isTablet: false,
        isDesktop: false,
        isTV: false,
      },
    }))
    expect(opt!.url).toBe('intent://192.168.1.10:8080/stream/item-1#Intent;scheme=http;package=org.videolan.vlc;type=video/*;end')
  })

  test('returns null on unknown platform rather than surfacing a broken entry', () => {
    const opt = buildVlcOption(basePayload({
      userAgent: {
        raw: 'wat',
        platform: 'unknown',
        isMobile: false,
        isTablet: false,
        isDesktop: false,
        isTV: false,
      },
    }))
    expect(opt).toBeNull()
  })

  test('builds vlc-x-callback url on iOS', () => {
    const opt = buildVlcOption(basePayload({
      userAgent: {
        raw: 'ios',
        platform: 'ios',
        isMobile: true,
        isTablet: false,
        isDesktop: false,
        isTV: false,
      },
    }))
    expect(opt).not.toBeNull()
    expect(opt!.url.startsWith('vlc-x-callback://x-callback-url/stream?')).toBe(true)
    expect(opt!.url).toContain('url=https%3A%2F%2Faviato.example%2Fapi%2Fstream%2Fdirect%2Fitem-1%3Ftoken%3Dabc')
  })

  test('attaches first external subtitle as &sub on iOS', () => {
    const opt = buildVlcOption(basePayload({
      userAgent: {
        raw: 'ios',
        platform: 'ios',
        isMobile: true,
        isTablet: false,
        isDesktop: false,
        isTV: false,
      },
      subtitles: [
        {
          id: 's1',
          language: 'en',
          label: 'English',
          format: 'srt',
          type: 'external',
          isDefault: false,
          isForced: false,
          url: 'https://aviato.example/api/subtitles/s1/file?token=abc',
        },
      ],
    }))
    expect(opt!.url).toContain('sub=https%3A%2F%2Faviato.example%2Fapi%2Fsubtitles%2Fs1%2Ffile%3Ftoken%3Dabc')
  })

  test('prefers default external subtitle over forced over arbitrary', () => {
    const opt = buildVlcOption(basePayload({
      userAgent: {
        raw: 'ios',
        platform: 'ios',
        isMobile: true,
        isTablet: false,
        isDesktop: false,
        isTV: false,
      },
      subtitles: [
        {
          id: 's-other',
          language: 'fr',
          label: 'French',
          format: 'srt',
          type: 'external',
          isDefault: false,
          isForced: false,
          url: 'https://example/s-other',
        },
        {
          id: 's-forced',
          language: 'en',
          label: 'English',
          format: 'srt',
          type: 'external',
          isDefault: false,
          isForced: true,
          url: 'https://example/s-forced',
        },
        {
          id: 's-default',
          language: 'en',
          label: 'English',
          format: 'srt',
          type: 'external',
          isDefault: true,
          isForced: false,
          url: 'https://example/s-default',
        },
      ],
    }))
    expect(opt!.url).toContain('sub=https%3A%2F%2Fexample%2Fs-default')
  })

  test('skips embedded subtitles even if listed', () => {
    const opt = buildVlcOption(basePayload({
      userAgent: {
        raw: 'ios',
        platform: 'ios',
        isMobile: true,
        isTablet: false,
        isDesktop: false,
        isTV: false,
      },
      subtitles: [
        {
          id: 's-embed',
          language: 'en',
          label: 'English',
          format: 'srt',
          type: 'embedded',
          isDefault: true,
          isForced: false,
        },
      ],
    }))
    expect(opt!.url).not.toContain('sub=')
  })

  test('processOpenWith appends to openWith array and returns mutated payload', () => {
    const result = processOpenWith(basePayload())
    expect(result).not.toBeNull()
    expect(result!.openWith).toHaveLength(1)
    expect(result!.openWith[0].id).toBe('vlc')
  })

  test('processOpenWith returns null when the item is not a video', () => {
    const result = processOpenWith(basePayload({
      file: {
        id: 'f',
        uri: 'file:///m/song.mp3',
        filename: 'song.mp3',
        extension: 'mp3',
        mimeType: 'audio/mpeg',
        fileInfo: null,
      },
    }))
    expect(result).toBeNull()
  })
})
