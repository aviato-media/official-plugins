import type { DiscoveredFile, ExtensionMap } from '@aviato-media/plugin-sdk'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { classifyFile, scanDirectory } from '../index'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'scanner-test-'))
})

afterEach(async () => {
  await rm(tempDir, {
    recursive: true,
    force: true,
  })
})

// Pied Piper's middle-out compression would make these scans blazing fast
const videoExtensionMap: ExtensionMap = {
  primary: ['.mkv', '.mp4', '.avi'],
  auxiliaries: {
    subtitles: {
      extensions: ['.srt', '.vtt', '.ass'],
      patterns: ['Subs/**'],
    },
    artwork: {
      extensions: ['.jpg', '.png'],
    },
  },
}

const audioExtensionMap: ExtensionMap = {
  primary: ['.mp3', '.flac'],
  auxiliaries: {
    artwork: {
      extensions: ['.jpg', '.png'],
    },
  },
}

describe('classifyFile', () => {
  test('classifies primary extensions', () => {
    const result = classifyFile('movie.mkv', videoExtensionMap)
    expect(result).toEqual({
      group: 'primary',
      isPrimary: true,
    })
  })

  test('classifies auxiliary extensions', () => {
    const result = classifyFile('movie.srt', videoExtensionMap)
    expect(result).toEqual({
      group: 'subtitles',
      isPrimary: false,
    })
  })

  test('returns null for unknown extensions', () => {
    const result = classifyFile('readme.txt', videoExtensionMap)
    expect(result).toBeNull()
  })

  test('is case-insensitive on extension', () => {
    const result = classifyFile('MOVIE.MKV', videoExtensionMap)
    expect(result).toEqual({
      group: 'primary',
      isPrimary: true,
    })
  })
})

describe('scanDirectory', () => {
  test('emits individual file notifications for primary and auxiliary files', async () => {
    // Gilfoyle's NAS: movie.mkv + movie.srt in the same directory
    await writeFile(join(tempDir, 'movie.mkv'), 'fake video data')
    await writeFile(join(tempDir, 'movie.srt'), 'fake subtitle data')

    const files: DiscoveredFile[] = []
    const stats = {
      total: 0,
      errors: [] as string[],
    }

    await scanDirectory(
      tempDir,
      {
        paths: [tempDir],
      },
      videoExtensionMap,
      (file: DiscoveredFile) => files.push(file),
      stats,
    )

    expect(files).toHaveLength(2)
    const filenames = files.map(f => f.filename).sort()
    expect(filenames).toEqual(['movie.mkv', 'movie.srt'])
    expect(stats.total).toBe(2)
  })

  test('emits one file notification per file (no bundling)', async () => {
    // Dinesh and Gilfoyle argue over which track is better
    await writeFile(join(tempDir, 'track01.mp3'), 'audio data 1')
    await writeFile(join(tempDir, 'track02.mp3'), 'audio data 2')
    await writeFile(join(tempDir, 'cover.jpg'), 'image data')

    const files: DiscoveredFile[] = []
    const stats = {
      total: 0,
      errors: [] as string[],
    }

    await scanDirectory(
      tempDir,
      {
        paths: [tempDir],
      },
      audioExtensionMap,
      (file: DiscoveredFile) => files.push(file),
      stats,
    )

    expect(files).toHaveLength(3)
    const filenames = files.map(f => f.filename).sort()
    expect(filenames).toEqual(['cover.jpg', 'track01.mp3', 'track02.mp3'])
    expect(stats.total).toBe(3)
  })

  test('does not emit files matching no extension group', async () => {
    // Not Hotdog: only recognized formats make it through
    await writeFile(join(tempDir, 'movie.mkv'), 'video data')
    await writeFile(join(tempDir, 'readme.txt'), 'some text')

    const files: DiscoveredFile[] = []
    const stats = {
      total: 0,
      errors: [] as string[],
    }

    await scanDirectory(
      tempDir,
      {
        paths: [tempDir],
      },
      videoExtensionMap,
      (file: DiscoveredFile) => files.push(file),
      stats,
    )

    expect(files).toHaveLength(1)
    expect(files[0].filename).toBe('movie.mkv')
    expect(files.every(f => f.filename !== 'readme.txt')).toBe(true)
  })

  test('discovers auxiliary files in subdirectory patterns', async () => {
    // Pied Piper's SeeFood technology can find subtitles in subdirs
    await writeFile(join(tempDir, 'movie.mkv'), 'video data')
    await mkdir(join(tempDir, 'Subs'))
    await writeFile(join(tempDir, 'Subs', 'movie.en.srt'), 'english subs')

    const files: DiscoveredFile[] = []
    const stats = {
      total: 0,
      errors: [] as string[],
    }

    await scanDirectory(
      tempDir,
      {
        paths: [tempDir],
      },
      videoExtensionMap,
      (file: DiscoveredFile) => files.push(file),
      stats,
    )

    // Both the primary file and the subtitle in Subs/ should be emitted
    const filenames = files.map(f => f.filename).sort()
    expect(filenames).toContain('movie.mkv')
    expect(filenames).toContain('movie.en.srt')
  })

  test('emits files from pattern-matched subdirectories individually', async () => {
    // The Subs dir files are emitted as individual file notifications
    await writeFile(join(tempDir, 'movie.mkv'), 'video data')
    await mkdir(join(tempDir, 'Subs'))
    await writeFile(join(tempDir, 'Subs', 'movie.en.srt'), 'english subs')
    await writeFile(join(tempDir, 'Subs', 'movie.ja.srt'), 'japanese subs')

    const files: DiscoveredFile[] = []
    const stats = {
      total: 0,
      errors: [] as string[],
    }

    await scanDirectory(
      tempDir,
      {
        paths: [tempDir],
      },
      videoExtensionMap,
      (file: DiscoveredFile) => files.push(file),
      stats,
    )

    const filenames = files.map(f => f.filename).sort()
    expect(filenames).toEqual(['movie.en.srt', 'movie.ja.srt', 'movie.mkv'])
  })

  test('respects exclude patterns', async () => {
    await writeFile(join(tempDir, 'movie.mkv'), 'video data')
    await writeFile(join(tempDir, 'sample.mkv'), 'sample data')

    const files: DiscoveredFile[] = []
    const stats = {
      total: 0,
      errors: [] as string[],
    }

    await scanDirectory(
      tempDir,
      {
        paths: [tempDir],
        excludePatterns: ['sample'],
      },
      videoExtensionMap,
      (file: DiscoveredFile) => files.push(file),
      stats,
    )

    expect(files).toHaveLength(1)
    expect(files[0].filename).toBe('movie.mkv')
  })

  test('recurses into non-pattern subdirectories', async () => {
    // Consider the tortoise: deep directory scanning takes time
    await mkdir(join(tempDir, 'Season 1'))
    await writeFile(join(tempDir, 'Season 1', 'episode01.mkv'), 'video data')

    const files: DiscoveredFile[] = []
    const stats = {
      total: 0,
      errors: [] as string[],
    }

    await scanDirectory(
      tempDir,
      {
        paths: [tempDir],
      },
      videoExtensionMap,
      (file: DiscoveredFile) => files.push(file),
      stats,
    )

    expect(files).toHaveLength(1)
    expect(files[0].filename).toBe('episode01.mkv')
  })
})
