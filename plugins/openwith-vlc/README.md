# Open With VLC

Subscribes to `ui.openWith` and contributes a VLC entry to the Open With menu
for items whose primary file has a video MIME type.

Platform handling:

- **iOS / iPadOS** — uses `vlc-x-callback://x-callback-url/stream?url=...` and
  attaches the first external subtitle as `&sub=...` when one is available
  (see https://code.videolan.org/videolan/vlc-ios/-/commit/55e27ed69e2fce7d87c47c9342f8889fda356aa9).
  Also passes an `x-success` callback so VLC can return the user to the page.
- **Everything else** — uses the simpler `vlc://<stream-url>` form. Subtitles
  cannot be passed through this scheme; embedded tracks still play normally.
