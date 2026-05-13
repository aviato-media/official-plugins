import { describe, expect, it } from 'bun:test'

import { parseOpf } from '../opf-parser.js'

describe('parseOpf', () => {
  it('parses a Calibre-style audiobook OPF', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uuid_id" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>The Three-Body Problem</dc:title>
    <dc:creator opf:role="aut">Cixin Liu</dc:creator>
    <dc:creator opf:role="nrt">Luke Daniels</dc:creator>
    <dc:date>2014-11-11</dc:date>
    <dc:publisher>Tor Books</dc:publisher>
    <dc:language>en</dc:language>
    <dc:identifier opf:scheme="ISBN">9780765377067</dc:identifier>
    <dc:identifier opf:scheme="ASIN">B07P6ZXQHQ</dc:identifier>
    <dc:description>Earth makes contact with a hostile civilization.</dc:description>
    <dc:subject>Science Fiction</dc:subject>
    <dc:subject>Hard SF</dc:subject>
    <meta name="calibre:series" content="Remembrance of Earth's Past"/>
    <meta name="calibre:series_index" content="1"/>
  </metadata>
</package>`

    const result = parseOpf(xml)
    expect(result).not.toBeNull()
    expect(result!.title).toBe('The Three-Body Problem')
    expect(result!.authors).toEqual(['Cixin Liu'])
    expect(result!.narrators).toEqual(['Luke Daniels'])
    expect(result!.year).toBe(2014)
    expect(result!.publisher).toBe('Tor Books')
    expect(result!.language).toBe('en')
    expect(result!.description).toBe('Earth makes contact with a hostile civilization.')
    expect(result!.genres).toEqual(['Science Fiction', 'Hard SF'])
    expect(result!.uniqueids).toContainEqual({
      type: 'isbn',
      id: '9780765377067',
    })
    expect(result!.uniqueids).toContainEqual({
      type: 'asin',
      id: 'B07P6ZXQHQ',
    })
    expect(result!.series).toBe("Remembrance of Earth's Past")
    expect(result!.seriesPosition).toBe(1)
  })

  it('treats roleless dc:creator entries as authors', () => {
    const xml = `<package><metadata>
      <dc:title>Untitled</dc:title>
      <dc:creator>Plain Author</dc:creator>
    </metadata></package>`
    const result = parseOpf(xml)
    expect(result!.authors).toEqual(['Plain Author'])
    expect(result!.narrators).toEqual([])
  })

  it('handles a single dc:subject as a one-element list', () => {
    const xml = `<package><metadata>
      <dc:title>X</dc:title>
      <dc:subject>Drama</dc:subject>
    </metadata></package>`
    const result = parseOpf(xml)
    expect(result!.genres).toEqual(['Drama'])
  })

  it('parses urn:isbn: identifiers without an opf:scheme attribute', () => {
    const xml = `<package><metadata>
      <dc:title>X</dc:title>
      <dc:identifier>urn:isbn:9780000000000</dc:identifier>
    </metadata></package>`
    const result = parseOpf(xml)
    expect(result!.uniqueids).toEqual([{
      type: 'isbn',
      id: '9780000000000',
    }])
  })

  it('returns null for malformed XML', () => {
    expect(parseOpf('<package><metadata><dc:title>Unclosed')).toBeNull()
  })

  it('returns null for non-OPF XML', () => {
    expect(parseOpf('<rss><channel><title>Not OPF</title></channel></rss>')).toBeNull()
  })

  it('returns null when there is no metadata block', () => {
    expect(parseOpf('<package version="2.0"></package>')).toBeNull()
  })

  it('parses a year-only dc:date', () => {
    const xml = `<package><metadata>
      <dc:title>X</dc:title>
      <dc:date>2018</dc:date>
    </metadata></package>`
    const result = parseOpf(xml)
    expect(result!.year).toBe(2018)
  })

  it('skips dc:date that does not start with a year', () => {
    const xml = `<package><metadata>
      <dc:title>X</dc:title>
      <dc:date>circa 1900</dc:date>
    </metadata></package>`
    const result = parseOpf(xml)
    expect(result!.year).toBeUndefined()
  })

  it('handles multiple authors', () => {
    const xml = `<package><metadata>
      <dc:title>X</dc:title>
      <dc:creator opf:role="aut">First Author</dc:creator>
      <dc:creator opf:role="aut">Second Author</dc:creator>
    </metadata></package>`
    const result = parseOpf(xml)
    expect(result!.authors).toEqual(['First Author', 'Second Author'])
  })
})
