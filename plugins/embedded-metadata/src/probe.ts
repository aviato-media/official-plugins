import type { PluginClient } from '@aviato-media/plugin-sdk'

import type { NormalizedTags } from './tags.js'
import { normalizeTags } from './tags.js'

export interface ProbeStream {
  index: number
  codec_type: string
  codec_name: string
  width?: number
  height?: number
  disposition?: Record<string, number>
  tags?: Record<string, string>
}

export interface ProbeOutput {
  format?: {
    filename?: string
    format_name?: string
    duration?: string
    size?: string
    tags?: Record<string, string>
  }
  streams?: ProbeStream[]
}

export function parseProbeOutput (output: ProbeOutput): NormalizedTags {
  const tags = output.format?.tags ?? {}
  return normalizeTags(tags)
}

export function detectCoverArtStream (streams: ProbeStream[]): ProbeStream | undefined {
  return streams.find(
    (s) => s.codec_type === 'video' && s.disposition?.attached_pic === 1,
  )
}

export async function runFfprobe (client: PluginClient, filePath: string, timeout: number): Promise<ProbeOutput> {
  const result = await client.run('ffprobe', [
    '-v', 'quiet', '-print_format', 'json',
    '-show_format', '-show_streams', filePath,
  ], {
    label: 'ffprobe',
    timeout,
  })

  if (result.exitCode !== 0) {
    throw new Error(`ffprobe exited with code ${result.exitCode}: ${result.stderr}`)
  }

  try {
    return JSON.parse(result.stdout) as ProbeOutput
  } catch {
    throw new Error('Failed to parse ffprobe output')
  }
}
