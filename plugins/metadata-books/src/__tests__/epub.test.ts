import { describe, expect, test } from 'bun:test'

import { parseEpub } from '../parsers/epub.js'
import { buildEpubFixture } from './fixtures/build-epub.js'

describe('parseEpub', () => {
  test('extracts core Dublin Core fields', async () => {
    const epub = await buildEpubFixture({
      title: 'Compression: A Pied Piper Story',
      author: 'Richard Hendricks',
      description: 'A treatise on middle-out compression.',
      publisher: 'Bachmanity Press',
      language: 'en',
      subject: 'Technology',
      date: '2014-04-06',
    })

    const result = await parseEpub(epub)

    expect(result.metadata.title).toBe('Compression: A Pied Piper Story')
    expect(result.metadata.author).toBe('Richard Hendricks')
    expect(result.metadata.description).toBe('A treatise on middle-out compression.')
    expect(result.metadata.publisher).toBe('Bachmanity Press')
    expect(result.metadata.language).toBe('en')
    expect(result.metadata.genre).toBe('Technology')
    expect(result.metadata.year).toBe(2014)
  })

  test('extracts calibre series metadata', async () => {
    const epub = await buildEpubFixture({
      title: 'Hooli vs Pied Piper, Vol. 2',
      author: 'Gavin Belson',
      series: 'Tech Wars',
      seriesIndex: '2',
    })

    const result = await parseEpub(epub)

    expect(result.metadata.series).toBe('Tech Wars')
    expect(result.metadata.seriesPosition).toBe(2)
  })

  test('extracts ISBN identifier with opf:scheme', async () => {
    const epub = await buildEpubFixture({
      title: 'The SeeFood Field Guide',
      isbn: '978-3-16-148410-0',
    })

    const result = await parseEpub(epub)

    expect(result.metadata.isbn).toBe('978-3-16-148410-0')
  })

  test('strips urn:isbn: prefix from identifier text', async () => {
    const epub = await buildEpubFixture({
      title: 'Always Blue',
      isbn: 'urn:isbn:9780000000000',
      isbnScheme: '',
    })

    const result = await parseEpub(epub)

    expect(result.metadata.isbn).toBe('9780000000000')
  })

  test('accepts ISBN-10 with X check digit', async () => {
    const epub = await buildEpubFixture({
      title: 'Tres Commas',
      isbn: '030640615X',
      isbnScheme: '',
    })

    const result = await parseEpub(epub)

    expect(result.metadata.isbn).toBe('030640615X')
  })

  test('rejects bare 17-digit numbers as ISBN', async () => {
    const epub = await buildEpubFixture({
      title: 'Not An ISBN',
      isbn: '12345678901234567',
      isbnScheme: '',
    })

    const result = await parseEpub(epub)

    expect(result.metadata.isbn).toBeUndefined()
  })

  test('accepts hyphenated ISBN-10', async () => {
    const epub = await buildEpubFixture({
      title: 'Hooli Manual',
      isbn: '0-13-110362-8',
      isbnScheme: '',
    })

    const result = await parseEpub(epub)

    expect(result.metadata.isbn).toBe('0-13-110362-8')
  })

  test('extracts cover via properties="cover-image"', async () => {
    const epub = await buildEpubFixture({
      title: 'Erlich Bachman, This Is Your Mom',
      coverViaMetaName: false,
    })

    const result = await parseEpub(epub)

    expect(result.cover).toBeDefined()
    expect(result.cover?.mimeType).toBe('image/png')
    expect(result.cover?.data.length).toBeGreaterThan(0)
  })

  test('extracts cover via legacy <meta name="cover"> reference', async () => {
    const epub = await buildEpubFixture({
      title: 'Bachmanity Insanity',
      coverViaMetaName: true,
    })

    const result = await parseEpub(epub)

    expect(result.cover).toBeDefined()
    expect(result.cover?.mimeType).toBe('image/png')
  })

  test('returns empty metadata when OPF is missing', async () => {
    const result = await parseEpub(new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]))
    expect(result.metadata).toEqual({})
    expect(result.cover).toBeUndefined()
  })

  test('parses partial year from non-ISO date', async () => {
    const epub = await buildEpubFixture({
      title: 'Three Comma Club',
      date: 'Sometime in 2017',
    })

    const result = await parseEpub(epub)

    expect(result.metadata.year).toBe(2017)
  })

  test('extracts chapters from EPUB3 nav doc', async () => {
    const epub = await buildEpubFixture({
      title: 'The Bachmanity Chronicles',
      spine: [
        {
          id: 'ch1',
          href: 'ch1.xhtml',
        },
        {
          id: 'ch2',
          href: 'ch2.xhtml',
        },
        {
          id: 'ch3',
          href: 'ch3.xhtml',
        },
      ],
      nav: [
        {
          title: 'Erlich Awakens',
          href: 'ch1.xhtml',
        },
        {
          title: 'The Incubator',
          href: 'ch2.xhtml',
        },
        {
          title: 'Aviato Forever',
          href: 'ch3.xhtml',
        },
      ],
    })

    const result = await parseEpub(epub)

    expect(result.chapters).toBeDefined()
    expect(result.chapters).toHaveLength(3)
    expect(result.chapters?.[0]).toEqual({
      startPage: 1,
      title: 'Erlich Awakens',
      href: 'ch1.xhtml',
    })
    expect(result.chapters?.[1].startPage).toBe(2)
    expect(result.chapters?.[2].startPage).toBe(3)
    expect(result.metadata.pageCount).toBe(3)
  })

  test('extracts chapters from EPUB2 NCX when no nav doc present', async () => {
    const epub = await buildEpubFixture({
      title: 'Compression Manifesto',
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
      ncx: [
        {
          title: 'Middle-Out',
          href: 's1.xhtml',
        },
        {
          title: 'Weissman Score',
          href: 's2.xhtml',
        },
      ],
    })

    const result = await parseEpub(epub)

    expect(result.chapters).toBeDefined()
    expect(result.chapters).toHaveLength(2)
    expect(result.chapters?.[0]).toEqual({
      startPage: 1,
      title: 'Middle-Out',
      href: 's1.xhtml',
    })
    expect(result.chapters?.[1].startPage).toBe(2)
  })

  test('skips TOC entries pointing to non-spine files', async () => {
    const epub = await buildEpubFixture({
      title: 'Hooli Manual',
      spine: [
        {
          id: 'main',
          href: 'main.xhtml',
        },
      ],
      nav: [
        {
          title: 'Real Chapter',
          href: 'main.xhtml',
        },
        {
          title: 'Bogus Link',
          href: 'does-not-exist.xhtml',
        },
      ],
    })

    const result = await parseEpub(epub)

    expect(result.chapters).toHaveLength(1)
    expect(result.chapters?.[0].title).toBe('Real Chapter')
  })

  test('returns no chapters when spine is empty', async () => {
    const epub = await buildEpubFixture({
      title: 'Always Blue',
    })

    const result = await parseEpub(epub)

    expect(result.chapters).toBeUndefined()
  })

  // Regression: some EPUB2 files (older Calibre exports, including the
  // Harry Potter set in our test corpus) wrap `<package>` in the `opf:`
  // namespace prefix. We must still find metadata/manifest/spine/guide
  // even though they come through as `opf:metadata` etc.
  test('handles OPF with opf: namespace prefix on package elements', async () => {
    const epub = await buildNamespacedFixture()
    const result = await parseEpub(epub)
    expect(result.metadata.title).toBe('Hooli vs. Pied Piper')
    expect(result.metadata.author).toBe('Gavin Belson')
    expect(result.chapters?.length).toBe(1)
    expect(result.chapters?.[0].title).toBe('The Compression Wars')
  })

  // Regression: EPUB2 cover commonly declared via `<guide reference type="cover">`
  // pointing to an XHTML wrapper page. We have to fetch the wrapper, find the
  // first <img>, and load that image's bytes.
  test('extracts cover from <guide reference type="cover"> wrapper page', async () => {
    const epub = await buildGuideCoverFixture()
    const result = await parseEpub(epub)
    expect(result.cover).toBeDefined()
    expect(result.cover?.mimeType).toBe('image/jpeg')
    expect(result.cover?.data.length).toBeGreaterThan(0)
  })
})

// Fixtures kept inline (not in the shared builder) because these test
// pathological EPUB structures we don't want to make easy to reach for.

async function buildNamespacedFixture (): Promise<Uint8Array> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  zip.file('META-INF/container.xml', [
    '<?xml version="1.0"?>',
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">',
    '  <rootfiles>',
    '    <rootfile full-path="OEBPS/Content.opf" media-type="application/oebps-package+xml"/>',
    '  </rootfiles>',
    '</container>',
  ].join('\n'))
  zip.file('OEBPS/Content.opf', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opf:package xmlns:opf="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">',
    '  <opf:metadata xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '    <dc:title>Hooli vs. Pied Piper</dc:title>',
    '    <dc:creator>Gavin Belson</dc:creator>',
    '  </opf:metadata>',
    '  <opf:manifest>',
    '    <opf:item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>',
    '    <opf:item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '  </opf:manifest>',
    '  <opf:spine toc="ncx">',
    '    <opf:itemref idref="ch1"/>',
    '  </opf:spine>',
    '</opf:package>',
  ].join('\n'))
  zip.file('OEBPS/ch1.xhtml', '<?xml version="1.0"?><html><body><p>One</p></body></html>')
  zip.file('OEBPS/toc.ncx', [
    '<?xml version="1.0"?>',
    '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">',
    '  <navMap>',
    '    <navPoint id="np1" playOrder="1">',
    '      <navLabel><text>The Compression Wars</text></navLabel>',
    '      <content src="ch1.xhtml"/>',
    '    </navPoint>',
    '  </navMap>',
    '</ncx>',
  ].join('\n'))
  return zip.generateAsync({
    type: 'uint8array',
  })
}

async function buildGuideCoverFixture (): Promise<Uint8Array> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  // 1×1 jpg pixel — content doesn't matter, we just need >0 bytes back
  const jpegPixel = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9])
  zip.file('mimetype', 'application/epub+zip')
  zip.file('META-INF/container.xml', [
    '<?xml version="1.0"?>',
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">',
    '  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>',
    '</container>',
  ].join('\n'))
  zip.file('OEBPS/content.opf', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">',
    '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '    <dc:title>Bachmanity Insanity</dc:title>',
    '  </metadata>',
    '  <manifest>',
    '    <item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>',
    '    <item id="cover-img" href="images/cover.jpg" media-type="image/jpeg"/>',
    '    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>',
    '  </manifest>',
    '  <spine>',
    '    <itemref idref="ch1"/>',
    '  </spine>',
    '  <guide>',
    '    <reference type="cover" title="cover" href="cover.xhtml"/>',
    '  </guide>',
    '</package>',
  ].join('\n'))
  zip.file('OEBPS/cover.xhtml', [
    '<?xml version="1.0"?>',
    '<html xmlns="http://www.w3.org/1999/xhtml"><body>',
    '<img src="images/cover.jpg" alt="Cover"/>',
    '</body></html>',
  ].join('\n'))
  zip.file('OEBPS/images/cover.jpg', jpegPixel)
  zip.file('OEBPS/ch1.xhtml', '<?xml version="1.0"?><html><body><p>One</p></body></html>')
  return zip.generateAsync({
    type: 'uint8array',
  })
}
