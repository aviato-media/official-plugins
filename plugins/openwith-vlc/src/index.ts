import type { OpenWithOption, OpenWithPayload, OpenWithSubtitle } from '@aviato-media/plugin-sdk'
import { createPlugin, isVideoFile } from '@aviato-media/plugin-sdk'

/**
 * Pick the subtitle most likely to be useful as a sidecar for VLC iOS:
 *   1. The marked-default external track
 *   2. The first forced external track (catches "signs & songs" tracks for anime)
 *   3. The first external track of any kind
 *
 * Embedded tracks are skipped — they're already inside the container.
 */
function pickSubtitleForExternalPlayer (subtitles: OpenWithSubtitle[]): OpenWithSubtitle | undefined {
  const external = subtitles.filter(s => s.type === 'external' && s.url)
  return external.find(s => s.isDefault)
    ?? external.find(s => s.isForced)
    ?? external[0]
}

/**
 * Build an `intent://` URL for the VLC for Android app. The Android intent
 * scheme uses the host + path + query of the target URL between
 * `intent://` and `#`, then declares the original protocol inside the
 * Intent block so VLC fetches the right scheme. Falls back to https when
 * the streamUrl isn't a parseable absolute URL.
 */
function buildAndroidIntentUrl (streamUrl: string): string {
  let scheme = 'https'
  let rest = streamUrl
  const m = /^([a-z][a-z0-9+.-]*):\/\/(.+)$/i.exec(streamUrl)
  if (m) {
    scheme = m[1].toLowerCase()
    rest = m[2]
  }
  return `intent://${rest}#Intent;scheme=${scheme};package=org.videolan.vlc;type=video/*;end`
}

export function buildVlcOption (payload: OpenWithPayload): OpenWithOption | null {
  if (!isVideoFile(payload.file)) {
    return null
  }

  const { streamUrl, userAgent, subtitles } = payload

  if (userAgent.platform === 'ios') {
    const params = new URLSearchParams()
    params.set('url', streamUrl)
    const subtitle = pickSubtitleForExternalPlayer(subtitles)
    if (subtitle?.url) {
      params.set('sub', subtitle.url)
    }
    return {
      id: 'vlc',
      label: 'VLC',
      url: `vlc-x-callback://x-callback-url/stream?${params.toString()}`,
      description: 'Open in VLC for iOS',
    }
  }

  if (userAgent.platform === 'android') {
    return {
      id: 'vlc',
      label: 'VLC',
      url: buildAndroidIntentUrl(streamUrl),
      description: 'Open in VLC for Android',
    }
  }

  if (userAgent.platform === 'macos' || userAgent.platform === 'windows' || userAgent.platform === 'linux') {
    // Desktop VLC parses everything after `vlc://` as the URL to fetch.
    // Percent-encode the full streamUrl so query separators, fragments,
    // and whitespace inside the URL survive the handoff intact.
    return {
      id: 'vlc',
      label: 'VLC',
      url: `vlc://${encodeURIComponent(streamUrl)}`,
      description: 'Open in VLC',
    }
  }

  // tvOS / TV / unknown: VLC has no working URL scheme; don't surface a
  // dead entry.
  return null
}

export function processOpenWith (payload: OpenWithPayload): OpenWithPayload | null {
  const option = buildVlcOption(payload)
  if (!option) {
    return null
  }

  return {
    ...payload,
    openWith: [...payload.openWith, option],
  }
}

const { hooks } = createPlugin({})

hooks.on('ui.openWith', async (raw): Promise<Record<string, unknown> | null> => {
  return processOpenWith(raw as unknown as OpenWithPayload)
})
