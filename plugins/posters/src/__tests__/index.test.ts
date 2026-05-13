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

function media (filename: string): BundleMediaFile {
  return {
    uri: `/m/${filename}`,
    path: `/m/${filename}`,
    filename,
    extension: filename.substring(filename.lastIndexOf('.')),
    size: 1024,
    type: 'primary',
  }
}

function makeBundle (overrides: Partial<Bundle> & { files: Bundle['files'] }): Bundle {
  return {
    ...overrides,
  }
}

describe('processProbe (posters)', () => {
  test('emits poster + fanart from <stem>-prefixed sidecars', () => {
    const bundle = makeBundle({
      files: {
        media: [media('Inception.mkv')],
        auxiliary: [
          aux('/m/Inception-poster.jpg', '.jpg'),
          aux('/m/Inception-fanart.jpg', '.jpg'),
        ],
      },
    })

    const result = processProbe({
      itemId: 'item-1',
      bundle,
    })

    expect(result).not.toBeNull()
    expect(result?.bundle.assets).toHaveLength(2)
    expect(result?.bundle.assets).toContainEqual({
      type: 'poster',
      path: '/m/Inception-poster.jpg',
      source: 'aviato-posters',
      mimeType: 'image/jpeg',
    })
    expect(result?.bundle.assets).toContainEqual({
      type: 'fanart',
      path: '/m/Inception-fanart.jpg',
      source: 'aviato-posters',
      mimeType: 'image/jpeg',
    })
  })

  test('picks up exact-name keyword sidecars (poster.jpg, banner.png)', () => {
    const bundle = makeBundle({
      files: {
        media: [media('movie.mkv')],
        auxiliary: [
          aux('/m/poster.jpg', '.jpg'),
          aux('/m/banner.png', '.png'),
          aux('/m/folder.webp', '.webp'),
        ],
      },
    })

    const result = processProbe({
      itemId: 'item-2',
      bundle,
    })

    expect(result?.bundle.assets).toContainEqual({
      type: 'poster',
      path: '/m/poster.jpg',
      source: 'aviato-posters',
      mimeType: 'image/jpeg',
    })
    expect(result?.bundle.assets).toContainEqual({
      type: 'banner',
      path: '/m/banner.png',
      source: 'aviato-posters',
      mimeType: 'image/png',
    })
    expect(result?.bundle.assets).toContainEqual({
      type: 'cover',
      path: '/m/folder.webp',
      source: 'aviato-posters',
      mimeType: 'image/webp',
    })
  })

  test('does not emit a poster when the bundle already has one', () => {
    const bundle: Bundle = {
      files: {
        media: [media('movie.mkv')],
        auxiliary: [
          aux('/m/poster.jpg', '.jpg'),
          aux('/m/fanart.jpg', '.jpg'),
        ],
      },
      assets: [{
        type: 'poster',
        path: '/managed/existing-poster.jpg',
        source: 'aviato-tmdb',
      }],
    }

    const result = processProbe({
      itemId: 'item-3',
      bundle,
    })

    // Existing poster is preserved; only fanart is added.
    expect(result?.bundle.assets).toHaveLength(2)
    expect(result?.bundle.assets?.some(a => a.source === 'aviato-tmdb' && a.type === 'poster')).toBe(true)
    expect(result?.bundle.assets?.some(a => a.source === 'aviato-posters' && a.type === 'fanart')).toBe(true)
  })

  test('dedupes when multiple files map to the same artwork type', () => {
    const bundle = makeBundle({
      files: {
        media: [media('Inception.mkv')],
        auxiliary: [
          aux('/m/poster.jpg', '.jpg'),
          aux('/m/Inception-poster.jpg', '.jpg'),
          aux('/m/Inception.jpg', '.jpg'),
        ],
      },
    })

    const result = processProbe({
      itemId: 'item-4',
      bundle,
    })

    const posters = result?.bundle.assets?.filter(a => a.type === 'poster') ?? []
    expect(posters).toHaveLength(1)
  })

  test('returns null when no images match', () => {
    const bundle = makeBundle({
      files: {
        media: [media('movie.mkv')],
        auxiliary: [
          aux('/m/notes.txt', '.txt'),
          aux('/m/other-movie.jpg', '.jpg'),
        ],
      },
    })

    const result = processProbe({
      itemId: 'item-5',
      bundle,
    })

    expect(result).toBeNull()
  })

  test('returns null when there are no auxiliary files', () => {
    const bundle = makeBundle({
      files: {
        media: [media('movie.mkv')],
        auxiliary: [],
      },
    })

    const result = processProbe({
      itemId: 'item-6',
      bundle,
    })

    expect(result).toBeNull()
  })
})
