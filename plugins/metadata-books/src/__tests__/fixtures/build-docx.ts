import JSZip from 'jszip'

export interface DocxFixtureOptions {
  title?: string
  author?: string
  description?: string
  subject?: string
  language?: string
  created?: string
}

/**
 * Build a minimal DOCX (Office Open XML) zip in-memory for parser tests.
 * Only docProps/core.xml is populated — the rest of the OOXML scaffold is
 * intentionally omitted since the parser only reads core properties.
 */
export async function buildDocxFixture (opts: DocxFixtureOptions = {}): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('docProps/core.xml', coreXml(opts))
  zip.file('[Content_Types].xml', contentTypes())
  return zip.generateAsync({
    type: 'uint8array',
  })
}

function coreXml (o: DocxFixtureOptions): string {
  const lines: string[] = []
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
  lines.push('<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">')
  if (o.title) {
    lines.push(`  <dc:title>${escapeXml(o.title)}</dc:title>`)
  }
  if (o.author) {
    lines.push(`  <dc:creator>${escapeXml(o.author)}</dc:creator>`)
  }
  if (o.description) {
    lines.push(`  <dc:description>${escapeXml(o.description)}</dc:description>`)
  }
  if (o.subject) {
    lines.push(`  <dc:subject>${escapeXml(o.subject)}</dc:subject>`)
  }
  if (o.language) {
    lines.push(`  <dc:language>${escapeXml(o.language)}</dc:language>`)
  }
  if (o.created) {
    lines.push(`  <dcterms:created xsi:type="dcterms:W3CDTF">${escapeXml(o.created)}</dcterms:created>`)
  }
  lines.push('</cp:coreProperties>')
  return lines.join('\n')
}

function contentTypes (): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '  <Default Extension="xml" ContentType="application/xml"/>',
    '  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '</Types>',
  ].join('\n')
}

function escapeXml (s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}
