#!/usr/bin/env bun
/**
 * Pack a built plugin into aviato-plugin-<slug>-<version>.tar.gz with layout:
 *
 *   <slug>/
 *     plugin.json
 *     dist/
 *       index.js
 *
 * Asset name matches the registry YAML's `source.github.assetPattern`.
 *
 * Usage:
 *   bun run scripts/pack-plugin.ts                  # pack all
 *   bun run scripts/pack-plugin.ts fs-local         # pack named
 *
 * Output: <repo>/dist/<asset>.tar.gz plus <repo>/dist/<asset>.tar.gz.sha256
 */
import { $ } from 'bun'
import { createHash } from 'crypto'
import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import { join } from 'path'

import type { PluginInfo } from './lib'
import { REPO_ROOT, resolvePlugins, tarballName } from './lib'

const OUT_DIR = join(REPO_ROOT, 'dist')

async function ensureBuilt (plugin: PluginInfo): Promise<void> {
  try {
    await stat(join(plugin.dir, 'dist/index.js'))
  } catch {
    throw new Error(`${plugin.slug}: dist/index.js missing — run scripts/build-plugin.ts first`)
  }
}

async function packOne (plugin: PluginInfo): Promise<void> {
  await ensureBuilt(plugin)
  await mkdir(OUT_DIR, { recursive: true })

  const asset = tarballName(plugin.slug, plugin.manifest.version)
  const outPath = join(OUT_DIR, asset)

  // BSD tar (macOS) lacks --transform, so we stage into a temp dir whose
  // top-level folder name = the plugin slug, then tar from there.
  const staging = join(OUT_DIR, `.staging-${plugin.slug}`)
  await $`rm -rf ${staging}`.quiet()
  const stagingPlugin = join(staging, plugin.slug)
  await mkdir(join(stagingPlugin, 'dist'), { recursive: true })

  await Bun.write(
    join(stagingPlugin, 'plugin.json'),
    Bun.file(join(plugin.dir, 'plugin.json')),
  )
  await Bun.write(
    join(stagingPlugin, 'dist/index.js'),
    Bun.file(join(plugin.dir, 'dist/index.js')),
  )

  await $`tar -czf ${outPath} -C ${staging} ${plugin.slug}`.quiet()
  await $`rm -rf ${staging}`.quiet()

  const buf = await readFile(outPath)
  const sha = createHash('sha256').update(buf).digest('hex')
  await writeFile(`${outPath}.sha256`, `${sha}  ${asset}\n`)

  const sizeKb = (buf.byteLength / 1024).toFixed(1)
  console.log(`[pack] ${asset} (${sizeKb} KB)`)
  console.log(`[pack] sha256 ${sha}`)
}

async function main (): Promise<void> {
  const plugins = await resolvePlugins(process.argv.slice(2))
  for (const plugin of plugins) {
    await packOne(plugin)
  }
}

await main()
