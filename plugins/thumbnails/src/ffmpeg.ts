import type { PluginClient } from '@aviato-media/plugin-sdk'

const THUMBNAIL_WIDTH = 300
const QUALITY = '5'
const FFMPEG_TIMEOUT = 30_000
const FFPROBE_TIMEOUT = 10_000

const VIDEO_EXTENSIONS = new Set(['mkv', 'mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'ts'])
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'tiff', 'bmp', 'gif'])
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'm4b', 'flac', 'ogg', 'opus', 'aac', 'wma', 'alac', 'ape', 'wav'])

// Accept both `mkv` and `.mkv` — the server's library_files table stores bare
// extensions ('m4b'), but plugin callers may pass either form.
function normalize (extension: string): string {
  const lower = extension.toLowerCase()
  return lower.startsWith('.') ? lower.slice(1) : lower
}

export function isVideo (extension: string): boolean {
  return VIDEO_EXTENSIONS.has(normalize(extension))
}

export function isImage (extension: string): boolean {
  return IMAGE_EXTENSIONS.has(normalize(extension))
}

export function isAudio (extension: string): boolean {
  return AUDIO_EXTENSIONS.has(normalize(extension))
}

export function calculateTimestamp (durationSeconds?: number): string {
  if (!durationSeconds || durationSeconds <= 0) {
    return '00:00:01'
  }
  const targetSeconds = Math.min(durationSeconds * 0.1, 300)
  const hours = Math.floor(targetSeconds / 3600)
  const minutes = Math.floor((targetSeconds % 3600) / 60)
  const seconds = Math.floor(targetSeconds % 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

// Internal convention: clockwise degrees needed to make the picture render upright.
// Values are normalized to one of: 0, 90, 180, 270.
//
// ffprobe surfaces rotation in two places:
//   1. Display Matrix side_data — `rotation` is counter-clockwise degrees the
//      content must be rotated for correct display (so we negate it to get CW).
//   2. Legacy stream `tags.rotate` (older mp4/mov) — already clockwise degrees.
// If both exist they typically agree; we prefer side_data since it's the modern
// source of truth and ignore tags.rotate when side_data is present.
export function parseRotation (probeOutput: unknown): number {
  if (!probeOutput || typeof probeOutput !== 'object') {
    return 0
  }
  const root = probeOutput as { streams?: unknown }
  const streams = Array.isArray(root.streams) ? root.streams : []
  const stream = streams[0]
  if (!stream || typeof stream !== 'object') {
    return 0
  }
  const s = stream as { side_data_list?: unknown,
    tags?: unknown }

  if (Array.isArray(s.side_data_list)) {
    for (const sd of s.side_data_list) {
      if (!sd || typeof sd !== 'object') {
        continue
      }
      const entry = sd as { side_data_type?: unknown,
        rotation?: unknown }
      const isDisplayMatrix = typeof entry.side_data_type === 'string'
        && entry.side_data_type.toLowerCase() === 'display matrix'
      if (!isDisplayMatrix) {
        continue
      }
      const raw = typeof entry.rotation === 'number'
        ? entry.rotation
        : typeof entry.rotation === 'string'
          ? Number(entry.rotation)
          : NaN
      if (Number.isFinite(raw)) {
        return normalizeRotation(-raw)
      }
    }
  }

  if (s.tags && typeof s.tags === 'object') {
    const rotateTag = (s.tags as Record<string, unknown>).rotate
    const raw = typeof rotateTag === 'number'
      ? rotateTag
      : typeof rotateTag === 'string'
        ? Number(rotateTag)
        : NaN
    if (Number.isFinite(raw)) {
      return normalizeRotation(raw)
    }
  }

  return 0
}

function normalizeRotation (degrees: number): number {
  if (!Number.isFinite(degrees)) {
    return 0
  }
  const rounded = Math.round(degrees / 90) * 90
  const mod = ((rounded % 360) + 360) % 360
  return mod
}

// Builds the rotation half of a -vf chain. Returned filter expects a clockwise
// rotation in degrees (already normalized). Returns null when no rotation is
// needed so callers can omit the filter cleanly.
export function buildRotationFilter (rotation: number): string | null {
  switch (normalizeRotation(rotation)) {
    case 90: return 'transpose=1'
    case 180: return 'hflip,vflip'
    case 270: return 'transpose=2'
    default: return null
  }
}

export interface VideoArgsOptions {
  rotation?: number
}

export function buildVideoArgs (
  input: string,
  output: string,
  timestamp: string,
  options: VideoArgsOptions = {},
): string[] {
  const rotationFilter = buildRotationFilter(options.rotation ?? 0)
  const vf = rotationFilter
    ? `${rotationFilter},scale=${THUMBNAIL_WIDTH}:-1`
    : `scale=${THUMBNAIL_WIDTH}:-1`
  const args: string[] = ['-ss', timestamp]
  // -noautorotate disables ffmpeg's implicit rotation so our explicit transpose
  // chain is the single source of truth — otherwise a portrait phone clip can
  // be rotated twice.
  if (rotationFilter) {
    args.push('-noautorotate')
  }
  args.push('-i', input, '-vframes', '1', '-vf', vf, '-q:v', QUALITY, output, '-y')
  return args
}

export function buildImageArgs (input: string, output: string): string[] {
  return ['-i', input, '-vf', `scale=${THUMBNAIL_WIDTH}:-1`, '-q:v', QUALITY, output, '-y']
}

export function buildAudioArgs (input: string, output: string): string[] {
  // Extract embedded cover art (ID3 APIC, MP4 covr atom, FLAC PICTURE block, etc).
  // -an drops audio; -map 0:v? optionally pulls any attached picture stream and
  // skips cleanly when none exists rather than erroring on missing stream.
  return ['-i', input, '-an', '-map', '0:v?', '-vf', `scale=${THUMBNAIL_WIDTH}:-1`, '-q:v', QUALITY, output, '-y']
}

export function buildProbeRotationArgs (input: string): string[] {
  // `stream_side_data` (not `stream=side_data_list`) is required — the latter
  // returns the section but with empty objects, omitting `side_data_type` and
  // `rotation`, which silently defeats Display Matrix detection.
  return [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream_side_data:stream_tags=rotate',
    '-of', 'json',
    input,
  ]
}

export async function detectVideoRotation (client: PluginClient, input: string): Promise<number> {
  try {
    const result = await client.run('ffprobe', buildProbeRotationArgs(input), {
      label: 'ffprobe',
      timeout: FFPROBE_TIMEOUT,
    })
    if (result.exitCode !== 0) {
      return 0
    }
    const parsed = JSON.parse(result.stdout) as unknown
    return parseRotation(parsed)
  } catch {
    return 0
  }
}

export async function runFfmpeg (client: PluginClient, args: string[]): Promise<boolean> {
  try {
    const result = await client.run('ffmpeg', args, {
      label: 'ffmpeg',
      timeout: FFMPEG_TIMEOUT,
    })
    return result.exitCode === 0
  } catch {
    return false
  }
}
