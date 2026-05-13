# @aviato-media/tmdb

Indexes movie and TV show files by resolving metadata from [The Movie Database (TMDb)](https://www.themoviedb.org/). Also provides artwork-search results for posters, backdrops, and stills.

## Capabilities

- `indexer` — matches files to TMDb movie / TV entries.
- `artwork-search` — surfaces TMDb image collections.

## Configuration

- `tmdbApiKey` (text, optional) — your personal TMDb API key. Falls back to Aviato's shared key when blank.
- `language` (text, default `en-US`) — language for fetched metadata.

## Installation

Install via the Aviato in-app marketplace, or download the latest tarball from the [GitHub Releases](https://github.com/aviato-media/official-plugins/releases) page (tag `tmdb@<version>`).
