import { XMLParser } from 'fast-xml-parser'
import JSZip from 'jszip'
import { extname } from 'path'

import type { ExtractedChapter, ExtractedCover, ParsedBookMetadata } from '../types.js'
import { parseYear, readDcText } from './xml-helpers.js'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
  parseTagValue: false,
  parseAttributeValue: false,
})

const COVER_MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
}

export interface EpubParseResult {
  metadata: ParsedBookMetadata
  cover?: ExtractedCover
  chapters?: ExtractedChapter[]
}

/**
 * Parse an EPUB file: read OPF metadata (Dublin Core + calibre custom meta)
 * and extract the cover image when declared in the manifest.
 *
 * EPUBs are zips containing META-INF/container.xml which points to the OPF.
 * We resolve the OPF path manually rather than guess at common locations.
 */
export async function parseEpub (buffer: Uint8Array): Promise<EpubParseResult> {
  const zip = await JSZip.loadAsync(buffer)

  const opfPath = await readOpfPath(zip)
  if (!opfPath) {
    return {
      metadata: {},
    }
  }

  const opfXml = await zip.file(opfPath)?.async('string')
  if (!opfXml) {
    return {
      metadata: {},
    }
  }

  const opf = xmlParser.parse(opfXml) as Record<string, unknown>
  // Some EPUBs use the `opf:` namespace prefix on `<package>` and its
  // children (`<opf:metadata>`, `<opf:manifest>`, `<opf:spine>`, etc.). We
  // keep `removeNSPrefix: false` so Dublin Core keys like `dc:title` work,
  // but normalize the OPF's own elements to the unprefixed form here so
  // downstream code can read `pkg.manifest` etc. unconditionally.
  const pkg = (opf.package ?? opf['opf:package']) as Record<string, unknown> | undefined
  if (!pkg) {
    return {
      metadata: {},
    }
  }
  const normalizedPkg = unwrapOpfNs(pkg)

  const metadata = extractMetadata(normalizedPkg)
  const cover = await extractCover(zip, normalizedPkg, opfPath)
  const chapters = await extractChapters(zip, normalizedPkg, opfPath)

  if (chapters && chapters.length > 0 && metadata.pageCount === undefined) {
    metadata.pageCount = countSpineItems(normalizedPkg)
  }

  return {
    metadata,
    cover,
    chapters,
  }
}

/**
 * Promote `opf:metadata`, `opf:manifest`, `opf:spine`, `opf:guide` to their
 * unprefixed forms (only when the unprefixed form is missing). Within each
 * container also promote child element names (`opf:item` → `item`,
 * `opf:itemref` → `itemref`, `opf:reference` → `reference`).
 *
 * Dublin Core children (`dc:title` etc.) are left alone — those still need
 * their prefixes so `readDcText` can find them.
 */
function unwrapOpfNs (pkg: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ...pkg,
  }
  const childAliases: Record<string, string[]> = {
    manifest: ['item'],
    spine: ['itemref'],
    guide: ['reference'],
    metadata: ['meta'],
  }
  for (const key of ['metadata', 'manifest', 'spine', 'guide']) {
    const prefixed = `opf:${key}`
    let value = out[key] ?? out[prefixed]
    if (value === undefined) {
      continue
    }
    if (typeof value === 'object' && value !== null) {
      const inner: Record<string, unknown> = {
        ...(value as Record<string, unknown>),
      }
      for (const alias of childAliases[key] ?? []) {
        const aliasPrefixed = `opf:${alias}`
        if (inner[alias] === undefined && inner[aliasPrefixed] !== undefined) {
          inner[alias] = inner[aliasPrefixed]
        }
      }
      value = inner
    }
    out[key] = value
  }
  return out
}

async function readOpfPath (zip: JSZip): Promise<string | undefined> {
  const containerXml = await zip.file('META-INF/container.xml')?.async('string')
  if (!containerXml) {
    return undefined
  }
  const container = xmlParser.parse(containerXml) as Record<string, unknown>
  const rootfiles = (container.container as Record<string, unknown> | undefined)?.rootfiles as Record<string, unknown> | undefined
  const rootfile = rootfiles?.rootfile
  const entry = Array.isArray(rootfile) ? rootfile[0] : rootfile
  const path = (entry as Record<string, unknown> | undefined)?.['@_full-path']
  return typeof path === 'string' ? path : undefined
}

function extractMetadata (pkg: Record<string, unknown>): ParsedBookMetadata {
  const meta = pkg.metadata as Record<string, unknown> | undefined
  if (!meta) {
    return {}
  }

  const result: ParsedBookMetadata = {}

  const title = readDcText(meta, 'dc:title')
  if (title) {
    result.title = title
  }
  const author = readDcText(meta, 'dc:creator')
  if (author) {
    result.author = author
  }
  const description = readDcText(meta, 'dc:description')
  if (description) {
    result.description = description
  }
  const publisher = readDcText(meta, 'dc:publisher')
  if (publisher) {
    result.publisher = publisher
  }
  const language = readDcText(meta, 'dc:language')
  if (language) {
    result.language = language
  }
  const subject = readDcText(meta, 'dc:subject')
  if (subject) {
    result.genre = subject
  }
  const year = parseYear(readDcText(meta, 'dc:date'))
  if (year !== undefined) {
    result.year = year
  }

  const isbn = readIsbn(meta)
  if (isbn) {
    result.isbn = isbn
  }

  const customMeta = collectCustomMeta(meta)
  const series = customMeta['calibre:series']
  if (series) {
    result.series = series
  }
  const seriesIndex = customMeta['calibre:series_index']
  if (seriesIndex) {
    const n = Number(seriesIndex)
    if (Number.isFinite(n)) {
      result.seriesPosition = n
    }
  }

  return result
}

function readIsbn (meta: Record<string, unknown>): string | undefined {
  const identifiers = meta['dc:identifier'] ?? meta.identifier
  if (!identifiers) {
    return undefined
  }
  const list = Array.isArray(identifiers) ? identifiers : [identifiers]
  for (const id of list) {
    const text = identifierText(id)
    const scheme = identifierScheme(id)
    if (!text) {
      continue
    }
    if (scheme?.toUpperCase() === 'ISBN' || isIsbnLike(text)) {
      return normalizeIsbn(text)
    }
  }
  return undefined
}

function identifierText (id: unknown): string | undefined {
  if (typeof id === 'string') {
    return id.trim() || undefined
  }
  if (typeof id === 'object' && id !== null) {
    const text = (id as Record<string, unknown>)['#text']
    if (typeof text === 'string') {
      return text.trim() || undefined
    }
  }
  return undefined
}

function identifierScheme (id: unknown): string | undefined {
  if (typeof id !== 'object' || id === null) {
    return undefined
  }
  const obj = id as Record<string, unknown>
  const scheme = obj['@_opf:scheme'] ?? obj['@_scheme']
  return typeof scheme === 'string' && scheme.length > 0 ? scheme : undefined
}

/**
 * ISBN-10 is 10 chars (digits + optional 'X' check digit).
 * ISBN-13 is 13 digits. Hyphens are allowed in display form but not counted.
 */
function isIsbnLike (text: string): boolean {
  const digits = normalizeIsbn(text).replace(/-/g, '')
  if (digits.length === 10) {
    return /^\d{9}[\dX]$/i.test(digits)
  }
  if (digits.length === 13) {
    return /^\d{13}$/.test(digits)
  }
  return false
}

function normalizeIsbn (raw: string): string {
  return raw.replace(/^urn:isbn:/i, '').replace(/^isbn[:\s]?/i, '').trim()
}

function collectCustomMeta (meta: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  const metaNodes = meta.meta
  if (!metaNodes) {
    return out
  }
  const list = Array.isArray(metaNodes) ? metaNodes : [metaNodes]
  for (const node of list) {
    if (typeof node !== 'object' || node === null) {
      continue
    }
    const obj = node as Record<string, unknown>
    const name = obj['@_name'] as string | undefined
    const content = obj['@_content'] as string | undefined
    if (name && content) {
      out[name] = content
    }
  }
  return out
}

async function extractCover (
  zip: JSZip,
  pkg: Record<string, unknown>,
  opfPath: string,
): Promise<ExtractedCover | undefined> {
  const meta = pkg.metadata as Record<string, unknown> | undefined
  const manifest = pkg.manifest as Record<string, unknown> | undefined
  if (!manifest) {
    return undefined
  }

  const items = manifest.item
  const list = Array.isArray(items) ? items : items ? [items] : []
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''

  // Step 1: try the standard EPUB3 `properties="cover-image"` and the
  // legacy `<meta name="cover">` form. Both resolve to a manifest item id
  // pointing directly at an image.
  const coverId = findCoverId(meta, list)
  if (coverId) {
    const direct = await loadImageByManifestId(zip, list, coverId, opfDir)
    if (direct) {
      return direct
    }
  }

  // Step 2: EPUB2 fallback — `<guide><reference type="cover" href="..."/>`.
  // The href usually points to an XHTML wrapper page rather than the image
  // directly, so we have to fetch the page and pull out the first <img>.
  const guideHref = findGuideCoverHref(pkg)
  if (guideHref) {
    const fromGuide = await loadImageFromGuideRef(zip, list, opfDir, guideHref)
    if (fromGuide) {
      return fromGuide
    }
  }

  // Step 3: convention-based fallback — manifest item with id 'cover-image'
  // or id starting with 'cover' that has an image media-type. Catches
  // EPUB2 files that omit both the meta tag and the guide reference.
  const conventional = list.find((i) => {
    const obj = i as Record<string, unknown>
    const id = (obj['@_id'] as string | undefined)?.toLowerCase() ?? ''
    const mediaType = (obj['@_media-type'] as string | undefined) ?? ''
    return mediaType.startsWith('image/') && (id === 'cover' || id === 'cover-image' || id.startsWith('cover.'))
  }) as Record<string, unknown> | undefined
  if (conventional) {
    const href = conventional['@_href'] as string | undefined
    if (href) {
      const data = await zip.file(resolveZipPath(opfDir, href))?.async('uint8array')
      if (data) {
        return {
          data,
          mimeType: (conventional['@_media-type'] as string | undefined)
            ?? COVER_MIME_BY_EXT[extname(href).slice(1).toLowerCase()]
            ?? 'image/jpeg',
        }
      }
    }
  }

  return undefined
}

async function loadImageByManifestId (
  zip: JSZip,
  manifestItems: unknown[],
  id: string,
  opfDir: string,
): Promise<ExtractedCover | undefined> {
  const item = manifestItems.find((i) => (i as Record<string, unknown>)['@_id'] === id) as Record<string, unknown> | undefined
  const href = item?.['@_href'] as string | undefined
  if (!href) {
    return undefined
  }
  const file = zip.file(resolveZipPath(opfDir, href))
  if (!file) {
    return undefined
  }
  const data = await file.async('uint8array')
  return {
    data,
    mimeType: (item?.['@_media-type'] as string | undefined)
      ?? COVER_MIME_BY_EXT[extname(href).slice(1).toLowerCase()]
      ?? 'image/jpeg',
  }
}

function findGuideCoverHref (pkg: Record<string, unknown>): string | undefined {
  const guide = pkg.guide as Record<string, unknown> | undefined
  if (!guide) {
    return undefined
  }
  const refs = guide.reference
  const list = Array.isArray(refs) ? refs : refs ? [refs] : []
  for (const ref of list) {
    const obj = ref as Record<string, unknown>
    const type = (obj['@_type'] as string | undefined)?.toLowerCase()
    if (type === 'cover') {
      const href = obj['@_href'] as string | undefined
      if (href) {
        return href
      }
    }
  }
  return undefined
}

/**
 * Resolve the cover XHTML page referenced by `<guide reference type="cover">`,
 * extract the first `<img src=...>` (or `<image xlink:href=...>` for SVG),
 * and load that image's bytes from the zip.
 */
async function loadImageFromGuideRef (
  zip: JSZip,
  manifestItems: unknown[],
  opfDir: string,
  guideHref: string,
): Promise<ExtractedCover | undefined> {
  const pagePath = resolveZipPath(opfDir, guideHref.split('#')[0])
  const xhtml = await zip.file(pagePath)?.async('string')
  if (!xhtml) {
    return undefined
  }
  const imgMatch = xhtml.match(/<img[^>]+src=["']([^"']+)["']/i)
    ?? xhtml.match(/<image[^>]+(?:xlink:href|href)=["']([^"']+)["']/i)
  const imgHref = imgMatch?.[1]
  if (!imgHref) {
    return undefined
  }
  const pageDir = pagePath.includes('/') ? pagePath.slice(0, pagePath.lastIndexOf('/') + 1) : ''
  const imgPath = resolveZipPath(pageDir, imgHref)
  const data = await zip.file(imgPath)?.async('uint8array')
  if (!data) {
    return undefined
  }
  // Try to find the manifest entry for the image to recover its declared
  // media-type; fall back to the file extension.
  const opfRelImgPath = resolveZipPath(pageDir, imgHref).slice(opfDir.length)
  const manifestItem = manifestItems.find((i) => {
    const href = (i as Record<string, unknown>)['@_href'] as string | undefined
    return href === opfRelImgPath || href === imgHref
  }) as Record<string, unknown> | undefined
  return {
    data,
    mimeType: (manifestItem?.['@_media-type'] as string | undefined)
      ?? COVER_MIME_BY_EXT[extname(imgHref).slice(1).toLowerCase()]
      ?? 'image/jpeg',
  }
}

function findCoverId (
  meta: Record<string, unknown> | undefined,
  manifestItems: unknown[],
): string | undefined {
  if (meta) {
    const customMeta = collectCustomMeta(meta)
    if (customMeta.cover) {
      return customMeta.cover
    }
  }
  for (const item of manifestItems) {
    const obj = item as Record<string, unknown>
    const props = obj['@_properties'] as string | undefined
    if (props && props.split(/\s+/).includes('cover-image')) {
      return obj['@_id'] as string | undefined
    }
  }
  return undefined
}

function resolveZipPath (dir: string, href: string): string {
  if (href.startsWith('/')) {
    return href.slice(1)
  }
  const segments = (dir + href).split('/')
  const out: string[] = []
  for (const seg of segments) {
    if (seg === '..') {
      out.pop()
    } else if (seg !== '.' && seg !== '') {
      out.push(seg)
    }
  }
  return out.join('/')
}

/**
 * Build the ordered spine — a list of {href} relative to the OPF directory.
 * Index in this list (1-based) is what we use as the chapter "page number".
 */
function buildSpine (pkg: Record<string, unknown>): Array<{ id: string,
  href: string }> {
  const manifest = pkg.manifest as Record<string, unknown> | undefined
  const spine = pkg.spine as Record<string, unknown> | undefined
  if (!manifest || !spine) {
    return []
  }

  const manifestItems = manifest.item
  const itemList = Array.isArray(manifestItems) ? manifestItems : manifestItems ? [manifestItems] : []
  const idToHref = new Map<string, string>()
  for (const item of itemList) {
    const obj = item as Record<string, unknown>
    const id = obj['@_id'] as string | undefined
    const href = obj['@_href'] as string | undefined
    if (id && href) {
      idToHref.set(id, href)
    }
  }

  const itemrefs = spine.itemref
  const refList = Array.isArray(itemrefs) ? itemrefs : itemrefs ? [itemrefs] : []
  const out: Array<{ id: string,
    href: string }> = []
  for (const ref of refList) {
    const obj = ref as Record<string, unknown>
    const idref = obj['@_idref'] as string | undefined
    if (!idref) {
      continue
    }
    const href = idToHref.get(idref)
    if (!href) {
      continue
    }
    out.push({
      id: idref,
      href,
    })
  }
  return out
}

function countSpineItems (pkg: Record<string, unknown>): number | undefined {
  const spine = buildSpine(pkg)
  return spine.length > 0 ? spine.length : undefined
}

/**
 * Extract a chapter list from the EPUB's TOC — preferring the EPUB3 nav doc
 * (declared via `properties="nav"` in the manifest), falling back to the
 * EPUB2 NCX (declared via `spine[@toc]` referencing a manifest item).
 *
 * Each chapter's `startPage` is the 1-indexed spine position of its target
 * document. Multiple chapters can share a spine page when several TOC
 * entries point into the same XHTML file via fragments — the reader uses the
 * full `href` for precise in-file navigation.
 */
async function extractChapters (
  zip: JSZip,
  pkg: Record<string, unknown>,
  opfPath: string,
): Promise<ExtractedChapter[] | undefined> {
  const spine = buildSpine(pkg)
  if (spine.length === 0) {
    return undefined
  }
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  const hrefToSpine = new Map<string, number>()
  spine.forEach((entry, i) => {
    hrefToSpine.set(entry.href, i + 1)
  })

  const manifest = pkg.manifest as Record<string, unknown> | undefined
  const manifestItems = manifest?.item
  const itemList = Array.isArray(manifestItems) ? manifestItems : manifestItems ? [manifestItems] : []

  const navItem = itemList.find((it) => {
    const obj = it as Record<string, unknown>
    const props = obj['@_properties'] as string | undefined
    return props ? props.split(/\s+/).includes('nav') : false
  }) as Record<string, unknown> | undefined

  if (navItem) {
    const navHref = navItem['@_href'] as string | undefined
    if (navHref) {
      const navPath = resolveZipPath(opfDir, navHref)
      const navXml = await zip.file(navPath)?.async('string')
      if (navXml) {
        const navDir = navHref.includes('/') ? navHref.slice(0, navHref.lastIndexOf('/') + 1) : ''
        const chapters = parseNavDoc(navXml, hrefToSpine, navDir)
        if (chapters.length > 0) {
          return chapters
        }
      }
    }
  }

  const spineEl = pkg.spine as Record<string, unknown> | undefined
  const ncxId = spineEl?.['@_toc'] as string | undefined
  if (ncxId) {
    const ncxItem = itemList.find((it) => (it as Record<string, unknown>)['@_id'] === ncxId) as Record<string, unknown> | undefined
    const ncxHref = ncxItem?.['@_href'] as string | undefined
    if (ncxHref) {
      const ncxPath = resolveZipPath(opfDir, ncxHref)
      const ncxXml = await zip.file(ncxPath)?.async('string')
      if (ncxXml) {
        const ncxDir = ncxHref.includes('/') ? ncxHref.slice(0, ncxHref.lastIndexOf('/') + 1) : ''
        const chapters = parseNcx(ncxXml, hrefToSpine, ncxDir)
        if (chapters.length > 0) {
          return chapters
        }
      }
    }
  }

  return undefined
}

function parseNavDoc (
  xml: string,
  hrefToSpine: Map<string, number>,
  navDir: string,
): ExtractedChapter[] {
  const tocMatch = xml.match(/<nav[^>]*epub:type=["'][^"']*\btoc\b[^"']*["'][^>]*>([\s\S]*?)<\/nav>/i)
  const region = tocMatch ? tocMatch[1] : xml
  return collectAnchors(region, hrefToSpine, navDir)
}

function parseNcx (
  xml: string,
  hrefToSpine: Map<string, number>,
  ncxDir: string,
): ExtractedChapter[] {
  const out: ExtractedChapter[] = []
  const matches = xml.matchAll(/<navPoint\b[^>]*>([\s\S]*?)<\/navPoint>/gi)
  for (const m of matches) {
    const inner = m[1]
    const labelMatch = inner.match(/<navLabel[^>]*>[\s\S]*?<text[^>]*>([\s\S]*?)<\/text>/i)
    const contentMatch = inner.match(/<content[^>]*src=["']([^"']+)["']/i)
    if (!contentMatch) {
      continue
    }
    const href = contentMatch[1]
    const title = decodeXmlText(labelMatch ? labelMatch[1] : '')
    const startPage = resolveSpinePage(href, hrefToSpine, ncxDir)
    if (!title || startPage === undefined) {
      continue
    }
    out.push({
      startPage,
      title,
      href: resolveRelativeHref(href, ncxDir),
    })
  }
  return out
}

function collectAnchors (
  xml: string,
  hrefToSpine: Map<string, number>,
  baseDir: string,
): ExtractedChapter[] {
  const out: ExtractedChapter[] = []
  const matches = xml.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)
  for (const m of matches) {
    const href = m[1]
    const title = decodeXmlText(stripTags(m[2]))
    if (!title) {
      continue
    }
    const startPage = resolveSpinePage(href, hrefToSpine, baseDir)
    if (startPage === undefined) {
      continue
    }
    out.push({
      startPage,
      title,
      href: resolveRelativeHref(href, baseDir),
    })
  }
  return out
}

function resolveSpinePage (
  href: string,
  hrefToSpine: Map<string, number>,
  tocDir: string,
): number | undefined {
  const resolved = resolveRelativeHref(href, tocDir)
  const noFrag = resolved.split('#')[0]
  return hrefToSpine.get(noFrag) ?? hrefToSpine.get(resolved)
}

function resolveRelativeHref (href: string, dir: string): string {
  if (href.startsWith('/') || /^[a-z]+:/i.test(href)) {
    return href
  }
  const segments = (dir + href).split('/')
  const out: string[] = []
  for (const seg of segments) {
    if (seg === '..') {
      out.pop()
    } else if (seg !== '.' && seg !== '') {
      out.push(seg)
    }
  }
  return out.join('/')
}

function stripTags (s: string): string {
  return s.replace(/<[^>]+>/g, '').trim()
}

function decodeXmlText (s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
