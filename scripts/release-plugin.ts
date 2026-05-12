#!/usr/bin/env bun
/**
 * Tag and publish a GitHub release for each named plugin. Expects the
 * tarball to already exist at <repo>/dist/aviato-plugin-<slug>-<ver>.tar.gz
 * (see scripts/pack-plugin.ts).
 *
 * Re-runnable: if the tag already exists locally or remotely, the script
 * skips the tag push and only attempts `gh release create` (which itself
 * 422s if the release already exists — caught and surfaced clearly).
 *
 * Usage:
 *   bun run scripts/release-plugin.ts fs-local tmdb
 *
 * Env:
 *   GH_TOKEN  — required, used by `gh release create`
 *   DRY_RUN=1 — print the commands instead of running them
 */
import { $ } from 'bun'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import type { PluginInfo } from './lib'
import { findPlugin, releaseTag, REPO_ROOT, tarballName } from './lib'

const OUT_DIR = join(REPO_ROOT, 'dist')
const DRY_RUN = process.env.DRY_RUN === '1'

async function tagExists (tag: string): Promise<boolean> {
  const local = (await $`git tag --list ${tag}`.quiet().text()).trim()
  if (local) {
    return true
  }
  const remote = (await $`git ls-remote --tags origin ${`refs/tags/${tag}`}`.quiet().nothrow().text()).trim()
  return remote.length > 0
}

async function releaseOne (plugin: PluginInfo): Promise<void> {
  const tag = releaseTag(plugin.slug, plugin.manifest.version)
  const asset = tarballName(plugin.slug, plugin.manifest.version)
  const tarPath = join(OUT_DIR, asset)
  const shaPath = `${tarPath}.sha256`

  const sha = (await readFile(shaPath, 'utf8')).split(/\s+/)[0]
  const notes = [
    `# ${plugin.slug} ${plugin.manifest.version}`,
    '',
    `**sha256:** \`${sha}\``,
    `**asset:** \`${asset}\``,
    '',
    'Install via the Aviato in-app marketplace or download the tarball directly.',
  ].join('\n')

  console.log(`[release] ${tag} → ${asset}`)

  if (DRY_RUN) {
    console.log(`[dry-run] tag exists? would check ${tag}`)
    console.log(`[dry-run] git tag ${tag} && git push origin ${tag}`)
    console.log(`[dry-run] gh release create ${tag} --title "${tag}" --notes-file - ${tarPath} ${shaPath}`)
    console.log(`[dry-run] notes:\n${notes}`)
    return
  }

  if (await tagExists(tag)) {
    console.log(`[release] tag ${tag} already exists — skipping tag push`)
  } else {
    await $`git tag ${tag}`.quiet()
    await $`git push origin ${tag}`.quiet()
  }

  const notesDir = await mkdtemp(join(tmpdir(), 'aviato-release-'))
  const notesPath = join(notesDir, 'notes.md')
  try {
    await writeFile(notesPath, notes)
    await $`gh release create ${tag} --title ${tag} --notes-file ${notesPath} ${tarPath} ${shaPath}`
  } finally {
    await rm(notesDir, {
      recursive: true,
      force: true,
    })
  }
}

async function main (): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error('release-plugin: no slugs given (nothing to do)')
    return
  }
  const plugins = await Promise.all(args.map(slug => findPlugin(slug)))
  for (const plugin of plugins) {
    await releaseOne(plugin)
  }
}

await main()
