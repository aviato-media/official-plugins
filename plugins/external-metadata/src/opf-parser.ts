import { XMLParser, XMLValidator } from 'fast-xml-parser'

/**
 * Subset of EPUB OPF (Open Packaging Format) metadata that we care about.
 * The OPF root is `<package>` with a child `<metadata>` element using
 * Dublin Core elements. Calibre often writes a sibling metadata.opf file
 * next to ebook files — that's the common sidecar form we parse here.
 */
export interface OpfData {
  title?: string
  description?: string
  publisher?: string
  language?: string
  /** Year extracted from dc:date (any ISO-like prefix). */
  year?: number
  /** Authors — dc:creator with role="aut" or no role. */
  authors: string[]
  /** Narrators — dc:creator with role="nrt". Common in audiobook OPFs. */
  narrators: string[]
  /** dc:subject values. Each subject is treated as a genre. */
  genres: string[]
  /** Canonical identifiers, keyed by scheme (isbn/asin/etc.). */
  uniqueids: Array<{ type: string,
    id: string }>
  /** Calibre-style series metadata. */
  series?: string
  seriesPosition?: number
}

const CDATA_PROP = '__cdata'
const ARRAY_TAGS = new Set(['dc:creator', 'dc:identifier', 'dc:subject', 'meta'])

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: true,
  parseAttributeValue: false,
  trimValues: true,
  cdataPropName: CDATA_PROP,
  removeNSPrefix: false,
  isArray: (tagName) => ARRAY_TAGS.has(tagName),
})

function toArray<T> (val: T | T[] | undefined | null): T[] {
  if (val === undefined || val === null) {
    return []
  }
  return Array.isArray(val) ? val : [val]
}

function textValue (val: unknown): string | undefined {
  if (val === undefined || val === null) {
    return undefined
  }
  if (typeof val === 'string') {
    return val
  }
  if (typeof val === 'number') {
    return String(val)
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>
    if (CDATA_PROP in obj) {
      return String(obj[CDATA_PROP])
    }
    if ('#text' in obj) {
      return String(obj['#text'])
    }
  }
  return undefined
}

function parseYear (raw: unknown): number | undefined {
  const text = textValue(raw)
  if (!text) {
    return undefined
  }
  const match = /^(\d{4})/.exec(text.trim())
  if (!match) {
    return undefined
  }
  const year = parseInt(match[1], 10)
  if (year < 1000 || year > 3000) {
    return undefined
  }
  return year
}

/**
 * dc:creator carries a role attribute that distinguishes authors from
 * narrators (common in audiobook OPFs). The attribute is namespace-prefixed
 * — opf:role most commonly, but Calibre and other tools occasionally
 * emit a bare `role`. Accept either form.
 */
function creatorRole (creator: Record<string, unknown>): string | undefined {
  const role = creator['@_opf:role'] ?? creator['@_role']
  if (typeof role !== 'string') {
    return undefined
  }
  return role.toLowerCase()
}

/**
 * Identifier scheme is on `opf:scheme` (or bare `scheme`). Some OPFs use
 * urn:isbn: prefix in the value rather than a scheme attribute — handle
 * both. Returned scheme is lowercased.
 */
function identifierScheme (id: Record<string, unknown>, value: string): string | undefined {
  const scheme = id['@_opf:scheme'] ?? id['@_scheme']
  if (typeof scheme === 'string' && scheme.length > 0) {
    return scheme.toLowerCase()
  }
  const urnMatch = /^urn:([a-z]+):/i.exec(value)
  if (urnMatch) {
    return urnMatch[1].toLowerCase()
  }
  return undefined
}

function stripUrn (value: string): string {
  return value.replace(/^urn:[a-z]+:/i, '')
}

/**
 * Parse an OPF document. Returns null for malformed XML, non-OPF roots,
 * or input that is not XML at all (e.g. a stray text file with the .opf
 * extension).
 */
export function parseOpf (xml: string): OpfData | null {
  const validation = XMLValidator.validate(xml)
  if (validation !== true) {
    return null
  }

  let parsed: Record<string, unknown>
  try {
    parsed = xmlParser.parse(xml) as Record<string, unknown>
  } catch {
    return null
  }

  const pkg = parsed['package'] as Record<string, unknown> | undefined
  if (!pkg) {
    return null
  }

  const metadata = pkg['metadata'] as Record<string, unknown> | undefined
  if (!metadata) {
    return null
  }

  const result: OpfData = {
    authors: [],
    narrators: [],
    genres: [],
    uniqueids: [],
  }

  const title = textValue(metadata['dc:title'])
  if (title) {
    result.title = title
  }

  const description = textValue(metadata['dc:description'])
  if (description) {
    result.description = description
  }

  const publisher = textValue(metadata['dc:publisher'])
  if (publisher) {
    result.publisher = publisher
  }

  const language = textValue(metadata['dc:language'])
  if (language) {
    result.language = language
  }

  const year = parseYear(metadata['dc:date'])
  if (year !== undefined) {
    result.year = year
  }

  // Creators — partition by role into authors vs narrators.
  for (const c of toArray(metadata['dc:creator'] as unknown)) {
    const obj = c as Record<string, unknown>
    const name = textValue(obj)
    if (!name) {
      continue
    }
    const role = creatorRole(obj)
    if (role === 'nrt') {
      result.narrators.push(name)
    } else {
      // Default role for dc:creator is author per OPF/EPUB convention.
      result.authors.push(name)
    }
  }

  // Subjects — flat list of genres.
  for (const s of toArray(metadata['dc:subject'] as unknown)) {
    const value = textValue(s)
    if (value) {
      result.genres.push(value)
    }
  }

  // Identifiers — keyed by scheme (or urn: prefix).
  for (const id of toArray(metadata['dc:identifier'] as unknown)) {
    const obj = id as Record<string, unknown>
    const value = textValue(obj)
    if (!value) {
      continue
    }
    const scheme = identifierScheme(obj, value)
    if (!scheme) {
      continue
    }
    result.uniqueids.push({
      type: scheme,
      id: stripUrn(value),
    })
  }

  // Calibre series metadata is encoded as <meta name="calibre:series" content="…"/>.
  for (const m of toArray(metadata['meta'] as unknown)) {
    const obj = m as Record<string, unknown>
    const name = obj['@_name']
    const content = obj['@_content']
    if (typeof name !== 'string' || typeof content !== 'string') {
      continue
    }
    if (name === 'calibre:series') {
      result.series = content
    } else if (name === 'calibre:series_index') {
      const idx = parseFloat(content)
      if (!Number.isNaN(idx)) {
        result.seriesPosition = idx
      }
    }
  }

  return result
}
