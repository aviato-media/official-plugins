import type {
  DiscoveredFile,
  ExtensionMap,
  FilesystemEmitters,
  ScanResult,
  ValidationResult,
} from '@aviato-media/plugin-sdk'
import { createPlugin } from '@aviato-media/plugin-sdk'
import { access, readdir, realpath, stat } from 'fs/promises'
import { lookup } from 'mime-types'
import { extname, join } from 'path'

import { watchDirectory } from './watch-utils.js'

export interface FilesystemConfig {
  paths: string[]
  excludePatterns?: string[]
  watchForChanges?: boolean
}

interface LibraryWatchState {
  libraryId: string
  cleanup: () => void
}

const libraryWatches = new Map<string, LibraryWatchState>()

// ── Classification ─────────────────────────────────────

export function classifyFile (
  filename: string,
  extensionMap: ExtensionMap,
): { group: string,
  isPrimary: boolean } | null {
  const ext = extname(filename).toLowerCase()
  if (!ext) {
    return null
  }

  // Check primary extensions first
  if (extensionMap.primary.includes(ext)) {
    return {
      group: 'primary',
      isPrimary: true,
    }
  }

  // Check each auxiliary group
  for (const [group, entry] of Object.entries(extensionMap.auxiliaries)) {
    if (entry.extensions.includes(ext)) {
      return {
        group,
        isPrimary: false,
      }
    }
  }

  return null
}

// ── Exclusion ──────────────────────────────────────────

function shouldExclude (path: string, patterns?: string[]): boolean {
  if (!patterns || patterns.length === 0) {
    return false
  }
  return patterns.some(pattern => path.includes(pattern))
}

// ── Pattern matching for auxiliary subdirectories ──────

export function matchesAuxPattern (dirName: string, patterns: string[]): boolean {
  return patterns.some(pattern => {
    // Pattern like "Subs/**" — extract the directory name part
    const parts = pattern.split('/')
    const patternDir = parts[0]
    return dirName.toLowerCase() === patternDir.toLowerCase()
  })
}

function getAuxPatterns (extensionMap: ExtensionMap): string[] {
  const patterns: string[] = []
  for (const [, entry] of Object.entries(extensionMap.auxiliaries)) {
    if (entry.patterns) {
      patterns.push(...entry.patterns)
    }
  }
  return patterns
}

// ── Collect auxiliaries from pattern-matched subdirs ───

export async function collectPatternAuxiliaries (
  parentDir: string,
  extensionMap: ExtensionMap,
): Promise<Map<string, DiscoveredFile[]>> {
  const auxByGroup = new Map<string, DiscoveredFile[]>()

  for (const [group, entry] of Object.entries(extensionMap.auxiliaries)) {
    if (!entry.patterns) {
      continue
    }

    for (const pattern of entry.patterns) {
      const parts = pattern.split('/')
      const subDirName = parts[0]
      const subDirPath = join(parentDir, subDirName)

      let entries: string[]
      try {
        entries = await readdir(subDirPath)
      } catch {
        continue
      }

      for (const filename of entries) {
        const fullPath = join(subDirPath, filename)
        let fileStat
        try {
          fileStat = await stat(fullPath)
        } catch {
          continue
        }

        if (!fileStat.isFile()) {
          continue
        }

        const classification = classifyFile(filename, extensionMap)
        if (!classification || classification.group !== group) {
          continue
        }

        const mimeType = lookup(filename) || undefined
        const file: DiscoveredFile = {
          uri: fullPath,
          filename,
          size: fileStat.size,
          mimeType,
          modifiedAt: fileStat.mtime.toISOString(),
        }

        const existing = auxByGroup.get(group) ?? []
        existing.push(file)
        auxByGroup.set(group, existing)
      }
    }
  }

  return auxByGroup
}

// ── Build set of all known extensions ─────────────────

function buildKnownExtensions (extensionMap: ExtensionMap): Set<string> {
  const exts = new Set<string>(extensionMap.primary)
  for (const entry of Object.values(extensionMap.auxiliaries)) {
    for (const ext of entry.extensions) {
      exts.add(ext)
    }
  }
  return exts
}

// ── Core scan ──────────────────────────────────────────

export async function scanDirectory (
  dir: string,
  config: FilesystemConfig,
  extensionMap: ExtensionMap,
  emitFile: (file: DiscoveredFile) => void,
  stats: { total: number,
    errors: string[] },
  visited = new Set<string>(),
  knownExtensions?: Set<string>,
): Promise<void> {
  // Prevent symlink loops
  let realDir: string
  try {
    realDir = await realpath(dir)
  } catch {
    stats.errors.push(`Cannot resolve path: ${dir}`)
    return
  }
  if (visited.has(realDir)) {
    return
  }
  visited.add(realDir)

  const exts = knownExtensions ?? buildKnownExtensions(extensionMap)

  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (err) {
    stats.errors.push(`Cannot read directory: ${dir} - ${(err as Error).message}`)
    return
  }

  const auxPatterns = getAuxPatterns(extensionMap)
  const subdirs: string[] = []

  for (const entry of entries) {
    const fullPath = join(dir, entry)

    if (shouldExclude(fullPath, config.excludePatterns)) {
      continue
    }

    let fileStat
    try {
      fileStat = await stat(fullPath)
    } catch (err) {
      stats.errors.push(`Cannot stat file: ${fullPath} - ${(err as Error).message}`)
      continue
    }

    if (fileStat.isDirectory()) {
      subdirs.push(entry)
    } else if (fileStat.isFile()) {
      const ext = extname(entry).toLowerCase()
      if (!ext || !exts.has(ext)) {
        continue
      }

      const mimeType = lookup(entry) || undefined
      const file: DiscoveredFile = {
        uri: fullPath,
        filename: entry,
        size: fileStat.size,
        mimeType,
        modifiedAt: fileStat.mtime.toISOString(),
      }

      emitFile(file)
      stats.total++
    }
  }

  // Recurse into subdirectories (including pattern-matched aux subdirs — files inside are still emitted individually)
  for (const subdir of subdirs) {
    // Skip aux-pattern dirs from recursion only if they will be scanned by collectPatternAuxiliaries
    // With file-level notifications, we just recurse into everything and emit each file
    if (matchesAuxPattern(subdir, auxPatterns)) {
      // Still scan inside pattern-matched subdirectories to emit their files
      await scanDirectory(join(dir, subdir), config, extensionMap, emitFile, stats, visited, exts)
      continue
    }
    await scanDirectory(join(dir, subdir), config, extensionMap, emitFile, stats, visited, exts)
  }
}

// ── Plugin registration ────────────────────────────────

createPlugin({
  filesystem: {
    async validate (config: Record<string, unknown>): Promise<ValidationResult> {
      const cfg = config as unknown as FilesystemConfig
      const errors: string[] = []

      if (!cfg.paths || !Array.isArray(cfg.paths) || cfg.paths.length === 0) {
        errors.push('At least one path is required')
      } else {
        for (const p of cfg.paths) {
          try {
            await access(p)
          } catch {
            errors.push(`Path does not exist: ${p}`)
          }
        }
      }

      return {
        valid: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined,
      }
    },

    async scan (
      config: Record<string, unknown>,
      extensionMap: ExtensionMap,
      emitters: FilesystemEmitters,
    ): Promise<ScanResult> {
      const cfg = config as unknown as FilesystemConfig
      const startTime = Date.now()
      const stats = {
        total: 0,
        errors: [] as string[],
      }

      for (const dir of cfg.paths) {
        try {
          await access(dir)
        } catch {
          stats.errors.push(`Path does not exist: ${dir}`)
          continue
        }
        await scanDirectory(dir, cfg, extensionMap, emitters.emitFile, stats)
      }

      emitters.emitScanComplete()

      return {
        totalFiles: stats.total,
        newFiles: stats.total,
        modifiedFiles: 0,
        removedFiles: 0,
        errors: stats.errors,
        durationMs: Date.now() - startTime,
      }
    },

    async watch (
      config: Record<string, unknown>,
      extensionMap: ExtensionMap,
      libraryId: string,
      emitters: FilesystemEmitters,
    ): Promise<void> {
      const cfg = config as unknown as FilesystemConfig

      // Stop existing watch for this library if any
      const existing = libraryWatches.get(libraryId)
      if (existing) {
        existing.cleanup()
      }

      const cleanups: Array<() => void> = []

      for (const dir of cfg.paths) {
        try {
          await access(dir)
        } catch {
          continue
        }
        const cleanup = watchDirectory(dir, cfg, extensionMap, emitters)
        cleanups.push(cleanup)
      }

      libraryWatches.set(libraryId, {
        libraryId,
        cleanup: () => {
          for (const fn of cleanups) {
            fn()
          }
        },
      })
    },

    async unwatchLibrary (libraryId: string): Promise<void> {
      const state = libraryWatches.get(libraryId)
      if (state) {
        state.cleanup()
        libraryWatches.delete(libraryId)
      }
    },

    async unwatch (): Promise<void> {
      for (const state of libraryWatches.values()) {
        state.cleanup()
      }
      libraryWatches.clear()
    },

    async getLocalPath (uri: string): Promise<string> {
      // For local filesystem, the URI is the local path
      return uri
    },
  },
})
