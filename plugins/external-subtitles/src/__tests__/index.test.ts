import type { Bundle } from '@aviato-media/plugin-sdk'
import { describe, expect, test } from 'bun:test'

import { processProbe } from '../index.js'

type BundleAuxiliaryFile = Bundle['files']['auxiliary'][number]
type BundleMediaFile = Bundle['files']['media'][number]

function aux (path: string, extension: string): BundleAuxiliaryFile {
  return {
    path,
    extension,
    sourcePlugin: 'fs-local',
  }
}

function media (filename: string, overrides: Partial<BundleMediaFile> = {}): BundleMediaFile {
  return {
    uri: `file:///m/${filename}`,
    path: `/m/${filename}`,
    filename,
    extension: filename.substring(filename.lastIndexOf('.')),
    size: 1024,
    type: 'primary',
    ...overrides,
  }
}

describe('processProbe (external-subtitles)', () => {
  test('emits external subtitle entries with language and format', () => {
    const bundle: Bundle = {
      files: {
        media: [media('Movie.mkv')],
        auxiliary: [
          aux('/m/Movie.en.srt', '.srt'),
          aux('/m/Movie.ja.forced.ass', '.ass'),
          aux('/m/Movie.srt', '.srt'),
        ],
      },
    }

    const result = processProbe({
      itemId: 'item-1',
      bundle,
    })

    expect(result).not.toBeNull()
    const subs = result?.bundle.subtitles ?? []
    expect(subs).toHaveLength(3)
    expect(subs).toContainEqual({
      type: 'external',
      path: '/m/Movie.en.srt',
      language: 'en',
      format: 'srt',
      source: '@aviato-media/external-subtitles',
      mediaFileUri: 'file:///m/Movie.mkv',
    })
    expect(subs).toContainEqual({
      type: 'external',
      path: '/m/Movie.ja.forced.ass',
      language: 'ja.forced',
      format: 'ass',
      source: '@aviato-media/external-subtitles',
      mediaFileUri: 'file:///m/Movie.mkv',
    })
    expect(subs).toContainEqual({
      type: 'external',
      path: '/m/Movie.srt',
      language: 'und',
      format: 'srt',
      source: '@aviato-media/external-subtitles',
      mediaFileUri: 'file:///m/Movie.mkv',
    })
  })

  test('binds subtitles to the most specific matching media file stem', () => {
    const bundle: Bundle = {
      files: {
        media: [
          media('Movie.mkv'),
          media('Movie - Directors Cut.mkv'),
        ],
        auxiliary: [
          aux('/m/Movie.en.srt', '.srt'),
          aux('/m/Movie - Directors Cut.en.srt', '.srt'),
        ],
      },
    }

    const result = processProbe({
      itemId: 'item-2',
      bundle,
    })

    const subs = result?.bundle.subtitles ?? []
    expect(subs.find(s => s.path === '/m/Movie.en.srt')?.mediaFileUri)
      .toBe('file:///m/Movie.mkv')
    expect(subs.find(s => s.path === '/m/Movie - Directors Cut.en.srt')?.mediaFileUri)
      .toBe('file:///m/Movie - Directors Cut.mkv')
  })

  test('surfaces embedded subtitle streams from fileInfo without re-running ffprobe', () => {
    const bundle: Bundle = {
      files: {
        media: [media('Movie.mkv', {
          fileInfo: {
            format: 'matroska',
            duration: 7200,
            size: 1024,
            bitrate: 1000,
            videoStreams: [],
            audioStreams: [],
            subtitleStreams: [
              {
                index: 2,
                codec: 'subrip',
                language: 'eng',
                isDefault: true,
                forced: false,
              },
              {
                index: 3,
                codec: 'ass',
                language: 'jpn',
                isDefault: false,
                forced: false,
              },
              {
                index: 4,
                codec: 'hdmv_pgs_subtitle',
                isDefault: false,
                forced: false,
              },
            ],
          },
        })],
        auxiliary: [],
      },
    }

    const result = processProbe({
      itemId: 'item-3',
      bundle,
    })

    const subs = result?.bundle.subtitles ?? []
    expect(subs).toHaveLength(3)
    expect(subs).toContainEqual({
      type: 'embedded',
      language: 'eng',
      format: 'srt',
      streamIndex: 2,
      source: '@aviato-media/external-subtitles',
      mediaFileUri: 'file:///m/Movie.mkv',
    })
    expect(subs).toContainEqual({
      type: 'embedded',
      language: 'jpn',
      format: 'ass',
      streamIndex: 3,
      source: '@aviato-media/external-subtitles',
      mediaFileUri: 'file:///m/Movie.mkv',
    })
    expect(subs).toContainEqual({
      type: 'embedded',
      language: 'und',
      format: 'pgs',
      streamIndex: 4,
      source: '@aviato-media/external-subtitles',
      mediaFileUri: 'file:///m/Movie.mkv',
    })
  })

  test('returns null when there are no auxiliary subtitles or embedded streams', () => {
    const bundle: Bundle = {
      files: {
        media: [media('Movie.mkv')],
        auxiliary: [aux('/m/notes.txt', '.txt')],
      },
    }

    const result = processProbe({
      itemId: 'item-4',
      bundle,
    })

    expect(result).toBeNull()
  })

  test('returns null when every detected subtitle is already on the bundle', () => {
    const bundle: Bundle = {
      files: {
        media: [media('Movie.mkv')],
        auxiliary: [aux('/m/Movie.en.srt', '.srt')],
      },
      subtitles: [{
        type: 'external',
        path: '/m/Movie.en.srt',
        language: 'en',
        format: 'srt',
        source: '@aviato-media/external-subtitles',
        mediaFileUri: 'file:///m/Movie.mkv',
      }],
    }

    const result = processProbe({
      itemId: 'item-5',
      bundle,
    })

    expect(result).toBeNull()
  })

  test('preserves prior subtitles from earlier hooks', () => {
    const bundle: Bundle = {
      files: {
        media: [media('Movie.mkv')],
        auxiliary: [aux('/m/Movie.en.srt', '.srt')],
      },
      subtitles: [{
        type: 'external',
        path: '/m/somewhere/else.vtt',
        language: 'fr',
        format: 'vtt',
        source: 'some-other-plugin',
      }],
    }

    const result = processProbe({
      itemId: 'item-6',
      bundle,
    })

    const subs = result?.bundle.subtitles ?? []
    expect(subs).toHaveLength(2)
    expect(subs[0].source).toBe('some-other-plugin')
    expect(subs[1].source).toBe('@aviato-media/external-subtitles')
  })
})
