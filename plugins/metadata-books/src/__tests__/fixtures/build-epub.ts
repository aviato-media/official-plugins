import JSZip from 'jszip'

export interface EpubFixtureOptions {
  title?: string
  author?: string
  description?: string
  publisher?: string
  language?: string
  subject?: string
  date?: string
  series?: string
  seriesIndex?: string
  isbn?: string
  isbnScheme?: string
  withCover?: boolean
  coverData?: Uint8Array
  coverMediaType?: string
  /** When true, use the calibre-style `<meta name="cover">` reference */
  coverViaMetaName?: boolean
  /** Spine entries (XHTML files in reading order). When set, fixture also creates the files. */
  spine?: Array<{ id: string,
    href: string,
    body?: string }>
  /** EPUB3 nav doc TOC entries. Requires `spine` to be set. */
  nav?: Array<{ title: string,
    href: string }>
  /** EPUB2 NCX TOC entries. Requires `spine` to be set. Mutually exclusive with `nav`. */
  ncx?: Array<{ title: string,
    href: string }>
}

const DEFAULTS: Required<Pick<EpubFixtureOptions, 'title' | 'author'>> = {
  title: 'Compression: A Pied Piper Story',
  author: 'Richard Hendricks',
}

const PNG_PIXEL = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0xfa, 0xcf, 0x00, 0x00,
  0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
])

/**
 * Build a minimal but spec-compliant EPUB zip in-memory for parser tests.
 * Returns the raw bytes ready to feed into JSZip.loadAsync.
 */
export async function buildEpubFixture (opts: EpubFixtureOptions = {}): Promise<Uint8Array> {
  const o = {
    ...DEFAULTS,
    ...opts,
  }
  const zip = new JSZip()

  zip.file('mimetype', 'application/epub+zip')
  zip.file('META-INF/container.xml', containerXml())

  const opfPath = 'OEBPS/content.opf'
  zip.file(opfPath, opfXml(o))

  if (o.withCover !== false) {
    const coverData = o.coverData ?? PNG_PIXEL
    zip.file('OEBPS/cover.png', coverData)
  }

  if (o.spine) {
    for (const entry of o.spine) {
      const body = entry.body ?? `<h1>${escapeXml(entry.id)}</h1>`
      zip.file(`OEBPS/${entry.href}`, [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<html xmlns="http://www.w3.org/1999/xhtml"><body>',
        body,
        '</body></html>',
      ].join('\n'))
    }
  }

  if (o.spine && o.nav) {
    zip.file('OEBPS/nav.xhtml', navXhtml(o.nav))
  }

  if (o.spine && o.ncx) {
    zip.file('OEBPS/toc.ncx', ncxXml(o.ncx))
  }

  return zip.generateAsync({
    type: 'uint8array',
  })
}

function navXhtml (entries: Array<{ title: string,
  href: string }>): string {
  const items = entries.map(e =>
    `      <li><a href="${escapeXml(e.href)}">${escapeXml(e.title)}</a></li>`,
  ).join('\n')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">',
    '<body>',
    '  <nav epub:type="toc">',
    '    <ol>',
    items,
    '    </ol>',
    '  </nav>',
    '</body></html>',
  ].join('\n')
}

function ncxXml (entries: Array<{ title: string,
  href: string }>): string {
  const points = entries.map((e, i) => [
    `    <navPoint id="np-${i + 1}" playOrder="${i + 1}">`,
    `      <navLabel><text>${escapeXml(e.title)}</text></navLabel>`,
    `      <content src="${escapeXml(e.href)}"/>`,
    '    </navPoint>',
  ].join('\n')).join('\n')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">',
    '  <navMap>',
    points,
    '  </navMap>',
    '</ncx>',
  ].join('\n')
}

function containerXml (): string {
  return [
    '<?xml version="1.0"?>',
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">',
    '  <rootfiles>',
    '    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>',
    '  </rootfiles>',
    '</container>',
  ].join('\n')
}

function opfXml (o: EpubFixtureOptions): string {
  const lines: string[] = []
  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push('<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">')
  lines.push('  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">')
  if (o.title) {
    lines.push(`    <dc:title>${escapeXml(o.title)}</dc:title>`)
  }
  if (o.author) {
    lines.push(`    <dc:creator>${escapeXml(o.author)}</dc:creator>`)
  }
  if (o.description) {
    lines.push(`    <dc:description>${escapeXml(o.description)}</dc:description>`)
  }
  if (o.publisher) {
    lines.push(`    <dc:publisher>${escapeXml(o.publisher)}</dc:publisher>`)
  }
  if (o.language) {
    lines.push(`    <dc:language>${escapeXml(o.language)}</dc:language>`)
  }
  if (o.subject) {
    lines.push(`    <dc:subject>${escapeXml(o.subject)}</dc:subject>`)
  }
  if (o.date) {
    lines.push(`    <dc:date>${escapeXml(o.date)}</dc:date>`)
  }
  if (o.isbn) {
    const scheme = o.isbnScheme ?? 'ISBN'
    lines.push(`    <dc:identifier id="bookid" opf:scheme="${escapeXml(scheme)}">${escapeXml(o.isbn)}</dc:identifier>`)
  }
  if (o.series) {
    lines.push(`    <meta name="calibre:series" content="${escapeXml(o.series)}"/>`)
  }
  if (o.seriesIndex) {
    lines.push(`    <meta name="calibre:series_index" content="${escapeXml(o.seriesIndex)}"/>`)
  }
  if (o.withCover !== false && o.coverViaMetaName) {
    lines.push('    <meta name="cover" content="cover-img"/>')
  }
  lines.push('  </metadata>')
  lines.push('  <manifest>')
  if (o.withCover !== false) {
    const mediaType = o.coverMediaType ?? 'image/png'
    const properties = o.coverViaMetaName ? '' : ' properties="cover-image"'
    lines.push(`    <item id="cover-img" href="cover.png" media-type="${escapeXml(mediaType)}"${properties}/>`)
  }
  if (o.spine) {
    for (const entry of o.spine) {
      lines.push(`    <item id="${escapeXml(entry.id)}" href="${escapeXml(entry.href)}" media-type="application/xhtml+xml"/>`)
    }
    if (o.nav) {
      lines.push('    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>')
    }
    if (o.ncx) {
      lines.push('    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>')
    }
  }
  lines.push('  </manifest>')
  if (o.spine) {
    const tocAttr = o.ncx ? ' toc="ncx"' : ''
    lines.push(`  <spine${tocAttr}>`)
    for (const entry of o.spine) {
      lines.push(`    <itemref idref="${escapeXml(entry.id)}"/>`)
    }
    lines.push('  </spine>')
  } else {
    lines.push('  <spine/>')
  }
  lines.push('</package>')
  return lines.join('\n')
}

function escapeXml (s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}
