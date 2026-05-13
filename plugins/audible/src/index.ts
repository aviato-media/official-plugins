import type {
  DiscoveredFile,
  IndexRequest,
  IndexResult,
  MatchDetailRequest,
  SearchRequest,
  SearchResult,
} from '@aviato-media/plugin-sdk'
import {
  createPlugin,
  getBundleField,
  getBundleValue,
  getConfidentCanonicalIds,
} from '@aviato-media/plugin-sdk'
import { extname } from 'path'

import type { AudibleRegion } from './audnex.js'
import { asinLookup, AudibleError, isValidRegion, searchAudible } from './audnex.js'
import { buildIndexResult, buildSearchCandidate } from './result.js'

const SUPPORTED_EXTENSIONS = new Set(['.m4b', '.m4a', '.mp3'])

function parseConfig (raw: string | undefined): { region: AudibleRegion } {
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (typeof parsed.region === 'string' && isValidRegion(parsed.region)) {
        return {
          region: parsed.region,
        }
      }
    } catch {
      // fall through to default
    }
  }
  return {
    region: 'us',
  }
}

const config = parseConfig(process.env.AVIATO_PLUGIN_CONFIG)

function failureFromError (err: unknown): IndexResult {
  if (err instanceof AudibleError) {
    return {
      success: false,
      error: err.message,
      retryable: err.retryable,
    }
  }
  return {
    success: false,
    error: err instanceof Error ? err.message : String(err),
  }
}

createPlugin({
  indexer: {
    async supports (file: DiscoveredFile): Promise<boolean> {
      const ext = extname(file.filename).toLowerCase()
      return SUPPORTED_EXTENSIONS.has(ext)
    },

    async index (request: IndexRequest): Promise<IndexResult> {
      const { metadata } = request
      const warnings: string[] = []

      try {
        // 1. Fast path — confident canonical ASIN from a prior index pass
        const confident = getConfidentCanonicalIds(metadata)
        const existingAsin = confident.find(e => e.provider === 'audible')?.id
        if (existingAsin) {
          const book = await asinLookup(existingAsin, config.region)
          if (book) {
            return buildIndexResult({
              book,
              region: config.region,
            })
          }
          warnings.push('Audible ASIN lookup failed, falling back to search')
        }

        // 2. Need a title to do anything else
        const title = getBundleValue(metadata.title)
        if (!title) {
          return {
            success: false,
            error: 'No title available in metadata bundle',
          }
        }

        // The audiobook ingestion pipeline already collapses
        // album_artist/albumartist/artist into the `author` bundle field,
        // so a single read is sufficient.
        const author = getBundleField(metadata, 'author') as string | undefined

        const books = await searchAudible({
          title,
          author,
          region: config.region,
        })

        if (books.length === 0) {
          return {
            success: false,
            error: 'No Audible match found',
          }
        }

        const result = buildIndexResult({
          book: books[0],
          region: config.region,
        })
        if (warnings.length > 0) {
          result.warnings = [...(result.warnings ?? []), ...warnings]
        }
        return result
      } catch (err) {
        return failureFromError(err)
      }
    },

    async search (params: SearchRequest): Promise<SearchResult> {
      try {
        const books = await searchAudible({
          title: params.query,
          region: config.region,
        })
        return {
          results: books.map(b => buildSearchCandidate(b, config.region)),
        }
      } catch {
        return {
          results: [],
        }
      }
    },

    async getMatchDetail (params: MatchDetailRequest): Promise<IndexResult> {
      const audible = params.canonicalIds.find(e => e.provider === 'audible')
      if (!audible) {
        return {
          success: false,
          error: 'No Audible ASIN provided',
        }
      }

      try {
        const book = await asinLookup(audible.id, config.region)
        if (!book) {
          return {
            success: false,
            error: 'Audiobook not found on Audible',
          }
        }
        return buildIndexResult({
          book,
          region: config.region,
        })
      } catch (err) {
        return failureFromError(err)
      }
    },
  },
})
