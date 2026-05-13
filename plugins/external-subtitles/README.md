# @aviato-media/external-subtitles

Pipeline subscriber that discovers external subtitle sidecar files (`.srt`, `.ass`, `.ssa`, `.vtt`, `.sub`) alongside video files, and surfaces embedded subtitle streams already extracted by `ffprobe`.

## Capabilities

None. Subscriber-only.

## Subscriptions

- `pipeline.probe.afterProcess` — matches subtitle sidecars to their parent video and registers them on the bundle.

## Installation

Install via the Aviato in-app marketplace, or download the latest tarball from the [GitHub Releases](https://github.com/aviato-media/official-plugins/releases) page (tag `external-subtitles@<version>`).
