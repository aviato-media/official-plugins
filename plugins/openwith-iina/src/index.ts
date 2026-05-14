import type { OpenWithOption, OpenWithPayload } from '@aviato-media/plugin-sdk'
import { createPlugin, isVideoFile } from '@aviato-media/plugin-sdk'

export function buildIinaOption (payload: OpenWithPayload): OpenWithOption | null {
  // IINA only ships on macOS — surfacing the entry on iOS/Android/Windows
  // would deep-link into a missing handler and look broken.
  if (payload.userAgent.platform !== 'macos') {
    return null
  }
  if (!isVideoFile(payload.file)) {
    return null
  }

  return {
    id: 'iina',
    label: 'IINA',
    url: `iina://weblink?url=${encodeURIComponent(payload.streamUrl)}`,
    description: 'Open in IINA',
  }
}

export function processOpenWith (payload: OpenWithPayload): OpenWithPayload | null {
  const option = buildIinaOption(payload)
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
