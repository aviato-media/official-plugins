#!/usr/bin/env bun
/**
 * Detect plugins whose `plugin.json.version` is newer than the latest
 * `<slug>@*` git tag. Emits a newline-delimited list of slugs to stdout
 * and (when running in GitHub Actions) `plugins=<csv>` + `count=<n>` to
 * $GITHUB_OUTPUT. When nothing has changed, omits the `plugins=` key so
 * downstream `IFS=','` splits do not yield a single empty-string element.
 *
 * Usage:
 *   bun run scripts/changed-plugins.ts
 */
import { $, semver } from 'bun'
import { appendFile } from 'fs/promises'

import { listPlugins } from './lib'

async function latestVersionFor (slug: string): Promise<string | null> {
  // git tag --list "<slug>@*" --sort=-v:refname | head -n1
  const out = await $`git tag --list ${`${slug}@*`} --sort=-v:refname`.quiet().text()
  const first = out.trim().split('\n').filter(Boolean)[0]
  if (!first) {
    return null
  }
  return first.slice(slug.length + 1) // strip "<slug>@"
}

async function main (): Promise<void> {
  const plugins = await listPlugins()
  const changed: string[] = []

  for (const plugin of plugins) {
    const latestVer = await latestVersionFor(plugin.slug)
    const manifestVer = plugin.manifest.version

    if (latestVer === null) {
      changed.push(plugin.slug)
      console.error(`[changed] ${plugin.slug}: no prior tag → release ${manifestVer}`)
      continue
    }

    const cmp = semver.order(manifestVer, latestVer)
    if (cmp > 0) {
      changed.push(plugin.slug)
      console.error(`[changed] ${plugin.slug}: ${latestVer} → ${manifestVer}`)
    } else if (cmp === 0) {
      console.error(`[changed] ${plugin.slug}: already at ${manifestVer}`)
    } else {
      throw new Error(`${plugin.slug}: manifest version ${manifestVer} is older than tag ${plugin.slug}@${latestVer}`)
    }
  }

  for (const slug of changed) {
    console.log(slug)
  }

  const gha = process.env.GITHUB_OUTPUT
  if (gha) {
    await appendFile(gha, `count=${changed.length}\n`)
    if (changed.length > 0) {
      await appendFile(gha, `plugins=${changed.join(',')}\n`)
    }
  }
}

await main()
