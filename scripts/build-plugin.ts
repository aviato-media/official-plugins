#!/usr/bin/env bun
/**
 * Build one or more plugins into <plugin>/dist/index.js.
 *
 * Usage:
 *   bun run scripts/build-plugin.ts                  # build all
 *   bun run scripts/build-plugin.ts fs-local tmdb    # build named
 */
import { rm } from 'fs/promises'
import { join } from 'path'

import type { PluginInfo } from './lib'
import { resolvePlugins } from './lib'

async function buildOne (plugin: PluginInfo): Promise<void> {
  const distDir = join(plugin.dir, 'dist')
  await rm(distDir, {
    recursive: true,
    force: true,
  })

  const entry = join(plugin.dir, 'src/index.ts')
  console.log(`[build] ${plugin.slug} @ ${plugin.manifest.version}`)

  const result = await Bun.build({
    entrypoints: [entry],
    outdir: distDir,
    target: 'bun',
    minify: true,
    external: ['zod'],
    naming: { entry: 'index.js' },
  })

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log)
    }
    throw new Error(`build failed for ${plugin.slug}`)
  }

  const out = result.outputs.find(o => o.path.endsWith('index.js'))
  if (!out) {
    throw new Error(`no index.js output for ${plugin.slug}`)
  }
  const sizeKb = (out.size / 1024).toFixed(1)
  console.log(`[build] ${plugin.slug} → dist/index.js (${sizeKb} KB)`)
}

async function main (): Promise<void> {
  const plugins = await resolvePlugins(process.argv.slice(2))
  for (const plugin of plugins) {
    await buildOne(plugin)
  }
}

await main()
