import { readdir, readFile } from 'fs/promises'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const PLUGINS_DIR = join(REPO_ROOT, 'plugins')

export interface PluginManifest {
  id: string
  name: string
  version: string
  engine: 'bun' | 'node' | 'python' | 'binary'
  entry: string
  [key: string]: unknown
}

export interface PluginInfo {
  /** Folder name under plugins/ (e.g. "fs-local") */
  slug: string
  /** Absolute path to the plugin folder */
  dir: string
  manifest: PluginManifest
}

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export async function listPlugins (): Promise<PluginInfo[]> {
  const entries = await readdir(PLUGINS_DIR, { withFileTypes: true })
  const out: PluginInfo[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }
    const dir = join(PLUGINS_DIR, entry.name)
    const manifest = await readManifest(dir)
    out.push({
      slug: entry.name,
      dir,
      manifest,
    })
  }
  out.sort((a, b) => a.slug.localeCompare(b.slug))
  return out
}

export async function readManifest (dir: string): Promise<PluginManifest> {
  const raw = await readFile(join(dir, 'plugin.json'), 'utf8')
  const parsed = JSON.parse(raw) as PluginManifest
  if (typeof parsed.id !== 'string' || parsed.id.length === 0) {
    throw new Error(`${dir}/plugin.json: invalid id`)
  }
  if (!SEMVER_RE.test(parsed.version)) {
    throw new Error(`${dir}/plugin.json: invalid version ${parsed.version}`)
  }
  return parsed
}

export async function findPlugin (slug: string): Promise<PluginInfo> {
  if (!slug || /[/.\s]/.test(slug)) {
    throw new Error(`invalid plugin slug: ${JSON.stringify(slug)}`)
  }
  const dir = join(PLUGINS_DIR, slug)
  const manifest = await readManifest(dir)
  return {
    slug,
    dir,
    manifest,
  }
}

/** Resolve a CLI arg list (or empty = all) into plugin records. */
export async function resolvePlugins (args: string[]): Promise<PluginInfo[]> {
  if (args.length === 0) {
    return listPlugins()
  }
  return Promise.all(args.map(slug => findPlugin(slug)))
}

/** Tag convention: <slug>@<version>, e.g. "fs-local@1.0.0" */
export function releaseTag (slug: string, version: string): string {
  return `${slug}@${version}`
}

/** Tarball asset name: aviato-plugin-<slug>-<version>.tar.gz */
export function tarballName (slug: string, version: string): string {
  return `aviato-plugin-${slug}-${version}.tar.gz`
}
