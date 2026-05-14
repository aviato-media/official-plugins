import type { Bundle } from '@aviato-media/plugin-sdk'
import { describe, expect, test } from 'bun:test'

import { processProbe } from '../index.js'

type BundleAuxiliaryFile = Bundle['files']['auxiliary'][number]

function makeBundle (auxiliary: BundleAuxiliaryFile[]): Bundle {
  return {
    files: {
      media: [],
      auxiliary,
    },
  }
}

function aux (path: string, extension: string): BundleAuxiliaryFile {
  return {
    path,
    extension,
    sourcePlugin: 'fs-local',
  }
}

describe('processProbe (external-metadata)', () => {
  test('merges NFO metadata, ids, and entities into the bundle', async () => {
    const xml = `<movie>
      <title>Blade Runner</title>
      <year>1982</year>
      <plot>A blade runner must pursue and terminate four replicants.</plot>
      <genre>Sci-Fi</genre>
      <uniqueid type="imdb">tt0083658</uniqueid>
      <director>Ridley Scott</director>
      <actor><name>Harrison Ford</name><role>Rick Deckard</role></actor>
      <thumb aspect="poster">poster.jpg</thumb>
    </movie>`

    const bundle = makeBundle([aux('/m/movie.nfo', '.nfo')])
    const result = await processProbe({
      itemId: 'item-1',
      bundle,
    }, {
      readFile: async () => xml,
    })

    expect(result).not.toBeNull()
    const meta = result?.bundle.metadata as Record<string, unknown>
    expect(meta.title).toBe('Blade Runner')
    expect(meta.year).toBe(1982)
    expect(meta.overview).toBe('A blade runner must pursue and terminate four replicants.')
    expect(meta.genres).toEqual(['Sci-Fi'])
    expect(result?.bundle.ids?.imdb).toEqual({
      id: 'tt0083658',
    })
    expect(result?.bundle.assets).toHaveLength(1)
    expect(result?.bundle.assets?.[0]).toEqual({
      type: 'poster',
      uri: 'poster.jpg',
      source: '@aviato-media/external-metadata',
    })
    const entities = result?.bundle.entities ?? []
    expect(entities).toContainEqual({
      role: 'director',
      name: 'Ridley Scott',
      status: 'pending',
      source: '@aviato-media/external-metadata',
    })
    expect(entities).toContainEqual({
      role: 'actor',
      name: 'Harrison Ford',
      status: 'pending',
      metadata: {
        character: 'Rick Deckard',
      },
      source: '@aviato-media/external-metadata',
    })
  })

  test('merges OPF audiobook metadata: author, narrator, isbn, series', async () => {
    const xml = `<package><metadata
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:opf="http://www.idpf.org/2007/opf">
      <dc:title>The Three-Body Problem</dc:title>
      <dc:creator opf:role="aut">Cixin Liu</dc:creator>
      <dc:creator opf:role="nrt">Luke Daniels</dc:creator>
      <dc:date>2014-11-11</dc:date>
      <dc:identifier opf:scheme="ISBN">9780765377067</dc:identifier>
      <dc:subject>Science Fiction</dc:subject>
      <dc:subject>Hard SF</dc:subject>
      <meta name="calibre:series" content="Remembrance of Earth's Past"/>
      <meta name="calibre:series_index" content="1"/>
    </metadata></package>`

    const bundle = makeBundle([aux('/b/book.opf', '.opf')])
    const result = await processProbe({
      itemId: 'item-2',
      bundle,
    }, {
      readFile: async () => xml,
    })

    expect(result).not.toBeNull()
    const meta = result?.bundle.metadata as Record<string, unknown>
    expect(meta.title).toBe('The Three-Body Problem')
    expect(meta.author).toBe('Cixin Liu')
    expect(meta.artist).toBe('Cixin Liu')
    expect(meta.narrator).toBe('Luke Daniels')
    expect(meta.year).toBe(2014)
    expect(meta.genres).toEqual(['Science Fiction', 'Hard SF'])
    expect(meta.series).toBe("Remembrance of Earth's Past")
    expect(meta.seriesPosition).toBe(1)
    expect(result?.bundle.ids?.isbn).toEqual({
      id: '9780765377067',
    })

    const entities = result?.bundle.entities ?? []
    expect(entities).toContainEqual({
      role: 'author',
      name: 'Cixin Liu',
      status: 'pending',
      source: '@aviato-media/external-metadata',
    })
    expect(entities).toContainEqual({
      role: 'narrator',
      name: 'Luke Daniels',
      status: 'pending',
      source: '@aviato-media/external-metadata',
    })
  })

  test('returns null when no sidecar files are present', async () => {
    const bundle = makeBundle([aux('/m/notes.txt', '.txt')])
    const result = await processProbe({
      itemId: 'item-3',
      bundle,
    }, {
      readFile: async () => '',
    })
    expect(result).toBeNull()
  })

  test('returns null when sidecar exists but content is invalid', async () => {
    const bundle = makeBundle([aux('/m/movie.nfo', '.nfo')])
    const result = await processProbe({
      itemId: 'item-4',
      bundle,
    }, {
      readFile: async () => 'not actually xml',
    })
    expect(result).toBeNull()
  })

  test('sidecar metadata overrides bundle fields a prior plugin set', async () => {
    // Sidecar files are user-curated and should win over container-embedded
    // tags or indexer guesses populated earlier in the hook chain.
    const xml = `<movie>
      <title>Sidecar Title</title>
      <year>1982</year>
    </movie>`
    const bundle: Bundle = {
      files: {
        media: [],
        auxiliary: [aux('/m/movie.nfo', '.nfo')],
      },
      metadata: {
        title: 'Embedded Title',
      },
    }
    const result = await processProbe({
      itemId: 'item-5',
      bundle,
    }, {
      readFile: async () => xml,
    })

    expect(result?.bundle.metadata?.title).toBe('Sidecar Title')
    expect(result?.bundle.metadata?.year).toBe(1982)
  })
})
