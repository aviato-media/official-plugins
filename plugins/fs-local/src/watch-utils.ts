import type { DiscoveredFile, ExtensionMap, FilesystemEmitters } from '@aviato-media/plugin-sdk'
import { watch } from 'fs'
import { stat } from 'fs/promises'
import { lookup } from 'mime-types'
import { basename, extname, join } from 'path'

import type { FilesystemConfig } from './index.js'

const DEBOUNCE_MS = 2000

/**
 * Watch a single directory for changes. When a change is detected,
 * debounce per-file for 2 seconds of quiet, then emit individual
 * file-level notifications.
 *
 * Returns a cleanup function that stops watching.
 */
export function watchDirectory (
  dir: string,
  config: FilesystemConfig,
  extensionMap: ExtensionMap,
  emitters: FilesystemEmitters,
): () => void {
  const debounceTimers = new Map<string, Timer>()

  // Build set of all known extensions for fast lookup
  const knownExtensions = new Set<string>(extensionMap.primary)
  for (const entry of Object.values(extensionMap.auxiliaries)) {
    for (const ext of entry.extensions) {
      knownExtensions.add(ext)
    }
  }

  const watcher = watch(dir, {
    recursive: true,
  }, (eventType, filename) => {
    if (!filename) {
      return
    }

    const fullPath = join(dir, filename)

    // Check if this file has a recognized extension
    const ext = extname(filename).toLowerCase()
    if (!ext || !knownExtensions.has(ext)) {
      return
    }

    // Check exclude patterns
    if (config.excludePatterns?.some(pattern => fullPath.includes(pattern))) {
      return
    }

    // Debounce per file
    const existing = debounceTimers.get(fullPath)
    if (existing) {
      clearTimeout(existing)
    }

    debounceTimers.set(fullPath, setTimeout(async () => {
      debounceTimers.delete(fullPath)

      // Check if file exists (to distinguish add/modify vs remove)
      try {
        const fileStat = await stat(fullPath)

        if (!fileStat.isFile()) {
          return
        }

        const mimeType = lookup(basename(fullPath)) || undefined
        const file: DiscoveredFile = {
          uri: fullPath,
          filename: basename(fullPath),
          size: fileStat.size,
          mimeType,
          modifiedAt: fileStat.mtime.toISOString(),
        }

        emitters.emitFile(file)
      } catch {
        // File no longer exists — emit removal
        emitters.emitFileRemoved(fullPath)
      }
    }, DEBOUNCE_MS))
  })

  return () => {
    watcher.close()
    for (const timer of debounceTimers.values()) {
      clearTimeout(timer)
    }
    debounceTimers.clear()
  }
}
