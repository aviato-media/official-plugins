// ── MusicBrainz + Cover Art Archive API client ───────

export class MusicBrainzError extends Error {
  constructor (message: string, public readonly retryable: boolean) {
    super(message)
    this.name = 'MusicBrainzError'
  }
}

const MB_BASE = 'https://musicbrainz.org/ws/2'
const CAA_BASE = 'https://coverartarchive.org'
const USER_AGENT = 'Aviato/1.0.0 (https://avia.to)'
const MB_RATE_MS = 1100
const MB_MAX_RETRIES = 3
const MB_RETRY_BASE_MS = 2000

let lastMbRequest = 0
// Concurrent callers must serialize through this chain — a plain
// check-then-set on lastMbRequest races and lets parallel JSON-RPC
// handlers fire requests within the same millisecond, which is what
// MusicBrainz actually 503s on.
let rateLimitChain: Promise<void> = Promise.resolve()

// ── Rate limiting ────────────────────────────────────

function rateLimitWait (): Promise<void> {
  const slot = rateLimitChain.then(async () => {
    const elapsed = Date.now() - lastMbRequest
    if (elapsed < MB_RATE_MS) {
      await new Promise(resolve => setTimeout(resolve, MB_RATE_MS - elapsed))
    }
    lastMbRequest = Date.now()
  })
  rateLimitChain = slot.catch(() => {})
  return slot
}

// ── Rate-limited fetch with retry ────────────────────

async function mbFetchOnce<T> (url: string): Promise<T | null> {
  await rateLimitWait()

  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    })
  } catch (err) {
    throw new MusicBrainzError(`MusicBrainz network error: ${(err as Error).message}`, true)
  }

  if (!res.ok) {
    if (res.status === 404) {
      return null
    }
    throw new MusicBrainzError(
      `MusicBrainz API error: ${res.status}`,
      res.status === 429 || res.status >= 500,
    )
  }

  return res.json() as Promise<T>
}

async function mbFetch<T> (url: string): Promise<T | null> {
  let lastErr: unknown
  for (let attempt = 0; attempt < MB_MAX_RETRIES; attempt++) {
    try {
      return await mbFetchOnce<T>(url)
    } catch (err) {
      lastErr = err
      if (!(err instanceof MusicBrainzError) || !err.retryable) {
        throw err
      }
      if (attempt === MB_MAX_RETRIES - 1) {
        break
      }
      // Exponential backoff: 2s, 4s, 8s (final attempt skipped above)
      const delay = MB_RETRY_BASE_MS * Math.pow(2, attempt)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  throw lastErr
}

// ── Test seam ────────────────────────────────────────

export const __testing = {
  rateLimitWait,
  resetRateLimiter (): void {
    lastMbRequest = 0
    rateLimitChain = Promise.resolve()
  },
}

// ── Lucene query escaping ────────────────────────────

function escapeLucene (value: string): string {
  return value.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&')
}

// ── Artist name normalization ────────────────────────

// Files often combine multiple performers into a single tag
// ("Yo-Yo Ma, Kathryn Stott", "Foo & Bar", "Foo feat. Bar"). MusicBrainz
// indexes credits per-artist, so a phrase query against the combined
// string never matches. Split on the first separator and use the lead.
export function primaryArtistName (name: string | undefined): string | undefined {
  if (!name) {
    return undefined
  }
  const trimmed = name.trim()
  if (!trimmed) {
    return undefined
  }
  const match = trimmed.match(/^(.+?)(?:\s*[,&/;]|\s+(?:feat\.?|ft\.?|featuring|with|vs\.?)\s)/i)
  return (match ? match[1] : trimmed).trim() || undefined
}

// ── Types ────────────────────────────────────────────

export interface MbArtistCredit {
  name: string
  joinphrase?: string
  artist: {
    id: string
    name: string
    'sort-name': string
    disambiguation?: string
  }
}

export interface MbReleaseGroupStub {
  id: string
  title: string
  'primary-type'?: string
}

export interface MbMedium {
  position: number
  'track-count': number
  format?: string
  tracks?: MbTrack[]
}

export interface MbTrack {
  position: number
  number: string
  title: string
  length: number | null
}

export interface MbRelease {
  id: string
  title: string
  date?: string
  country?: string
  status?: string
  'release-group'?: MbReleaseGroupStub
  'artist-credit'?: MbArtistCredit[]
  media?: MbMedium[]
}

export interface MbRecording {
  id: string
  title: string
  length: number | null
  'artist-credit'?: MbArtistCredit[]
  releases?: MbRelease[]
  score?: number
}

export interface MbReleaseGroup {
  id: string
  title: string
  'primary-type'?: string
  'secondary-types'?: string[]
  'first-release-date'?: string
  'artist-credit'?: MbArtistCredit[]
  releases?: Array<{ id: string,
    title: string,
    date?: string,
    status?: string }>
}

export interface MbArtist {
  id: string
  name: string
  'sort-name': string
  type?: string | null
  country?: string | null
  disambiguation?: string | null
  'life-span'?: {
    begin: string | null
    end: string | null
    ended: boolean
  }
  'begin-area'?: { name: string } | null
  'end-area'?: { name: string } | null
  area?: { name: string } | null
}

interface CoverArtResponse {
  images: Array<{
    front: boolean
    back: boolean
    image: string
    thumbnails: {
      small?: string
      large?: string
      '250'?: string
      '500'?: string
      '1200'?: string
    }
  }>
}

// ── Search ───────────────────────────────────────────

const MIN_SEARCH_SCORE = 50

export interface RecordingSearchTerms {
  title: string
  artist?: string
  album?: string
}

export function buildRecordingQuery (terms: RecordingSearchTerms): string {
  const parts = [`recording:"${escapeLucene(terms.title)}"`]
  if (terms.artist) {
    parts.push(`artist:"${escapeLucene(terms.artist)}"`)
  }
  if (terms.album) {
    parts.push(`release:"${escapeLucene(terms.album)}"`)
  }
  return parts.join(' AND ')
}

// Real-world tags rarely match MusicBrainz on all three fields at once,
// so try the strictest query first and progressively drop constraints.
// Title-alone is intentionally excluded — popular titles return thousands
// of unrelated recordings and would seed wrong canonical IDs.
export function buildSearchAttempts (terms: RecordingSearchTerms): RecordingSearchTerms[] {
  const { title, artist, album } = terms
  const attempts: RecordingSearchTerms[] = []
  if (artist && album) {
    attempts.push({
      title,
      artist,
      album,
    })
  }
  if (artist) {
    attempts.push({
      title,
      artist,
    })
  }
  if (album) {
    attempts.push({
      title,
      album,
    })
  }
  return attempts
}

async function fetchRecordingSearch (terms: RecordingSearchTerms): Promise<MbRecording[]> {
  const params = new URLSearchParams({
    query: buildRecordingQuery(terms),
    limit: '10',
    fmt: 'json',
  })
  const data = await mbFetch<{ recordings?: MbRecording[] }>(
    `${MB_BASE}/recording?${params}`,
  )
  const recordings = data?.recordings ?? []
  return recordings.filter(r => (r.score ?? 0) >= MIN_SEARCH_SCORE)
}

export async function searchRecordings (
  title: string,
  artist?: string,
  album?: string,
): Promise<MbRecording[]> {
  for (const attempt of buildSearchAttempts({
    title,
    artist,
    album,
  })) {
    const recordings = await fetchRecordingSearch(attempt)
    if (recordings.length > 0) {
      return recordings
    }
  }
  return []
}

// ── Fetch by MBID ────────────────────────────────────

export async function fetchRecording (mbid: string): Promise<MbRecording | null> {
  const params = new URLSearchParams({
    fmt: 'json',
    inc: 'releases+artist-credits+release-groups',
  })
  return mbFetch<MbRecording>(`${MB_BASE}/recording/${mbid}?${params}`)
}

export async function fetchRelease (mbid: string): Promise<MbRelease | null> {
  const params = new URLSearchParams({
    fmt: 'json',
    inc: 'artist-credits+release-groups+media',
  })
  return mbFetch<MbRelease>(`${MB_BASE}/release/${mbid}?${params}`)
}

export async function fetchReleaseGroup (mbid: string): Promise<MbReleaseGroup | null> {
  const params = new URLSearchParams({
    fmt: 'json',
    inc: 'artist-credits+releases',
  })
  return mbFetch<MbReleaseGroup>(`${MB_BASE}/release-group/${mbid}?${params}`)
}

export async function fetchArtist (mbid: string): Promise<MbArtist | null> {
  const params = new URLSearchParams({
    fmt: 'json',
  })
  return mbFetch<MbArtist>(`${MB_BASE}/artist/${mbid}?${params}`)
}

// ── Cover Art Archive ────────────────────────────────

export async function fetchCoverArtUrl (
  type: 'release' | 'release-group',
  mbid: string,
): Promise<string | null> {
  try {
    await rateLimitWait()

    const res = await fetch(`${CAA_BASE}/${type}/${mbid}`, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    })

    if (!res.ok) {
      return null
    }

    const data = await res.json() as CoverArtResponse
    if (!data.images || data.images.length === 0) {
      return null
    }

    // Prefer the front cover, fallback to first image
    const front = data.images.find(img => img.front)
    const image = front ?? data.images[0]

    // Prefer the 500px thumbnail for reasonable size, fall back to full image
    return image.thumbnails?.['500'] ?? image.thumbnails?.large ?? image.image
  } catch {
    return null
  }
}
