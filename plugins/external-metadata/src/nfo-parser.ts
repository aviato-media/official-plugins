import { XMLParser, XMLValidator } from 'fast-xml-parser'

export type NfoData = {
  title?: string
  originaltitle?: string
  year?: number
  rating?: number
  runtime?: number
  plot?: string
  tagline?: string
  studio?: string
  mpaa?: string
  edition?: string
  set?: string
  uniqueids: Array<{ type: string,
    id: string,
    default?: boolean }>
  genres: string[]
  directors: string[]
  actors: Array<{ name: string,
    role?: string,
    thumb?: string }>
  artwork: Array<{ type: 'poster' | 'backdrop' | 'thumbnail',
    url: string }>
}

const VALID_ROOTS = ['movie', 'episodedetails', 'tvshow', 'musicvideo', 'artist', 'album']

const CDATA_PROP = '__cdata'

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

const ARRAY_TAGS = new Set(['uniqueid', 'genre', 'director', 'actor', 'thumb'])

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: true,
  parseAttributeValue: false,
  trimValues: true,
  cdataPropName: CDATA_PROP,
  allowBooleanAttributes: true,
  isArray: (tagName) => ARRAY_TAGS.has(tagName),
})

export function parseNfo (xml: string): NfoData | null {
  // Validate before parsing — catches malformed XML and plain text
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

  // Find the root element — must be one of the valid NFO roots
  const rootKey = Object.keys(parsed).find(k => VALID_ROOTS.includes(k))
  if (!rootKey) {
    return null
  }

  const root = parsed[rootKey] as Record<string, unknown>

  // uniqueids
  const uniqueids = toArray(root['uniqueid'] as unknown).map((u) => {
    const obj = u as Record<string, unknown>
    const type = String(obj['@_type'] ?? '')
    const id = String(obj['#text'] ?? obj[CDATA_PROP] ?? '')
    const isDefault = obj['@_default'] === 'true' || obj['@_default'] === true
    if (isDefault) {
      return {
        type,
        id,
        default: true,
      }
    }
    return {
      type,
      id,
    }
  }).filter(u => u.type && u.id)

  // genres
  const genres = toArray(root['genre'] as unknown)
    .map(g => textValue(g))
    .filter((g): g is string => g !== undefined)

  // directors
  const directors = toArray(root['director'] as unknown)
    .map(d => textValue(d))
    .filter((d): d is string => d !== undefined)

  // actors
  const actors = toArray(root['actor'] as unknown).map((a) => {
    const obj = a as Record<string, unknown>
    const name = textValue(obj['name'])
    if (!name) {
      return null
    }
    const role = textValue(obj['role'])
    const rawThumb = obj['thumb']
    const thumb = Array.isArray(rawThumb) ? textValue(rawThumb[0]) : textValue(rawThumb)
    const actor: { name: string,
      role?: string,
      thumb?: string } = {
      name,
    }
    if (role !== undefined) {
      actor.role = role
    }
    if (thumb !== undefined) {
      actor.thumb = thumb
    }
    return actor
  }).filter((a): a is NonNullable<typeof a> => a !== null)

  // artwork: collect from <thumb aspect="..."> and <fanart><thumb>
  const artwork: NfoData['artwork'] = []

  for (const t of toArray(root['thumb'] as unknown)) {
    const obj = t as Record<string, unknown>
    const aspect = obj['@_aspect'] as string | undefined
    const url = textValue(obj['#text'] ?? obj[CDATA_PROP] ?? t)
    if (!url) {
      continue
    }
    if (aspect === 'poster') {
      artwork.push({
        type: 'poster',
        url,
      })
    }
    // other aspects (banner, landscape, thumb, etc.) and thumbs without aspect are skipped
    // fanart/backdrop handled separately below
  }

  const fanart = root['fanart'] as Record<string, unknown> | undefined
  if (fanart) {
    for (const t of toArray(fanart['thumb'] as unknown)) {
      const url = textValue(t)
      if (url) {
        artwork.push({
          type: 'backdrop',
          url,
        })
      }
    }
  }

  // set — either a plain string or an object with a <name> child
  let set: string | undefined
  const rawSet = root['set']
  if (typeof rawSet === 'string') {
    set = rawSet
  } else if (typeof rawSet === 'number') {
    set = String(rawSet)
  } else if (rawSet && typeof rawSet === 'object') {
    const setObj = rawSet as Record<string, unknown>
    set = textValue(setObj['name']) ?? textValue(rawSet)
  }

  const result: NfoData = {
    uniqueids,
    genres,
    directors,
    actors,
    artwork,
  }

  const title = textValue(root['title'])
  if (title !== undefined) {
    result.title = title
  }

  const originaltitle = textValue(root['originaltitle'])
  if (originaltitle !== undefined) {
    result.originaltitle = originaltitle
  }

  const rawYear = root['year']
  if (rawYear !== undefined) {
    const year = typeof rawYear === 'number' ? rawYear : parseInt(String(rawYear), 10)
    if (!isNaN(year)) {
      result.year = year
    }
  }

  const rawRating = root['rating']
  if (rawRating !== undefined) {
    const rating = typeof rawRating === 'number' ? rawRating : parseFloat(String(rawRating))
    if (!isNaN(rating)) {
      result.rating = rating
    }
  }

  const rawRuntime = root['runtime']
  if (rawRuntime !== undefined) {
    const runtime = typeof rawRuntime === 'number' ? rawRuntime : parseInt(String(rawRuntime), 10)
    if (!isNaN(runtime)) {
      result.runtime = runtime
    }
  }

  const plot = textValue(root['plot'])
  if (plot !== undefined) {
    result.plot = plot
  }

  const tagline = textValue(root['tagline'])
  if (tagline !== undefined) {
    result.tagline = tagline
  }

  const studio = textValue(root['studio'])
  if (studio !== undefined) {
    result.studio = studio
  }

  const mpaa = textValue(root['mpaa'])
  if (mpaa !== undefined) {
    result.mpaa = mpaa
  }

  const edition = textValue(root['edition'])
  if (edition !== undefined) {
    result.edition = edition
  }

  if (set !== undefined) {
    result.set = set
  }

  return result
}
