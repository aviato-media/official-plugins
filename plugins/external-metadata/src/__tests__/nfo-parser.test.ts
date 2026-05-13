import { describe, expect, it } from 'bun:test'

import { parseNfo } from '../nfo-parser.js'

describe('parseNfo', () => {
  it('parses a complete movie NFO', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<movie>
  <title>Blade Runner</title>
  <originaltitle>Blade Runner</originaltitle>
  <year>1982</year>
  <rating>8.1</rating>
  <runtime>117</runtime>
  <plot>A blade runner must pursue and try to terminate four replicants.</plot>
  <tagline>Man has made his match... now it's his problem.</tagline>
  <studio>Warner Bros.</studio>
  <uniqueid type="imdb" default="true">tt0083658</uniqueid>
  <uniqueid type="tmdb">78</uniqueid>
  <genre>Science Fiction</genre>
  <genre>Drama</genre>
  <director>Ridley Scott</director>
  <actor>
    <name>Harrison Ford</name>
    <role>Rick Deckard</role>
    <thumb>https://image.tmdb.org/ford.jpg</thumb>
  </actor>
  <actor>
    <name>Rutger Hauer</name>
    <role>Roy Batty</role>
  </actor>
  <thumb aspect="poster">poster.jpg</thumb>
  <fanart>
    <thumb>fanart.jpg</thumb>
  </fanart>
</movie>`

    const result = parseNfo(xml)
    expect(result).not.toBeNull()
    expect(result!.title).toBe('Blade Runner')
    expect(result!.originaltitle).toBe('Blade Runner')
    expect(result!.year).toBe(1982)
    expect(result!.rating).toBe(8.1)
    expect(result!.runtime).toBe(117)
    expect(result!.plot).toBe('A blade runner must pursue and try to terminate four replicants.')
    expect(result!.tagline).toBe('Man has made his match... now it\'s his problem.')
    expect(result!.studio).toBe('Warner Bros.')
    expect(result!.uniqueids).toEqual([
      {
        type: 'imdb',
        id: 'tt0083658',
        default: true,
      },
      {
        type: 'tmdb',
        id: '78',
      },
    ])
    expect(result!.genres).toEqual(['Science Fiction', 'Drama'])
    expect(result!.directors).toEqual(['Ridley Scott'])
    expect(result!.actors).toEqual([
      {
        name: 'Harrison Ford',
        role: 'Rick Deckard',
        thumb: 'https://image.tmdb.org/ford.jpg',
      },
      {
        name: 'Rutger Hauer',
        role: 'Roy Batty',
      },
    ])
    expect(result!.artwork).toEqual([
      {
        type: 'poster',
        url: 'poster.jpg',
      },
      {
        type: 'backdrop',
        url: 'fanart.jpg',
      },
    ])
  })

  it('parses a minimal NFO with just title', () => {
    const xml = '<movie><title>Interstellar</title></movie>'
    const result = parseNfo(xml)
    expect(result).not.toBeNull()
    expect(result!.title).toBe('Interstellar')
    expect(result!.uniqueids).toEqual([])
    expect(result!.genres).toEqual([])
    expect(result!.directors).toEqual([])
    expect(result!.actors).toEqual([])
    expect(result!.artwork).toEqual([])
  })

  it('parses episodedetails root element', () => {
    const xml = `<episodedetails>
  <title>Pilot</title>
  <year>2014</year>
  <uniqueid type="tvdb">123456</uniqueid>
</episodedetails>`

    const result = parseNfo(xml)
    expect(result).not.toBeNull()
    expect(result!.title).toBe('Pilot')
    expect(result!.year).toBe(2014)
    expect(result!.uniqueids).toEqual([{
      type: 'tvdb',
      id: '123456',
    }])
  })

  it('handles single genre as string (not array)', () => {
    const xml = '<movie><title>Test</title><genre>Action</genre></movie>'
    const result = parseNfo(xml)
    expect(result!.genres).toEqual(['Action'])
  })

  it('handles single actor element', () => {
    const xml = `<movie>
  <title>Test</title>
  <actor><name>Solo Actor</name></actor>
</movie>`
    const result = parseNfo(xml)
    expect(result!.actors).toEqual([{
      name: 'Solo Actor',
    }])
  })

  it('handles CDATA in plot', () => {
    const xml = `<movie>
  <title>Test</title>
  <plot><![CDATA[This is a <b>bold</b> plot summary.]]></plot>
</movie>`
    const result = parseNfo(xml)
    expect(result!.plot).toBe('This is a <b>bold</b> plot summary.')
  })

  it('returns null for malformed XML', () => {
    const result = parseNfo('<movie><title>Unclosed')
    expect(result).toBeNull()
  })

  it('returns null for non-XML NFO (ASCII art)', () => {
    const result = parseNfo(`
 Some scene release info here
 Another line of text
    `)
    expect(result).toBeNull()
  })

  it('returns null for unrecognized root element', () => {
    const result = parseNfo('<html><body>Not an NFO</body></html>')
    expect(result).toBeNull()
  })

  it('handles set as string', () => {
    const xml = '<movie><title>Test</title><set>The Matrix Collection</set></movie>'
    const result = parseNfo(xml)
    expect(result!.set).toBe('The Matrix Collection')
  })

  it('handles set as object with name child', () => {
    const xml = '<movie><title>Test</title><set><name>The Matrix Collection</name></set></movie>'
    const result = parseNfo(xml)
    expect(result!.set).toBe('The Matrix Collection')
  })

  it('handles edition field', () => {
    const xml = '<movie><title>Test</title><edition>Director\'s Cut</edition></movie>'
    const result = parseNfo(xml)
    expect(result!.edition).toBe("Director's Cut")
  })

  it('handles thumb with aspect="poster"', () => {
    const xml = `<movie>
  <title>Test</title>
  <thumb aspect="poster">poster.jpg</thumb>
  <thumb aspect="banner">banner.jpg</thumb>
</movie>`
    const result = parseNfo(xml)
    expect(result!.artwork).toContainEqual({
      type: 'poster',
      url: 'poster.jpg',
    })
  })

  it('handles multiple directors', () => {
    const xml = `<movie>
  <title>Test</title>
  <director>Lana Wachowski</director>
  <director>Lilly Wachowski</director>
</movie>`
    const result = parseNfo(xml)
    expect(result!.directors).toEqual(['Lana Wachowski', 'Lilly Wachowski'])
  })

  it('extracts mpaa field', () => {
    const xml = '<movie><title>Test</title><mpaa>PG-13</mpaa></movie>'
    const result = parseNfo(xml)
    expect(result!.mpaa).toBe('PG-13')
  })

  it('ignores thumb without aspect attribute', () => {
    const xml = `<movie>
  <title>Test</title>
  <thumb>https://example.com/some-image.jpg</thumb>
  <thumb aspect="poster">poster.jpg</thumb>
</movie>`
    const result = parseNfo(xml)
    expect(result!.artwork).toEqual([{
      type: 'poster',
      url: 'poster.jpg',
    }])
  })
})
