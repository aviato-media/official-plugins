import type {
  Bundle,
  BundleAsset,
  BundleMetadata,
} from '@aviato-media/plugin-sdk'
import { createPlugin } from '@aviato-media/plugin-sdk'

import type { NfoData } from './nfo-parser.js'
import { parseNfo } from './nfo-parser.js'
import type { OpfData } from './opf-parser.js'
import { parseOpf } from './opf-parser.js'

type BundleEntity = NonNullable<Bundle['entities']>[number]

const PLUGIN_ID = 'aviato-external-metadata'

export interface ProbePayload extends Record<string, unknown> {
  itemId: string
  bundle: Bundle
}

export interface ProcessOptions {
  /** Override how a sidecar file is read. Used by tests. */
  readFile?: (path: string) => Promise<string>
}

const { hooks } = createPlugin({})

async function defaultReadFile (path: string): Promise<string> {
  return Bun.file(path).text()
}

function normalizeExt (ext: string): string {
  return ext.toLowerCase().replace(/^\./, '')
}

/**
 * Walk the bundle's auxiliary files for sidecar metadata (.nfo, .opf),
 * parse each into bundle deltas, and return the merged payload. Returns
 * `null` when no sidecar produced any updates so the hook dispatcher can
 * pass through unchanged.
 */
export async function processProbe (
  payload: ProbePayload,
  opts: ProcessOptions = {},
): Promise<ProbePayload | null> {
  const { itemId, bundle } = payload
  const auxFiles = bundle.files?.auxiliary ?? []
  const readFile = opts.readFile ?? defaultReadFile

  const mergedMetadata: Record<string, unknown> = {}
  const mergedIds: Record<string, { id: string,
    url?: string }> = {}
  const newAssets: BundleAsset[] = []
  const newEntities: BundleEntity[] = []
  let touched = false

  for (const file of auxFiles) {
    const ext = normalizeExt(file.extension)
    if (ext !== 'nfo' && ext !== 'opf') {
      continue
    }

    let content: string
    try {
      content = await readFile(file.path)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`[${PLUGIN_ID}] ${file.path}: read failed: ${msg}\n`)
      continue
    }

    if (ext === 'nfo') {
      const nfo = parseNfo(content)
      if (nfo) {
        applyNfo(nfo, mergedMetadata, mergedIds, newAssets, newEntities)
        touched = true
      }
    } else {
      const opf = parseOpf(content)
      if (opf) {
        applyOpf(opf, mergedMetadata, mergedIds, newEntities)
        touched = true
      }
    }
  }

  if (!touched) {
    return null
  }

  const updatedBundle: Bundle = {
    ...bundle,
    metadata: {
      ...bundle.metadata,
      ...(mergedMetadata as BundleMetadata),
    },
  }

  if (Object.keys(mergedIds).length > 0) {
    updatedBundle.ids = {
      ...bundle.ids,
      ...mergedIds,
    }
  }

  if (newAssets.length > 0) {
    updatedBundle.assets = [...(bundle.assets ?? []), ...newAssets]
  }

  if (newEntities.length > 0) {
    updatedBundle.entities = [...(bundle.entities ?? []), ...newEntities]
  }

  return {
    itemId,
    bundle: updatedBundle,
  }
}

function setIfMissing (target: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined || value === null || value === '') {
    return
  }
  if (target[key] === undefined) {
    target[key] = value
  }
}

function applyNfo (
  nfo: NfoData,
  metadata: Record<string, unknown>,
  ids: Record<string, { id: string,
    url?: string }>,
  assets: BundleAsset[],
  entities: BundleEntity[],
): void {
  setIfMissing(metadata, 'title', nfo.title)
  setIfMissing(metadata, 'originalTitle', nfo.originaltitle)
  setIfMissing(metadata, 'year', nfo.year)
  setIfMissing(metadata, 'overview', nfo.plot)
  setIfMissing(metadata, 'rating', nfo.rating)
  if (nfo.runtime !== undefined) {
    setIfMissing(metadata, 'duration', nfo.runtime * 60)
  }
  if (nfo.genres.length > 0) {
    setIfMissing(metadata, 'genres', nfo.genres)
  }
  setIfMissing(metadata, 'tagline', nfo.tagline)
  setIfMissing(metadata, 'studio', nfo.studio)
  setIfMissing(metadata, 'contentRating', nfo.mpaa)
  setIfMissing(metadata, 'edition', nfo.edition)
  setIfMissing(metadata, 'set', nfo.set)

  for (const uid of nfo.uniqueids) {
    if (!ids[uid.type]) {
      ids[uid.type] = {
        id: uid.id,
      }
    }
  }

  for (const art of nfo.artwork) {
    assets.push({
      type: art.type,
      uri: art.url,
      source: PLUGIN_ID,
    })
  }

  for (const director of nfo.directors) {
    entities.push({
      role: 'director',
      name: director,
      status: 'pending',
      source: PLUGIN_ID,
    })
  }
  for (const actor of nfo.actors) {
    entities.push({
      role: 'actor',
      name: actor.name,
      status: 'pending',
      metadata: actor.role ? {
        character: actor.role,
      } : undefined,
      source: PLUGIN_ID,
    })
  }
}

function applyOpf (
  opf: OpfData,
  metadata: Record<string, unknown>,
  ids: Record<string, { id: string,
    url?: string }>,
  entities: BundleEntity[],
): void {
  setIfMissing(metadata, 'title', opf.title)
  setIfMissing(metadata, 'overview', opf.description)
  setIfMissing(metadata, 'description', opf.description)
  setIfMissing(metadata, 'publisher', opf.publisher)
  setIfMissing(metadata, 'language', opf.language)
  setIfMissing(metadata, 'year', opf.year)
  setIfMissing(metadata, 'series', opf.series)
  setIfMissing(metadata, 'seriesPosition', opf.seriesPosition)
  if (opf.genres.length > 0) {
    setIfMissing(metadata, 'genres', opf.genres)
  }

  // Surface authors + narrator on the metadata bundle directly so library
  // plugins that read flat fields (e.g. library-audiobooks) don't need to
  // walk the entity graph for the common case.
  if (opf.authors.length > 0) {
    setIfMissing(metadata, 'author', opf.authors[0])
    setIfMissing(metadata, 'artist', opf.authors[0])
    setIfMissing(metadata, 'authors', opf.authors)
  }
  if (opf.narrators.length > 0) {
    setIfMissing(metadata, 'narrator', opf.narrators[0])
    setIfMissing(metadata, 'narrators', opf.narrators)
  }

  for (const uid of opf.uniqueids) {
    if (!ids[uid.type]) {
      ids[uid.type] = {
        id: uid.id,
      }
    }
  }

  for (const author of opf.authors) {
    entities.push({
      role: 'author',
      name: author,
      status: 'pending',
      source: PLUGIN_ID,
    })
  }
  for (const narrator of opf.narrators) {
    entities.push({
      role: 'narrator',
      name: narrator,
      status: 'pending',
      source: PLUGIN_ID,
    })
  }
}

hooks.on('pipeline.probe.afterProcess', async (raw): Promise<Record<string, unknown> | null> => {
  return processProbe(raw as unknown as ProbePayload)
})
