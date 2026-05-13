import type {
  ArtworkReference,
  EntityReference,
  ExternalId,
  IndexResult,
} from '@aviato-media/plugin-sdk'

import type { MbArtistCredit, MbRecording, MbRelease, MbReleaseGroup } from './musicbrainz.js'
import { fetchCoverArtUrl, fetchRelease, fetchReleaseGroup } from './musicbrainz.js'

// ── Per-process caches (multi-track album efficiency) ─

const releaseGroupCache = new Map<string, MbReleaseGroup | null>()
const releaseCache = new Map<string, MbRelease | null>()
const coverArtCache = new Map<string, string | null>()

// ── Cache helpers ────────────────────────────────────

export async function getCachedRelease (mbid: string): Promise<MbRelease | null> {
  if (releaseCache.has(mbid)) {
    return releaseCache.get(mbid) ?? null
  }
  const release = await fetchRelease(mbid)
  releaseCache.set(mbid, release)
  return release
}

export async function getCachedReleaseGroup (mbid: string): Promise<MbReleaseGroup | null> {
  if (releaseGroupCache.has(mbid)) {
    return releaseGroupCache.get(mbid) ?? null
  }
  const rg = await fetchReleaseGroup(mbid)
  releaseGroupCache.set(mbid, rg)
  return rg
}

export async function getCachedCoverArt (
  type: 'release' | 'release-group',
  mbid: string,
): Promise<string | null> {
  const key = `${type}/${mbid}`
  if (coverArtCache.has(key)) {
    return coverArtCache.get(key) ?? null
  }
  const url = await fetchCoverArtUrl(type, mbid)
  coverArtCache.set(key, url)
  return url
}

// ── Artist credit helpers ────────────────────────────

function getPrimaryArtist (credits?: MbArtistCredit[]): { id: string,
  name: string } | null {
  if (!credits || credits.length === 0) {
    return null
  }
  const first = credits[0]
  return {
    id: first.artist.id,
    name: first.artist.name,
  }
}

function getFullArtistName (credits?: MbArtistCredit[]): string | undefined {
  if (!credits || credits.length === 0) {
    return undefined
  }
  return credits.map(c => c.name + (c.joinphrase ?? '')).join('')
}

// ── Release selection ────────────────────────────────

/**
 * Pick the best release from a recording's release list.
 * Prefers releases matching the ffprobe album tag (case-insensitive),
 * then falls back to the earliest dated release.
 */
export function pickBestRelease (
  releases: MbRelease[] | undefined,
  albumHint?: string,
): MbRelease | undefined {
  if (!releases || releases.length === 0) {
    return undefined
  }

  // Try exact match on album name first
  if (albumHint) {
    const hint = albumHint.toLowerCase()
    const match = releases.find(r => r.title.toLowerCase() === hint)
    if (match) {
      return match
    }
  }

  // Fall back to earliest dated release
  const sorted = [...releases].sort((a, b) => {
    const dateA = a.date ?? '9999'
    const dateB = b.date ?? '9999'
    return dateA.localeCompare(dateB)
  })
  return sorted[0]
}

// ── Build entity references ──────────────────────────

export function buildArtistEntity (
  artistId: string,
  artistName: string,
): EntityReference {
  return {
    entityType: 'artist',
    name: artistName,
    role: 'artist',
    complete: false,
    externalIds: [{
      provider: 'musicbrainz',
      id: artistId,
      url: `https://musicbrainz.org/artist/${artistId}`,
    }],
  }
}

export function buildReleaseGroupEntity (
  rgId: string,
  rgTitle: string,
  artistEntity: EntityReference,
  artwork?: ArtworkReference[],
  metadata?: Record<string, unknown>,
): EntityReference {
  return {
    entityType: 'release-group',
    name: rgTitle,
    role: 'release-group',
    complete: false,
    externalIds: [{
      provider: 'musicbrainz',
      id: rgId,
      url: `https://musicbrainz.org/release-group/${rgId}`,
    }],
    parentEntities: [artistEntity],
    ...(artwork && artwork.length > 0 ? {
      artwork,
    } : {}),
    ...(metadata ? {
      metadata,
    } : {}),
  }
}

export function buildReleaseEntity (
  releaseId: string,
  releaseTitle: string,
  releaseGroupEntity: EntityReference,
  artwork?: ArtworkReference[],
  metadata?: Record<string, unknown>,
): EntityReference {
  return {
    entityType: 'release',
    name: releaseTitle,
    role: 'release',
    complete: false,
    externalIds: [{
      provider: 'musicbrainz',
      id: releaseId,
      url: `https://musicbrainz.org/release/${releaseId}`,
    }],
    parentEntities: [releaseGroupEntity],
    ...(artwork && artwork.length > 0 ? {
      artwork,
    } : {}),
    ...(metadata ? {
      metadata,
    } : {}),
  }
}

// ── Build full track IndexResult ─────────────────────

export async function buildTrackResult (
  recording: MbRecording,
  release: MbRelease | undefined,
  genre?: string,
  ffprobeFields?: Record<string, unknown>,
): Promise<IndexResult> {
  const entities: EntityReference[] = []
  const artwork: ArtworkReference[] = []
  const fields: Record<string, unknown> = {}

  // Recording fields
  fields.mbid = recording.id
  if (recording.length) {
    fields.duration = Math.round(recording.length / 1000)
  }

  // Artist from recording credits
  const artistCredit = recording['artist-credit']
  const primaryArtist = getPrimaryArtist(artistCredit)
  const fullArtistName = getFullArtistName(artistCredit)
  if (fullArtistName) {
    fields.artist = fullArtistName
  }

  let artistEntity: EntityReference | undefined
  if (primaryArtist) {
    artistEntity = buildArtistEntity(primaryArtist.id, primaryArtist.name)
    entities.push(artistEntity)
  }

  // Release and release-group
  if (release) {
    const rgStub = release['release-group']
    fields.album = release.title
    fields.releaseMbid = release.id
    if (release.date) {
      fields.releaseDate = release.date
      const year = parseInt(release.date.substring(0, 4), 10)
      if (!isNaN(year)) {
        fields.year = year
      }
    }

    // Album artist (may differ from recording artist)
    const releaseArtist = getFullArtistName(release['artist-credit'])
    if (releaseArtist && releaseArtist !== fullArtistName) {
      fields.albumArtist = releaseArtist
    }

    // Track position from release media
    if (release.media && ffprobeFields) {
      const discNumber = ffprobeFields.discNumber as number | undefined
      const trackNumber = ffprobeFields.trackNumber as number | undefined
      if (discNumber !== undefined) {
        const medium = release.media.find(m => m.position === discNumber)
        if (medium) {
          fields.trackTotal = medium['track-count']
        }
        fields.discTotal = release.media.length
      } else if (release.media.length === 1) {
        fields.trackTotal = release.media[0]['track-count']
        fields.discTotal = 1
      }
      // Preserve ffprobe track/disc numbers
      if (trackNumber !== undefined) {
        fields.trackNumber = trackNumber
      }
      if (discNumber !== undefined) {
        fields.discNumber = discNumber
      }
    }

    // Cover art — try release first, then release-group
    let coverArtUrl = await getCachedCoverArt('release', release.id)
    if (!coverArtUrl && rgStub) {
      coverArtUrl = await getCachedCoverArt('release-group', rgStub.id)
    }
    if (coverArtUrl) {
      artwork.push({
        type: 'poster',
        url: coverArtUrl,
        aspect: 'square',
      })
    }

    // Release entity
    if (rgStub && artistEntity) {
      fields.releaseGroupMbid = rgStub.id

      const rgArtwork: ArtworkReference[] = coverArtUrl
        ? [{
          type: 'poster',
          url: coverArtUrl,
          aspect: 'square',
        }]
        : []

      const releaseGroupEntity = buildReleaseGroupEntity(
        rgStub.id,
        rgStub.title,
        artistEntity,
        rgArtwork,
        rgStub['primary-type'] ? {
          primaryType: rgStub['primary-type'],
        } : undefined,
      )
      entities.push(releaseGroupEntity)

      const releaseEntity = buildReleaseEntity(
        release.id,
        release.title,
        releaseGroupEntity,
        rgArtwork,
        {
          ...(release.date ? {
            releaseDate: release.date,
          } : {}),
          ...(release.country ? {
            country: release.country,
          } : {}),
          ...(release.status ? {
            status: release.status,
          } : {}),
        },
      )
      entities.push(releaseEntity)
    }
  }

  // Genre entity
  if (genre) {
    entities.push({
      entityType: 'genre',
      name: genre,
      role: 'genre',
      complete: true,
    })
  }

  // Canonical IDs for the recording (library item level)
  const canonicalIds: ExternalId[] = [{
    provider: 'musicbrainz',
    id: recording.id,
    url: `https://musicbrainz.org/recording/${recording.id}`,
  }]

  return {
    success: true,
    metadata: {
      title: recording.title,
      fields,
      canonicalIds,
      entities,
      artwork,
    },
  }
}

// ── Search helper (for search() handler) ─────────────

export function parseSearchQuery (query: string): { title: string,
  artist?: string } {
  const dashIdx = query.indexOf(' - ')
  if (dashIdx > 0) {
    return {
      artist: query.substring(0, dashIdx),
      title: query.substring(dashIdx + 3),
    }
  }
  return {
    title: query,
  }
}
