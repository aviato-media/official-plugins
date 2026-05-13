/**
 * Internal book metadata extracted from a single ebook file. Parsers return
 * partial values; the index handler merges across files in a bundle.
 *
 * Field names mirror the @aviato/library-books schema so the result drops
 * directly into bundle.metadata.
 */
export interface ParsedBookMetadata {
  title?: string
  author?: string
  series?: string
  seriesPosition?: number
  year?: number
  genre?: string
  description?: string
  publisher?: string
  language?: string
  pageCount?: number
  isbn?: string
}

/**
 * Cover image extracted from an ebook, ready to write to disk and emit as
 * a bundle asset.
 */
export interface ExtractedCover {
  data: Uint8Array
  mimeType: string
}

/**
 * A chapter extracted from a book's table of contents. `startPage` is a
 * 1-indexed logical page number — for EPUB this is the spine index of the
 * chapter's target document. `href` is the original TOC href so the reader
 * can navigate within the file (since visual pagination is renderer-dependent).
 */
export interface ExtractedChapter {
  startPage: number
  title: string
  href?: string
}
