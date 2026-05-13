import { XMLParser } from 'fast-xml-parser'
import JSZip from 'jszip'

import type { ParsedBookMetadata } from '../types.js'
import { parseYear, readDcText, readText } from './xml-helpers.js'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
  parseTagValue: false,
})

/**
 * Parse a DOCX (Office Open XML) document. Metadata lives in
 * docProps/core.xml as Dublin Core elements; we extract the subset that maps
 * cleanly onto the ebook schema.
 *
 * DOCX has no canonical cover concept, so cover extraction is intentionally
 * not implemented here.
 */
export async function parseDocx (buffer: Uint8Array): Promise<{ metadata: ParsedBookMetadata }> {
  const zip = await JSZip.loadAsync(buffer)
  const coreXml = await zip.file('docProps/core.xml')?.async('string')
  if (!coreXml) {
    return {
      metadata: {},
    }
  }

  const parsed = xmlParser.parse(coreXml) as Record<string, unknown>
  const props = (parsed['cp:coreProperties'] ?? parsed.coreProperties) as Record<string, unknown> | undefined
  if (!props) {
    return {
      metadata: {},
    }
  }

  const metadata: ParsedBookMetadata = {}
  const title = readDcText(props, 'dc:title')
  if (title) {
    metadata.title = title
  }
  const author = readDcText(props, 'dc:creator')
  if (author) {
    metadata.author = author
  }
  const description = readDcText(props, 'dc:description')
  if (description) {
    metadata.description = description
  }
  const subject = readDcText(props, 'dc:subject')
  if (subject) {
    metadata.genre = subject
  }
  const language = readDcText(props, 'dc:language')
  if (language) {
    metadata.language = language
  }
  const created = readText(props, 'dcterms:created') ?? readText(props, 'created')
  const year = parseYear(created)
  if (year !== undefined) {
    metadata.year = year
  }

  return {
    metadata,
  }
}
