import type {
  ArtworkReference,
  DiscoveredFile,
  EntityReference,
  IndexRequest,
  IndexResult,
  MatchDetailRequest,
  SearchRequest,
  SearchResult,
} from '@aviato-media/plugin-sdk'
import { createPlugin, getBundleField, getBundleValue, getConfidentCanonicalIds, mergeConfidentFields } from '@aviato-media/plugin-sdk'
import { extname } from 'path'

import {
  fetchArtist,
  fetchRecording,
  MusicBrainzError,
  primaryArtistName,
  searchRecordings,
} from './musicbrainz.js'
import {
  buildArtistEntity,
  buildReleaseGroupEntity,
  buildTrackResult,
  getCachedCoverArt,
  getCachedRelease,
  getCachedReleaseGroup,
  parseSearchQuery,
  pickBestRelease,
} from './recording.js'

// ── Audio extensions ─────────────────────────────────

const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.flac', '.ogg', '.m4a', '.aac', '.wav', '.wma', '.opus', '.aiff', '.alac', '.ape', '.wv',
])

// ── Plugin registration ──────────────────────────────

createPlugin({
  indexer: {
    async supports (file: DiscoveredFile): Promise<boolean> {
      const ext = extname(file.filename).toLowerCase()
      return AUDIO_EXTENSIONS.has(ext)
    },

    async index (request: IndexRequest): Promise<IndexResult> {
      const { file, metadata } = request
      const warnings: string[] = []

      // Extract bundle fields from ffprobe tags
      const title = getBundleValue(metadata.title)
      const artist = getBundleField(metadata, 'artist') as string | undefined
      const albumArtist = getBundleField(metadata, 'albumArtist') as string | undefined
      const album = getBundleField(metadata, 'album') as string | undefined
      const trackNumber = getBundleField(metadata, 'trackNumber') as number | undefined
      const trackTotal = getBundleField(metadata, 'trackTotal') as number | undefined
      const discNumber = getBundleField(metadata, 'discNumber') as number | undefined
      const discTotal = getBundleField(metadata, 'discTotal') as number | undefined
      const year = getBundleValue(metadata.year)
      const genre = getBundleField(metadata, 'genre') as string | undefined
      const duration = getBundleField(metadata, 'duration') as number | undefined

      const ffprobeFields = {
        artist,
        albumArtist,
        album,
        trackNumber,
        trackTotal,
        discNumber,
        discTotal,
        year,
        genre,
        duration,
      }

      try {
        // 1. Fast path: confident canonical IDs from prior indexing
        const confidentIds = getConfidentCanonicalIds(metadata)
        const existingMbid = confidentIds.find(e => e.provider === 'musicbrainz')?.id
        if (existingMbid) {
          const recording = await fetchRecording(existingMbid)
          if (recording) {
            const releaseStub = pickBestRelease(recording.releases, album)
            // Fetch full release detail to get release-group data
            const release = releaseStub ? await getCachedRelease(releaseStub.id) ?? releaseStub : undefined
            const result = await buildTrackResult(recording, release, genre, ffprobeFields)
            if (result.success && result.metadata) {
              mergeConfidentFields(metadata, result.metadata.fields)
              return result
            }
          }
          warnings.push('Canonical MBID lookup failed, falling back to search')
        }

        // 2. Need a title to search
        if (!title) {
          return {
            success: false,
            error: 'No title available in metadata bundle',
          }
        }

        // 3. Search MusicBrainz using ffprobe hints. Prefer albumArtist —
        // tracks frequently set `artist` to a per-track combined credit
        // ("Yo-Yo Ma, Kathryn Stott") that doesn't appear in MB's index,
        // while `albumArtist` holds the canonical primary artist.
        const searchArtist = primaryArtistName(albumArtist) ?? primaryArtistName(artist)
        const recordings = await searchRecordings(title, searchArtist, album)

        if (recordings.length === 0) {
          // No MB match — return ffprobe-only metadata
          return buildFallbackResult(file.filename, title, ffprobeFields, genre, warnings)
        }

        // 4. Take best match, fetch full details
        const bestRecording = recordings[0]
        const recording = await fetchRecording(bestRecording.id)
        if (!recording) {
          return buildFallbackResult(file.filename, title, ffprobeFields, genre, [
            ...warnings,
            'MusicBrainz recording detail fetch failed',
          ])
        }

        // 5. Pick the best release (prefer ffprobe album match), then fetch full detail
        const releaseStub = pickBestRelease(recording.releases, album)
        const release = releaseStub ? await getCachedRelease(releaseStub.id) ?? releaseStub : undefined

        // 6. Build full result
        const result = await buildTrackResult(recording, release, genre, ffprobeFields)
        if (result.success && result.metadata) {
          mergeConfidentFields(metadata, result.metadata.fields)
        }
        if (warnings.length > 0) {
          result.warnings = [...(result.warnings ?? []), ...warnings]
        }
        return result
      } catch (err) {
        if (err instanceof MusicBrainzError && err.retryable) {
          return {
            success: false,
            error: err.message,
            retryable: true,
          }
        }

        // Non-retryable error — degrade gracefully
        return buildFallbackResult(file.filename, title, ffprobeFields, genre, [
          `MusicBrainz lookup failed: ${err instanceof Error ? err.message : String(err)}`,
        ])
      }
    },

    async search (params: SearchRequest): Promise<SearchResult> {
      const { title, artist } = parseSearchQuery(params.query)

      try {
        const recordings = await searchRecordings(title, artist)
        return {
          results: recordings.map(r => {
            const { releases } = r
            const firstRelease = releases?.[0]
            const releaseDate = firstRelease?.date
            const yearNum = releaseDate ? parseInt(releaseDate.substring(0, 4), 10) || undefined : undefined
            const artistName = r['artist-credit']?.[0]?.artist?.name

            return {
              title: r.title,
              year: yearNum,
              overview: artistName ? `by ${artistName}` : undefined,
              canonicalIds: [{
                provider: 'musicbrainz',
                id: r.id,
                url: `https://musicbrainz.org/recording/${r.id}`,
              }],
            }
          }),
        }
      } catch {
        return {
          results: [],
        }
      }
    },

    async getMatchDetail (params: MatchDetailRequest): Promise<IndexResult> {
      const mbEntry = params.canonicalIds.find(e => e.provider === 'musicbrainz')
      if (!mbEntry) {
        return {
          success: false,
          error: 'No MusicBrainz ID provided',
        }
      }

      try {
        const recording = await fetchRecording(mbEntry.id)
        if (!recording) {
          return {
            success: false,
            error: 'Recording not found on MusicBrainz',
          }
        }

        const releaseStub = pickBestRelease(recording.releases)
        const release = releaseStub ? await getCachedRelease(releaseStub.id) ?? releaseStub : undefined
        return buildTrackResult(recording, release)
      } catch (err) {
        const retryable = err instanceof MusicBrainzError && err.retryable
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          retryable,
        }
      }
    },

    async getEntityDetail (request) {
      const mbid = request.externalIds?.find(e => e.provider === 'musicbrainz')?.id

      if (request.entityType === 'artist') {
        if (!mbid) {
          return {
            success: false,
            error: 'No MusicBrainz ID provided for artist',
          }
        }

        try {
          const artist = await fetchArtist(mbid)
          if (!artist) {
            return {
              success: false,
              error: 'Artist not found on MusicBrainz',
            }
          }

          const externalLinks = [{
            label: 'MusicBrainz',
            url: `https://musicbrainz.org/artist/${mbid}`,
          }]

          return {
            success: true,
            entity: {
              entityType: 'artist',
              name: artist.name,
              role: 'artist',
              complete: true,
              externalIds: [{
                provider: 'musicbrainz',
                id: mbid,
                url: `https://musicbrainz.org/artist/${mbid}`,
              }],
              metadata: {
                sortName: artist['sort-name'],
                ...(artist.type ? {
                  artistType: artist.type,
                } : {}),
                ...(artist.country ? {
                  country: artist.country,
                } : {}),
                ...(artist.disambiguation ? {
                  disambiguation: artist.disambiguation,
                } : {}),
                ...(artist['life-span'] ? {
                  lifeSpan: artist['life-span'],
                } : {}),
                ...(artist.area?.name ? {
                  area: artist.area.name,
                } : {}),
              },
              externalLinks,
            },
          }
        } catch (err) {
          const retryable = err instanceof MusicBrainzError && err.retryable
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
            retryable,
          }
        }
      }

      if (request.entityType === 'release-group') {
        if (!mbid) {
          return {
            success: false,
            error: 'No MusicBrainz ID provided for release-group',
          }
        }

        try {
          const rg = await getCachedReleaseGroup(mbid)
          if (!rg) {
            return {
              success: false,
              error: 'Release group not found on MusicBrainz',
            }
          }

          const artwork: ArtworkReference[] = []
          const coverArt = await getCachedCoverArt('release-group', mbid)
          if (coverArt) {
            artwork.push({
              type: 'poster',
              url: coverArt,
              aspect: 'square',
            })
          }

          // Re-derive parent artist from the release-group's artist credits
          const primaryArtist = rg['artist-credit']?.[0]?.artist
          const parentEntities: EntityReference[] = []
          if (primaryArtist) {
            parentEntities.push(buildArtistEntity(primaryArtist.id, primaryArtist.name))
          }

          return {
            success: true,
            entity: {
              entityType: 'release-group',
              name: rg.title,
              role: 'release-group',
              complete: true,
              externalIds: [{
                provider: 'musicbrainz',
                id: mbid,
                url: `https://musicbrainz.org/release-group/${mbid}`,
              }],
              parentEntities: parentEntities.length > 0 ? parentEntities : undefined,
              artwork: artwork.length > 0 ? artwork : undefined,
              metadata: {
                ...(rg['primary-type'] ? {
                  primaryType: rg['primary-type'],
                } : {}),
                ...(rg['first-release-date'] ? {
                  firstReleaseDate: rg['first-release-date'],
                } : {}),
                ...(rg['first-release-date'] ? {
                  year: parseInt(rg['first-release-date'].substring(0, 4), 10) || undefined,
                } : {}),
              },
              externalLinks: [{
                label: 'MusicBrainz',
                url: `https://musicbrainz.org/release-group/${mbid}`,
              }],
            },
          }
        } catch (err) {
          const retryable = err instanceof MusicBrainzError && err.retryable
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
            retryable,
          }
        }
      }

      if (request.entityType === 'release') {
        if (!mbid) {
          return {
            success: false,
            error: 'No MusicBrainz ID provided for release',
          }
        }

        try {
          const release = await getCachedRelease(mbid)
          if (!release) {
            return {
              success: false,
              error: 'Release not found on MusicBrainz',
            }
          }

          const artwork: ArtworkReference[] = []
          let coverArt = await getCachedCoverArt('release', mbid)
          if (!coverArt && release['release-group']) {
            coverArt = await getCachedCoverArt('release-group', release['release-group'].id)
          }
          if (coverArt) {
            artwork.push({
              type: 'poster',
              url: coverArt,
              aspect: 'square',
            })
          }

          // Parent is the release-group and the artist directly
          const parentEntities: EntityReference[] = []
          const rgStub = release['release-group']
          const primaryArtist = release['artist-credit']?.[0]?.artist
          if (rgStub) {
            // Need the artist for the release-group's parent
            if (primaryArtist) {
              const artistEntity = buildArtistEntity(primaryArtist.id, primaryArtist.name)
              parentEntities.push(buildReleaseGroupEntity(
                rgStub.id,
                rgStub.title,
                artistEntity,
              ))
              // Also add artist as a direct parent of the release so the
              // release detail page can surface the artist without traversing
              // the release-group hop.
              parentEntities.push(artistEntity)
            }
          }

          // Track count summary
          const totalTracks = release.media?.reduce((sum, m) => sum + m['track-count'], 0)

          return {
            success: true,
            entity: {
              entityType: 'release',
              name: release.title,
              role: 'release',
              complete: true,
              externalIds: [{
                provider: 'musicbrainz',
                id: mbid,
                url: `https://musicbrainz.org/release/${mbid}`,
              }],
              parentEntities: parentEntities.length > 0 ? parentEntities : undefined,
              artwork: artwork.length > 0 ? artwork : undefined,
              metadata: {
                ...(primaryArtist ? {
                  artistName: primaryArtist.name,
                } : {}),
                ...(release.date ? {
                  releaseDate: release.date,
                } : {}),
                ...(release.date ? {
                  year: parseInt(release.date.substring(0, 4), 10) || undefined,
                } : {}),
                ...(release.country ? {
                  country: release.country,
                } : {}),
                ...(release.status ? {
                  status: release.status,
                } : {}),
                ...(totalTracks ? {
                  totalTracks,
                } : {}),
                ...(release.media?.length ? {
                  discCount: release.media.length,
                } : {}),
              },
              externalLinks: [{
                label: 'MusicBrainz',
                url: `https://musicbrainz.org/release/${mbid}`,
              }],
            },
          }
        } catch (err) {
          const retryable = err instanceof MusicBrainzError && err.retryable
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
            retryable,
          }
        }
      }

      // Unsupported entity type
      return {
        success: false,
        unsupported: true,
        error: `Unsupported entity type: ${request.entityType}`,
      }
    },
  },
})

// ── Fallback result (ffprobe-only) ───────────────────

function buildFallbackResult (
  filename: string,
  title: string | undefined,
  fields: Record<string, unknown>,
  genre?: string,
  warnings?: string[],
): IndexResult {
  const entities: EntityReference[] = []

  const artist = fields.artist as string | undefined
  const albumArtist = fields.albumArtist as string | undefined

  if (artist) {
    entities.push({
      entityType: 'artist',
      name: artist,
      role: 'artist',
      complete: false,
    })
  }
  if (albumArtist && albumArtist !== artist) {
    entities.push({
      entityType: 'artist',
      name: albumArtist,
      role: 'album_artist',
      complete: false,
    })
  }
  if (genre) {
    entities.push({
      entityType: 'genre',
      name: genre,
      role: 'genre',
      complete: true,
    })
  }

  return {
    success: true,
    metadata: {
      title: title ?? filename,
      fields,
      entities,
      artwork: [],
    },
    warnings: warnings?.length ? warnings : undefined,
  }
}
