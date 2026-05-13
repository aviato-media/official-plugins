/**
 * Shared helpers for parsing Dublin Core metadata out of fast-xml-parser
 * output. EPUB and DOCX both use the same `dc:`-prefixed schema, so the
 * extraction shape is identical.
 */

/**
 * Read a single text value from a node, accepting either a bare string, an
 * object with a `#text` field, or an array (uses first entry). Returns
 * undefined for missing or empty values.
 */
export function readText (node: Record<string, unknown>, key: string): string | undefined {
  const raw = node[key]
  if (raw === undefined) {
    return undefined
  }
  const first = Array.isArray(raw) ? raw[0] : raw
  if (typeof first === 'string') {
    return first.trim() || undefined
  }
  if (typeof first === 'object' && first !== null) {
    const text = (first as Record<string, unknown>)['#text']
    if (typeof text === 'string') {
      return text.trim() || undefined
    }
  }
  return undefined
}

/**
 * Try the namespaced form first (`dc:title`), fall back to the bare form
 * (`title`) — useful when the parser strips namespace prefixes.
 */
export function readDcText (node: Record<string, unknown>, dcKey: string): string | undefined {
  const bare = dcKey.startsWith('dc:') ? dcKey.slice(3) : dcKey
  return readText(node, dcKey) ?? readText(node, bare)
}

/**
 * Pull the leading 4-digit year from any string. Handles ISO dates,
 * PDF `D:YYYYMMDD…` formats, and free-text dates like "Sometime in 2017".
 */
export function parseYear (date: string | undefined): number | undefined {
  if (!date) {
    return undefined
  }
  const match = date.replace(/^D:/, '').match(/(\d{4})/)
  if (!match) {
    return undefined
  }
  const n = Number(match[1])
  return Number.isFinite(n) ? n : undefined
}
