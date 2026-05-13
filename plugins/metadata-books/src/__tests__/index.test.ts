import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { processProbe } from '../index.js'
import { buildEpubFixture } from './fixtures/build-epub.js'

const tempRoots: string[] = []

async function makeTempDir (): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'metadata-books-test-'))
  tempRoots.push(dir)
  return dir
}

afterAll(async () => {
  await Promise.all(tempRoots.map(d => rm(d, {
    recursive: true,
    force: true,
  })))
})

describe('processProbe', () => {
  test('extracts metadata, ISBN, and cover from an EPUB and merges into bundle', async () => {
    const root = await makeTempDir()
    const epubPath = join(root, 'gilfoyle.epub')
    await writeFile(epubPath, await buildEpubFixture({
      title: 'Linux: A Satanist Perspective',
      author: 'Bertram Gilfoyle',
      publisher: 'Pied Piper',
      language: 'en',
      isbn: '9780000000001',
    }))

    const result = await processProbe({
      itemId: 'item-1',
      bundle: {
        files: {
          media: [
            {
              id: 'file-1',
              uri: `file://${ epubPath}`,
              path: epubPath,
              filename: 'gilfoyle.epub',
              extension: '.epub',
              size: 0,
              type: 'primary',
              localPath: epubPath,
            },
          ],
          auxiliary: [],
        },
      },
    }, {
      coverDir: root,
    })

    expect(result).not.toBeNull()
    expect(result?.bundle.metadata?.title).toBe('Linux: A Satanist Perspective')
    expect(result?.bundle.metadata?.author).toBe('Bertram Gilfoyle')
    expect(result?.bundle.metadata?.publisher).toBe('Pied Piper')
    // ISBN must NOT leak into bundle.metadata
    expect((result?.bundle.metadata as Record<string, unknown>).isbn).toBeUndefined()
    // ISBN goes into bundle.ids
    expect(result?.bundle.ids?.isbn).toEqual({
      id: '9780000000001',
    })
    // Cover persisted as an item-level asset (no mediaFileId — see persistCover
    // for the rationale; getAssetsForItems on the server filters out file-scoped
    // assets, so tagging this would hide the cover from the item details page).
    expect(result?.bundle.assets).toHaveLength(1)
    const asset = result?.bundle.assets?.[0]
    expect(asset?.type).toBe('poster')
    expect(asset?.source).toBe('aviato-metadata-books')
    expect(asset?.mediaFileId).toBeUndefined()
    expect(asset?.path).toBeDefined()
    const written = await readFile(asset!.path!)
    expect(written.length).toBeGreaterThan(0)
  })

  test('returns null when no supported file is in the bundle', async () => {
    const result = await processProbe({
      itemId: 'item-2',
      bundle: {
        files: {
          media: [
            {
              uri: 'file:///foo.txt',
              path: '/foo.txt',
              filename: 'foo.txt',
              extension: '.txt',
              size: 1,
              type: 'primary',
              localPath: '/foo.txt',
            },
          ],
          auxiliary: [],
        },
      },
    })

    expect(result).toBeNull()
  })

  test('merges metadata from multiple ebook files in the same folder', async () => {
    const root = await makeTempDir()
    const epubA = join(root, 'a.epub')
    const epubB = join(root, 'b.epub')
    // First file provides title + publisher; second overrides title and adds author.
    await writeFile(epubA, await buildEpubFixture({
      title: 'Stale Title',
      publisher: 'Bachmanity Press',
      withCover: false,
    }))
    await writeFile(epubB, await buildEpubFixture({
      title: 'Fresh Title',
      author: 'Erlich Bachman',
      withCover: false,
    }))

    const result = await processProbe({
      itemId: 'item-3',
      bundle: {
        files: {
          media: [
            {
              id: 'a',
              uri: `file://${ epubA}`,
              path: epubA,
              filename: 'a.epub',
              extension: '.epub',
              size: 0,
              type: 'primary',
              localPath: epubA,
            },
            {
              id: 'b',
              uri: `file://${ epubB}`,
              path: epubB,
              filename: 'b.epub',
              extension: '.epub',
              size: 0,
              type: 'primary',
              localPath: epubB,
            },
          ],
          auxiliary: [],
        },
      },
    }, {
      coverDir: root,
    })

    // Last-non-empty wins per field
    expect(result?.bundle.metadata?.title).toBe('Fresh Title')
    expect(result?.bundle.metadata?.author).toBe('Erlich Bachman')
    expect(result?.bundle.metadata?.publisher).toBe('Bachmanity Press')
  })

  test('continues when one file fails to parse and reports remaining metadata', async () => {
    const root = await makeTempDir()
    const goodPath = join(root, 'good.epub')
    const badPath = join(root, 'bad.epub')
    await writeFile(goodPath, await buildEpubFixture({
      title: 'Always Blue',
      author: 'Jian-Yang',
      withCover: false,
    }))
    // Truncated zip — JSZip will throw
    await writeFile(badPath, new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]))

    const result = await processProbe({
      itemId: 'item-4',
      bundle: {
        files: {
          media: [
            {
              id: 'bad',
              uri: `file://${ badPath}`,
              path: badPath,
              filename: 'bad.epub',
              extension: '.epub',
              size: 5,
              type: 'primary',
              localPath: badPath,
            },
            {
              id: 'good',
              uri: `file://${ goodPath}`,
              path: goodPath,
              filename: 'good.epub',
              extension: '.epub',
              size: 0,
              type: 'primary',
              localPath: goodPath,
            },
          ],
          auxiliary: [],
        },
      },
    }, {
      coverDir: root,
    })

    expect(result).not.toBeNull()
    expect(result?.bundle.metadata?.title).toBe('Always Blue')
    expect(result?.bundle.metadata?.author).toBe('Jian-Yang')
  })

  // Regression: the server's libraryFiles table stores extensions without a
  // leading dot (e.g. "epub"), but plugin authors will reasonably expect
  // either form to work. The plugin used to silently skip every file when the
  // bundle delivered the bare form, leaving the DB without chapters or cover.
  test('accepts extension with or without a leading dot', async () => {
    const root = await makeTempDir()
    const epubPath = join(root, 'tres-commas.epub')
    await writeFile(epubPath, await buildEpubFixture({
      title: 'Tres Commas',
      author: 'Russ Hanneman',
      spine: [{
        id: 'ch1',
        href: 'ch1.xhtml',
      }],
      nav: [{
        title: 'On Boats',
        href: 'ch1.xhtml',
      }],
    }))

    for (const ext of ['epub', '.epub', 'EPUB', '.EPUB']) {
      const result = await processProbe({
        itemId: 'item-x',
        bundle: {
          files: {
            media: [
              {
                id: 'file-x',
                uri: `file://${epubPath}`,
                path: epubPath,
                filename: 'tres-commas.epub',
                extension: ext,
                size: 0,
                type: 'primary',
                localPath: epubPath,
              },
            ],
            auxiliary: [],
          },
        },
      }, {
        coverDir: root,
      })

      expect(result, `extension=${ext} should be processed`).not.toBeNull()
      expect(result?.bundle.metadata?.title).toBe('Tres Commas')
      expect(result?.bundle.chapters?.length).toBe(1)
      expect(result?.bundle.chapters?.[0].title).toBe('On Boats')
    }
  })

  // Regression: chapter entries must reference the file via `mediaFileUri`
  // so the server's applyHookChapters can resolve them back to a fileId
  // even when the plugin doesn't have stable file IDs in scope.
  test('emitted chapters carry mediaFileUri pointing to the source file', async () => {
    const root = await makeTempDir()
    const epubPath = join(root, 'with-toc.epub')
    await writeFile(epubPath, await buildEpubFixture({
      title: 'Bachmanity Insanity',
      spine: [
        {
          id: 's1',
          href: 's1.xhtml',
        },
        {
          id: 's2',
          href: 's2.xhtml',
        },
      ],
      nav: [
        {
          title: 'The Pitch',
          href: 's1.xhtml',
        },
        {
          title: 'The Implosion',
          href: 's2.xhtml',
        },
      ],
    }))

    const result = await processProbe({
      itemId: 'item-y',
      bundle: {
        files: {
          media: [{
            id: 'file-y',
            uri: `file://${epubPath}`,
            path: epubPath,
            filename: 'with-toc.epub',
            extension: 'epub',
            size: 0,
            type: 'primary',
            localPath: epubPath,
          }],
          auxiliary: [],
        },
      },
    }, {
      coverDir: root,
    })

    expect(result?.bundle.chapters).toBeDefined()
    expect(result!.bundle.chapters!.every(c => c.mediaFileUri === `file://${epubPath}`)).toBe(true)
    expect(result!.bundle.chapters!.every(c => c.role === 'chapter')).toBe(true)
  })
})
