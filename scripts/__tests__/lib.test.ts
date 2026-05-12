import { describe, expect, test } from 'bun:test'
import { stat } from 'fs/promises'
import { isAbsolute, join, sep } from 'path'

import {
  findPlugin,
  listPlugins,
  PLUGINS_DIR,
  releaseTag,
  REPO_ROOT,
  resolvePlugins,
  tarballName,
} from '../lib'

describe('REPO_ROOT', () => {
  test('is an absolute, native OS path', () => {
    expect(isAbsolute(REPO_ROOT)).toBe(true)
    // No file:// URL leakage
    expect(REPO_ROOT.startsWith('file://')).toBe(false)
    // No URL-style drive prefix on Windows (e.g. "/C:/Users/...")
    expect(/^\/[A-Za-z]:\//.test(REPO_ROOT)).toBe(false)
  })

  test('uses the platform path separator', () => {
    // POSIX: contains '/'. Windows: contains '\'. Either way, sep must appear.
    expect(REPO_ROOT).toContain(sep)
  })

  test('points to the repo root (contains package.json, plugins/, scripts/)', async () => {
    const pkg = await stat(join(REPO_ROOT, 'package.json'))
    expect(pkg.isFile()).toBe(true)

    const plugins = await stat(join(REPO_ROOT, 'plugins'))
    expect(plugins.isDirectory()).toBe(true)

    const scripts = await stat(join(REPO_ROOT, 'scripts'))
    expect(scripts.isDirectory()).toBe(true)
  })
})

describe('PLUGINS_DIR', () => {
  test('is REPO_ROOT joined with "plugins"', () => {
    expect(PLUGINS_DIR).toBe(join(REPO_ROOT, 'plugins'))
  })

  test('exists and is a directory', async () => {
    const s = await stat(PLUGINS_DIR)
    expect(s.isDirectory()).toBe(true)
  })
})

describe('listPlugins', () => {
  test('discovers fs-local with a valid manifest', async () => {
    const plugins = await listPlugins()
    const fsLocal = plugins.find(p => p.slug === 'fs-local')
    expect(fsLocal).toBeDefined()
    expect(fsLocal!.dir).toBe(join(PLUGINS_DIR, 'fs-local'))
    expect(fsLocal!.manifest.id).toBe('@aviato-media/fs-local')
    expect(fsLocal!.manifest.engine).toBe('bun')
    expect(fsLocal!.manifest.entry).toBe('dist/index.js')
  })

  test('returns plugins sorted by slug', async () => {
    const plugins = await listPlugins()
    const slugs = plugins.map(p => p.slug)
    expect(slugs).toEqual([...slugs].sort())
  })
})

describe('findPlugin', () => {
  test('resolves a known slug', async () => {
    const p = await findPlugin('fs-local')
    expect(p.slug).toBe('fs-local')
    expect(p.dir).toBe(join(PLUGINS_DIR, 'fs-local'))
  })

  test('rejects slugs containing path separators or traversal', async () => {
    await expect(findPlugin('../etc')).rejects.toThrow(/invalid plugin slug/)
    await expect(findPlugin('foo/bar')).rejects.toThrow(/invalid plugin slug/)
    await expect(findPlugin('foo bar')).rejects.toThrow(/invalid plugin slug/)
    await expect(findPlugin('.hidden')).rejects.toThrow(/invalid plugin slug/)
  })

  test('rejects empty slug', async () => {
    await expect(findPlugin('')).rejects.toThrow(/invalid plugin slug/)
  })
})

describe('resolvePlugins', () => {
  test('with no args returns every plugin', async () => {
    const all = await listPlugins()
    const resolved = await resolvePlugins([])
    expect(resolved.map(p => p.slug)).toEqual(all.map(p => p.slug))
  })

  test('with args returns only the named plugins', async () => {
    const resolved = await resolvePlugins(['fs-local'])
    expect(resolved).toHaveLength(1)
    expect(resolved[0].slug).toBe('fs-local')
  })
})

describe('releaseTag', () => {
  test('formats <slug>@<version>', () => {
    expect(releaseTag('fs-local', '1.2.3')).toBe('fs-local@1.2.3')
  })
})

describe('tarballName', () => {
  test('formats aviato-plugin-<slug>-<version>.tar.gz', () => {
    expect(tarballName('fs-local', '0.1.0')).toBe('aviato-plugin-fs-local-0.1.0.tar.gz')
  })
})
