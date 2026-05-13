import { describe, expect, test } from 'bun:test'

import { parseDocx } from '../parsers/docx.js'
import { buildDocxFixture } from './fixtures/build-docx.js'

describe('parseDocx', () => {
  test('extracts core properties', async () => {
    const docx = await buildDocxFixture({
      title: 'Pied Piper Q3 OKRs',
      author: 'Jared Dunn',
      description: 'Aggressive but achievable.',
      subject: 'Strategy',
      language: 'en-US',
      created: '2015-09-15T12:00:00Z',
    })

    const result = (await parseDocx(docx)).metadata

    expect(result.title).toBe('Pied Piper Q3 OKRs')
    expect(result.author).toBe('Jared Dunn')
    expect(result.description).toBe('Aggressive but achievable.')
    expect(result.genre).toBe('Strategy')
    expect(result.language).toBe('en-US')
    expect(result.year).toBe(2015)
  })

  test('returns empty object for docx without core.xml', async () => {
    const empty = await buildDocxFixture({})
    // Even a fixture with no fields produces a valid (but empty) core.xml,
    // so this primarily exercises the parser's "all undefined" path.
    const result = (await parseDocx(empty)).metadata

    expect(result).toEqual({})
  })

  test('omits unset fields rather than emitting empty strings', async () => {
    const docx = await buildDocxFixture({
      title: 'Bachmanity',
    })

    const result = (await parseDocx(docx)).metadata

    expect(result.title).toBe('Bachmanity')
    expect(result.author).toBeUndefined()
    expect(result.description).toBeUndefined()
    expect(result.year).toBeUndefined()
  })
})
