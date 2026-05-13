# @aviato-media/metadata-books

Pipeline subscriber that extracts embedded metadata and cover art from EPUB, PDF, and DOCX ebook files. Runs after the probe step on a locally-materialized file.

## Capabilities

None. Subscriber-only.

## Subscriptions

- `pipeline.probe.afterProcess` — parses the ebook container and contributes metadata + artwork to the bundle.

## Installation

Install via the Aviato in-app marketplace, or download the latest tarball from the [GitHub Releases](https://github.com/aviato-media/official-plugins/releases) page (tag `metadata-books@<version>`).
