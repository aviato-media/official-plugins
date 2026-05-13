# @aviato-media/embedded-metadata

Pipeline subscriber that extracts embedded metadata tags and cover art from media containers using `ffprobe`. Runs at `pipeline.probe.afterProcess` (order 20) on a locally-materialized file.

## Capabilities

None. Subscriber-only.

## Subscriptions

- `pipeline.probe.afterProcess` — extracts container-level tags and embedded artwork.

## Installation

Install via the Aviato in-app marketplace, or download the latest tarball from the [GitHub Releases](https://github.com/aviato-media/official-plugins/releases) page (tag `embedded-metadata@<version>`).
