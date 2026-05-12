# Contributing

## Release flow

1. Bump `version` in a plugin's `plugin.json` AND `package.json`.
2. Open a PR. CI typechecks and tests.
3. On merge to `main`, the release workflow:
   - Detects changed plugins.
   - Builds each (`bun build src/index.ts --outdir dist --target bun --minify --external zod`).
   - Packs `aviato-plugin-<id>-<version>.tar.gz` with `<id>/plugin.json` + `<id>/dist/index.js` at the root.
   - Tags `<id>@<version>` and creates a GitHub Release with the tarball attached.

The Aviato marketplace catalog (avi.ato) syncs these releases and serves them to in-app installers.

## Plugin manifest

Every plugin has a `plugin.json` that matches the [Aviato plugin manifest schema](https://avi.ato.software/docs/developer/plugins/manifest/). The release pipeline for this repo expects:

- `engine: "bun"`*
- `entry` pointing at the bundled artifact (`dist/index.js`)
- Valid semver `version`
- `aviato.minVersion` set

\* While Aviato supports other engines, all of the official plugins in this repo use the above settings so the CI/CD expects the above.

## Local development

```sh
bun install
bun run build fs-local  # build a single plugin
bun run pack fs-local   # produce the tarball locally
bun test                # all plugin tests
```
