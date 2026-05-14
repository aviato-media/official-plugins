# Aviato Official Plugins

These [Aviato](https://avi.ato.software/) plugins maintained by the [Ato](https://ato.software) team. Each plugin is available from the [Aviato Plugins Marketplace](https://avi.ato.software/plugins) and can be installed easily in-app via the plugin manager.

## Plugins

| Plugin | Description |
| ------ | ----------- |
| [audible](./plugins/audible/) | Indexes audiobook files via Audible (audnex.us). |
| [embedded-metadata](./plugins/embedded-metadata/) | Extracts embedded tags and cover art from media containers via ffprobe. |
| [external-metadata](./plugins/external-metadata/) | Reads `.nfo` and `.opf` sidecars and merges their fields into the bundle. |
| [external-subtitles](./plugins/external-subtitles/) | Discovers external subtitle sidecars and surfaces embedded subtitle streams. |
| [fs-local](./plugins/fs-local/) | Adds local filesystem sources to your Aviato libraries. |
| [library-audiobooks](./plugins/library-audiobooks/) | Audiobook library with author/narrator/series browsing and chapters. |
| [library-books](./plugins/library-books/) | Ebook library with author, series, and publisher browsing. |
| [library-movies](./plugins/library-movies/) | Movie library with rich metadata, trailers, and extras classification. |
| [library-music](./plugins/library-music/) | Music library with artist/album/track browsing. |
| [library-tv](./plugins/library-tv/) | TV show library with series/season/episode browsing. |
| [metadata-books](./plugins/metadata-books/) | Extracts metadata and cover art from EPUB, PDF, and DOCX ebooks. |
| [musicbrainz](./plugins/musicbrainz/) | Indexes music files via MusicBrainz and Cover Art Archive. |
| [openwith-iina](./plugins/openwith-iina/) | Adds IINA to the Open With menu for video items on macOS. |
| [openwith-vlc](./plugins/openwith-vlc/) | Adds VLC to the Open With menu for video items. |
| [posters](./plugins/posters/) | Discovers local poster, fanart, banner, and cover image sidecars. |
| [thumbnails](./plugins/thumbnails/) | Generates thumbnails from media files using FFmpeg. |
| [tmdb](./plugins/tmdb/) | Indexes movies and TV shows via The Movie Database (TMDb). |

These plugins are open-sourced (see [LICENSE](./LICENSE)) and double as reference implementations for the Aviato plugin system. Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Documentation

- [Aviato Support Docs](https://avi.ato.software/docs/) — general user and operator documentation.
- [Plugin System Guide](https://avi.ato.software/docs/developer/plugins/) — how plugins work, how to build one, and the manifest schema.
