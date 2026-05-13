import { describe, expect, test } from 'bun:test'

import { mapInfo } from '../parsers/pdf.js'

describe('mapInfo', () => {
  test('maps standard Info-dict fields', () => {
    const out = mapInfo({
      total: 42,
      infoData: {
        Title: '  The Conjoined Triangles of Success  ',
        Author: 'Action Jack Barker',
        Subject: 'Management theory',
        Keywords: 'Hooli, Management, Triangles',
        CreationDate: new Date(Date.UTC(2016, 5, 1)),
      },
    })

    expect(out.title).toBe('The Conjoined Triangles of Success')
    expect(out.author).toBe('Action Jack Barker')
    expect(out.description).toBe('Management theory')
    expect(out.genre).toBe('Hooli')
    expect(out.year).toBe(2016)
    expect(out.pageCount).toBe(42)
  })

  test('falls back to D:YYYYMMDD raw date strings', () => {
    const out = mapInfo({
      total: 5,
      infoData: {
        Title: 'Tres Commas',
        CreationDate: 'D:20140724120000+00\'00\'',
      },
    })

    expect(out.year).toBe(2014)
    expect(out.pageCount).toBe(5)
  })

  test('returns empty object when infoData is null', () => {
    const out = mapInfo({
      total: 0,
      infoData: null,
    })

    expect(out).toEqual({})
  })

  test('omits empty/whitespace-only fields', () => {
    const out = mapInfo({
      total: 1,
      infoData: {
        Title: '   ',
        Author: '',
      },
    })

    expect(out.title).toBeUndefined()
    expect(out.author).toBeUndefined()
    expect(out.pageCount).toBe(1)
  })
})
