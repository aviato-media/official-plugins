import type { Bundle, BundleMediaFile, PluginClient } from '@aviato-media/plugin-sdk'
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { processProbe } from '../index.js'

interface RecordedCall {
  cmd: string
  args: string[]
}

interface StubResponse {
  stdout: string
  stderr: string
  exitCode: number
}

function stubClient (responses: { ffprobe?: StubResponse,
  ffmpeg?: (outputPath: string) => Promise<StubResponse> | StubResponse }): { client: PluginClient,
  calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const fake = {
    async run (cmd: string, args: string[]) {
      calls.push({
        cmd,
        args,
      })
      if (cmd === 'ffprobe') {
        return responses.ffprobe ?? {
          stdout: '{}',
          stderr: '',
          exitCode: 0,
        }
      }
      if (cmd === 'ffmpeg' && responses.ffmpeg) {
        const outputPath = args[args.length - 1]
        return await responses.ffmpeg(outputPath)
      }
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
      }
    },
  } as unknown as PluginClient
  return {
    client: fake,
    calls,
  }
}

const tempRoots: string[] = []

async function makeTempDir (): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'embedded-metadata-test-'))
  tempRoots.push(dir)
  return dir
}

afterAll(async () => {
  await Promise.all(tempRoots.map(d => rm(d, {
    recursive: true,
    force: true,
  })))
})

function makeMediaFile (overrides: Partial<BundleMediaFile> & { extension: string,
  filename: string,
  localPath: string }): BundleMediaFile {
  return {
    id: 'file-1',
    uri: `file://${overrides.localPath}`,
    path: overrides.localPath,
    size: 1024,
    type: 'primary',
    ...overrides,
  }
}

function makeBundle (mediaFiles: BundleMediaFile[]): Bundle {
  return {
    files: {
      media: mediaFiles,
      auxiliary: [],
    },
  }
}

describe('processProbe', () => {
  test('extracts metadata, duration, and canonical IDs from a probeable file', async () => {
    const root = await makeTempDir()
    const file = join(root, 'movie.mkv')
    await writeFile(file, 'placeholder')

    const ffprobeOutput = {
      format: {
        duration: '7020.5',
        tags: {
          TITLE: 'Blade Runner',
          DATE_RELEASED: '1982',
          GENRE: 'Sci-Fi',
          IMDB: 'tt0083658',
          TMDB: '78',
        },
      },
      streams: [
        {
          index: 0,
          codec_type: 'video',
          codec_name: 'hevc',
          disposition: {
            attached_pic: 0,
          },
        },
      ],
    }

    const { client } = stubClient({
      ffprobe: {
        stdout: JSON.stringify(ffprobeOutput),
        stderr: '',
        exitCode: 0,
      },
    })

    const bundle = makeBundle([makeMediaFile({
      extension: 'mkv',
      filename: 'movie.mkv',
      localPath: file,
    })])
    const result = await processProbe({
      itemId: 'item-1',
      bundle,
    }, {
      client,
      extractArtwork: false,
    })

    expect(result).not.toBeNull()
    expect(result?.bundle.metadata?.title).toBe('Blade Runner')
    expect(result?.bundle.metadata?.year).toBe(1982)
    expect(result?.bundle.metadata?.duration).toBeCloseTo(7020.5)
    expect(result?.bundle.metadata?.genres).toEqual(['Sci-Fi'])
    expect(result?.bundle.ids?.imdb).toEqual({
      id: 'tt0083658',
    })
    expect(result?.bundle.ids?.tmdb).toEqual({
      id: '78',
    })
  })

  test('extracts audiobook (m4b) metadata: author, narrator, description, multi-genre', async () => {
    const root = await makeTempDir()
    const file = join(root, 'book.m4b')
    await writeFile(file, 'placeholder')

    const ffprobeOutput = {
      format: {
        duration: '46800',
        tags: {
          '©nam': 'The Three-Body Problem',
          '©ART': 'Cixin Liu',
          'aart': 'Cixin Liu',
          '©wrt': 'Luke Daniels',
          'comment': 'Earth makes contact with a hostile civilization.',
          '©gen': 'Fiction:Science Fiction:Hard SF',
        },
      },
      streams: [
        {
          index: 0,
          codec_type: 'audio',
          codec_name: 'aac',
          disposition: {
            attached_pic: 0,
          },
        },
      ],
    }

    const { client } = stubClient({
      ffprobe: {
        stdout: JSON.stringify(ffprobeOutput),
        stderr: '',
        exitCode: 0,
      },
    })

    const bundle = makeBundle([makeMediaFile({
      extension: 'm4b',
      filename: 'book.m4b',
      localPath: file,
    })])
    const result = await processProbe({
      itemId: 'book-1',
      bundle,
    }, {
      client,
      extractArtwork: false,
    })

    expect(result).not.toBeNull()
    const meta = result?.bundle.metadata as Record<string, unknown>
    expect(meta.title).toBe('The Three-Body Problem')
    expect(meta.author).toBe('Cixin Liu')
    expect(meta.narrator).toBe('Luke Daniels')
    expect(meta.description).toBe('Earth makes contact with a hostile civilization.')
    expect(meta.genres).toEqual(['Fiction', 'Science Fiction', 'Hard SF'])
  })

  test('persists embedded cover art as a poster asset', async () => {
    const root = await makeTempDir()
    const filePath = join(root, 'movie.mp4')
    await writeFile(filePath, 'placeholder')

    const coverDir = join(root, 'covers')

    const ffprobeOutput = {
      format: {
        tags: {
          '©nam': 'Blade Runner',
        },
      },
      streams: [
        {
          index: 0,
          codec_type: 'video',
          codec_name: 'h264',
          disposition: {
            attached_pic: 0,
          },
        },
        {
          index: 1,
          codec_type: 'video',
          codec_name: 'mjpeg',
          disposition: {
            attached_pic: 1,
          },
        },
      ],
    }

    const { client } = stubClient({
      ffprobe: {
        stdout: JSON.stringify(ffprobeOutput),
        stderr: '',
        exitCode: 0,
      },
      ffmpeg: async (outputPath) => {
        await writeFile(outputPath, Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
        return {
          stdout: '',
          stderr: '',
          exitCode: 0,
        }
      },
    })

    const bundle = makeBundle([makeMediaFile({
      extension: 'mp4',
      filename: 'movie.mp4',
      localPath: filePath,
    })])

    const result = await processProbe({
      itemId: 'item-1',
      bundle,
    }, {
      client,
      coverDir,
    })

    expect(result?.bundle.assets).toHaveLength(1)
    const asset = result?.bundle.assets?.[0]
    expect(asset?.type).toBe('poster')
    expect(asset?.source).toBe('aviato-embedded-metadata')
    expect(asset?.mediaFileId).toBeUndefined()
    expect(asset?.path).toBeDefined()
    const written = await readFile(asset!.path!)
    expect(written.length).toBeGreaterThan(0)
  })

  test('returns null when no probeable file is found', async () => {
    const root = await makeTempDir()
    const filePath = join(root, 'note.txt')
    await writeFile(filePath, 'hi')

    const { client } = stubClient({})

    const bundle = makeBundle([makeMediaFile({
      extension: 'txt',
      filename: 'note.txt',
      localPath: filePath,
    })])

    const result = await processProbe({
      itemId: 'item-1',
      bundle,
    }, {
      client,
    })

    expect(result).toBeNull()
  })

  test('continues past a single ffprobe failure', async () => {
    const root = await makeTempDir()
    const file = join(root, 'movie.mkv')
    await writeFile(file, 'placeholder')

    const { client } = stubClient({
      ffprobe: {
        stdout: '',
        stderr: 'broken',
        exitCode: 1,
      },
    })

    const bundle = makeBundle([makeMediaFile({
      extension: 'mkv',
      filename: 'movie.mkv',
      localPath: file,
    })])

    const result = await processProbe({
      itemId: 'item-1',
      bundle,
    }, {
      client,
      extractArtwork: false,
    })

    // touched stays false because parse never succeeded
    expect(result).toBeNull()
  })
})
