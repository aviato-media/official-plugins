# @aviato-media/thumbnails

Pipeline subscriber that generates thumbnail images from media files using FFmpeg. Runs late in the probe chain (order 90) so other artwork sources get a chance first.

## Capabilities

None. Subscriber-only.

## Subscriptions

- `pipeline.probe.afterProcess` — generates a representative thumbnail via FFmpeg for items still missing artwork.

## Installation

Install via the Aviato in-app marketplace, or download the latest tarball from the [GitHub Releases](https://github.com/aviato-media/official-plugins/releases) page (tag `thumbnails@<version>`).
