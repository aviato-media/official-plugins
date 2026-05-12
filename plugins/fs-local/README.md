# @aviato-media/fs-local

Adds local filesystem sources to your Aviato libraries. Scans directories you point it at, classifies files by extension, and optionally watches for changes.

## Capabilities

- `filesystem` — provides the file source for libraries.
- Supports watch, local file access, and write.

## Configuration

- `excludePatterns` (string list) — glob patterns to skip during scans.
- `watchForChanges` (toggle) — automatically detect new/modified files.

## Installation

Install via the Aviato in-app marketplace, or download the latest tarball from the [GitHub Releases](https://github.com/aviato-media/official-plugins/releases) page (tag `fs-local@<version>`).
