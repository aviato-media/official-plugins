// ── Audible / audnex.us API client ───────────────────
//
// Two upstream APIs are used:
//   1. https://api.audnex.us/books/{asin}  — community-maintained mirror that
//      returns rich metadata (authors, narrators, summary, series, etc.).
//   2. https://api.audible{tld}/1.0/catalog/products  — the official Audible
//      catalog search. Only `asin` is harvested from the response; all rich
//      metadata is then fetched from audnex.us.
//
// Both endpoints are rate-limited inside this module (single in-flight
// request, ~600ms gap) and retry on 429/5xx with exponential backoff.

export class AudibleError extends Error {
  constructor (message: string, public readonly retryable: boolean) {
    super(message)
    this.name = 'AudibleError'
  }
}

export type AudibleRegion
  = | 'us' | 'ca' | 'uk' | 'au' | 'fr' | 'de' | 'jp' | 'it' | 'in' | 'es'

export const REGION_TLD: Record<AudibleRegion, string> = {
  us: '.com',
  ca: '.ca',
  uk: '.co.uk',
  au: '.com.au',
  fr: '.fr',
  de: '.de',
  jp: '.co.jp',
  it: '.it',
  in: '.in',
  es: '.es',
}

export function isValidRegion (value: string | undefined): value is AudibleRegion {
  return !!value && Object.prototype.hasOwnProperty.call(REGION_TLD, value)
}

export function isValidAsin (value: string | undefined): boolean {
  if (!value) {
    return false
  }
  return /^[A-Z0-9]{10}$/.test(value)
}

const AUDNEX_BASE = 'https://api.audnex.us'
const USER_AGENT = 'Aviato/1.0.0 (https://avia.to)'
const REQUEST_TIMEOUT_MS = 10_000
const RATE_GAP_MS = 600
const MAX_RETRIES = 3
const RETRY_BASE_MS = 2000

let lastRequestAt = 0
let rateLimitChain: Promise<void> = Promise.resolve()

function rateLimitWait (): Promise<void> {
  const slot = rateLimitChain.then(async () => {
    const elapsed = Date.now() - lastRequestAt
    if (elapsed < RATE_GAP_MS) {
      await new Promise(resolve => setTimeout(resolve, RATE_GAP_MS - elapsed))
    }
    lastRequestAt = Date.now()
  })
  rateLimitChain = slot.catch(() => {})
  return slot
}

async function fetchOnce<T> (url: string): Promise<T | null> {
  await rateLimitWait()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
      signal: controller.signal,
    })
  } catch (err) {
    throw new AudibleError(`Audible network error: ${(err as Error).message}`, true)
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    if (res.status === 404) {
      return null
    }
    throw new AudibleError(
      `Audible API error: ${res.status}`,
      res.status === 429 || res.status >= 500,
    )
  }

  return res.json() as Promise<T>
}

async function fetchWithRetry<T> (url: string): Promise<T | null> {
  let lastErr: unknown
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fetchOnce<T>(url)
    } catch (err) {
      lastErr = err
      if (!(err instanceof AudibleError) || !err.retryable) {
        throw err
      }
      if (attempt === MAX_RETRIES - 1) {
        break
      }
      const delay = RETRY_BASE_MS * Math.pow(2, attempt)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  throw lastErr
}

// ── Test seam ────────────────────────────────────────

export const __testing = {
  buildAsinUrl,
  buildCatalogSearchUrl,
  resetRateLimiter (): void {
    lastRequestAt = 0
    rateLimitChain = Promise.resolve()
  },
}

// ── URL builders ─────────────────────────────────────

function buildAsinUrl (asin: string, region?: string): string {
  const url = new URL(`${AUDNEX_BASE}/books/${encodeURIComponent(asin)}`)
  if (region) {
    url.searchParams.set('region', region)
  }
  return url.toString()
}

function buildCatalogSearchUrl (
  title: string,
  author: string | undefined,
  region: AudibleRegion,
): string {
  const tld = REGION_TLD[region]
  const url = new URL(`https://api.audible${tld}/1.0/catalog/products`)
  url.searchParams.set('num_results', '10')
  url.searchParams.set('products_sort_by', 'Relevance')
  url.searchParams.set('title', title)
  if (author) {
    url.searchParams.set('author', author)
  }
  return url.toString()
}

// ── Public types ─────────────────────────────────────

export interface AudnexAuthor {
  asin?: string
  name: string
}

export interface AudnexNarrator {
  name: string
}

export interface AudnexGenre {
  asin?: string
  name: string
  type: 'genre' | 'tag' | string
}

export interface AudnexSeries {
  asin?: string
  name: string
  position?: string
}

export interface AudnexBook {
  asin: string
  title: string
  subtitle?: string
  authors?: AudnexAuthor[]
  narrators?: AudnexNarrator[]
  publisherName?: string
  summary?: string
  releaseDate?: string
  image?: string
  isbn?: string
  language?: string
  formatType?: string
  region?: string
  rating?: string
  runtimeLengthMin?: number
  genres?: AudnexGenre[]
  seriesPrimary?: AudnexSeries
  seriesSecondary?: AudnexSeries
}

export interface AudibleCatalogStub {
  asin: string
}

export interface AudibleCatalogResponse {
  products?: AudibleCatalogStub[]
}

// ── Public API ───────────────────────────────────────

export async function asinLookup (
  asin: string,
  region?: string,
): Promise<AudnexBook | null> {
  const normalized = asin.toUpperCase()
  if (!isValidAsin(normalized)) {
    return null
  }
  const url = buildAsinUrl(normalized, region)
  const data = await fetchWithRetry<AudnexBook>(url)
  if (!data || !data.asin) {
    return null
  }
  return data
}

export async function catalogSearch (
  title: string,
  author: string | undefined,
  region: AudibleRegion,
): Promise<AudibleCatalogStub[]> {
  const url = buildCatalogSearchUrl(title, author, region)
  const data = await fetchWithRetry<AudibleCatalogResponse>(url)
  return data?.products ?? []
}

/**
 * High-level search. Mirrors the original Audiobookshelf provider's flow:
 *   1. If `asin` is a valid ASIN → direct lookup.
 *   2. If `title` is itself a valid ASIN → direct lookup.
 *   3. Otherwise → catalog search by title (+ author), then sequentially
 *      fetch each result's full record from audnex.us.
 *
 * Sequential (not parallel) detail fetches respect audnex.us being
 * community-run; the rate limiter would serialize them anyway.
 */
export async function searchAudible (params: {
  title: string
  author?: string
  asin?: string
  region: AudibleRegion
}): Promise<AudnexBook[]> {
  const { title, author, asin, region } = params

  if (asin && isValidAsin(asin.toUpperCase())) {
    const item = await asinLookup(asin, region)
    if (item) {
      return [item]
    }
  }

  if (isValidAsin(title.toUpperCase())) {
    const item = await asinLookup(title, region)
    if (item) {
      return [item]
    }
  }

  const stubs = await catalogSearch(title, author, region)
  const items: AudnexBook[] = []
  for (const stub of stubs) {
    if (!stub.asin) {
      continue
    }
    const detail = await asinLookup(stub.asin, region).catch(() => null)
    if (detail) {
      items.push(detail)
    }
  }
  return items
}
