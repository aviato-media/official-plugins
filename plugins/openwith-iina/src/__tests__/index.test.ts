import type { OpenWithPayload } from '@aviato-media/plugin-sdk'
import { describe, expect, test } from 'bun:test'

import { buildIinaOption, processOpenWith } from '../index.js'

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

describe('openwith-iina', () => {
  test('returns option on macOS for video file', () => {
    const opt = buildIinaOption(basePayload())
    expect(opt).not.toBeNull()
    expect(opt!.id).toBe('iina')
    expect(opt!.url).toBe('iina://weblink?url=https%3A%2F%2Faviato.example%2Fapi%2Fstream%2Fdirect%2Fitem-1%3Ftoken%3Dabc')
  })

  test('returns null on non-macOS platforms', () => {
    for (const platform of ['ios', 'tvos', 'android', 'windows', 'linux', 'unknown'] as const) {
      const opt = buildIinaOption(basePayload({
        userAgent: {
          raw: platform,
          platform,
          isMobile: platform === 'ios' || platform === 'android',
          isTablet: false,
          isDesktop: platform === 'windows' || platform === 'linux',
          isTV: platform === 'tvos',
        },
      }))
      expect(opt).toBeNull()
    }
  })

  test('returns null for non-video files', () => {
    const opt = buildIinaOption(basePayload({
      file: {
        id: 'f',
        uri: 'file:///m/song.mp3',
        filename: 'song.mp3',
        extension: 'mp3',
        mimeType: 'audio/mpeg',
        fileInfo: null,
      },
    }))
    expect(opt).toBeNull()
  })

  test('processOpenWith appends to openWith array on macOS', () => {
    const result = processOpenWith(basePayload())
    expect(result).not.toBeNull()
    expect(result!.openWith).toHaveLength(1)
    expect(result!.openWith[0].id).toBe('iina')
  })
})
