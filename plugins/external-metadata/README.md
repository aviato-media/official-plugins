# @aviato-media/external-metadata

Pipeline subscriber that reads sidecar metadata files (`.nfo` for video, `.opf` for ebooks) and merges their fields, IDs, artwork references, and related entities into the bundle. Runs at `pipeline.probe.afterProcess` (order 30).

## Capabilities

None. Subscriber-only.

## Subscriptions

- `pipeline.probe.afterProcess` — parses sidecar files and merges them as `MetadataContribution`s.

## Installation

Install via the Aviato in-app marketplace, or download the latest tarball from the [GitHub Releases](https://github.com/aviato-media/official-plugins/releases) page (tag `external-metadata@<version>`).
