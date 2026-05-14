import type { PluginClient } from '@aviato-media/plugin-sdk'

const THUMBNAIL_WIDTH = 300
const QUALITY = '5'
// Single-frame thumbnail extraction is near-instant on healthy media; a long
// timeout here only serves to compound when a file is genuinely broken (we
// retry once on failure, so the effective budget is 2x). Keep tight so bad
// files fail fast and don't dominate the per-bundle hook budget.
const FFMPEG_TIMEOUT = 10_000
const FFPROBE_TIMEOUT = 5_000

// Average luma (Y, 0-255) below which a thumbnail is treated as "essentially
// black" and the caller should try a different timestamp. 16 corresponds to
// the start of broadcast-safe black; real frames with any visible content
// almost always exceed 20.
export const BLACK_LUMA_THRESHOLD = 16

// Below this, the 10th-to-90th percentile spread of luma values is so narrow
// that the frame is effectively a single color band — solid grey, blank
// gradients, slate / test cards, or the near-uniform "blocky" mush some
// encoders leave around scene transitions. Real content almost always
// exceeds 30.
export const LOW_VARIANCE_SPREAD_THRESHOLD = 16

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

function secondsToTimestamp (totalSeconds: number): string {
  const safe = Math.floor(Math.max(0, totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function calculateTimestamp (durationSeconds?: number): string {
  if (!durationSeconds || durationSeconds <= 0) {
    return '00:00:01'
  }
  return secondsToTimestamp(Math.min(durationSeconds * 0.1, 300))
}

// Ordered timestamps to probe when the first pick yields an all-black frame
// (common with intro fades, scene transitions, or videos that open on a dark
// shot). Position 0 matches calculateTimestamp() so the happy path is
// unchanged; subsequent positions fan out across the clip, biasing toward
// mid-points which tend to avoid intros and credits.
export function buildTimestampCandidates (durationSeconds?: number): string[] {
  if (!durationSeconds || durationSeconds <= 0) {
    return ['00:00:01']
  }
  const percentages = [0.1, 0.25, 0.5, 0.4, 0.75, 0.05, 0.9]
  const seen = new Set<string>()
  const result: string[] = []
  for (const pct of percentages) {
    // Cap matches calculateTimestamp's 5-minute bound: pushing past that on
    // long files doesn't help thumbnail quality and risks seeking into
    // chapters the viewer won't recognize.
    const ts = secondsToTimestamp(Math.min(durationSeconds * pct, 300))
    if (!seen.has(ts)) {
      seen.add(ts)
      result.push(ts)
    }
  }
  return result
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
  // When true, prepend signalstats+metadata=print to the -vf chain so the
  // resulting ffmpeg invocation writes per-frame luma stats to stdout
  // alongside writing the thumbnail to disk. Adds <5ms of analysis cost on a
  // single frame and avoids a second ffmpeg call to probe the output.
  analyze?: boolean
}

export function buildVideoArgs (
  input: string,
  output: string,
  timestamp: string,
  options: VideoArgsOptions = {},
): string[] {
  const rotationFilter = buildRotationFilter(options.rotation ?? 0)
  // signalstats runs on the source frame (before scaling) so the stats reflect
  // the actual content. metadata=mode=print:file=- dumps the resulting tags to
  // stdout; the frame itself passes through unchanged into rotation+scale.
  const analyzePrefix = options.analyze ? 'signalstats,metadata=mode=print:file=-,' : ''
  const transform = rotationFilter
    ? `${rotationFilter},scale=${THUMBNAIL_WIDTH}:-1`
    : `scale=${THUMBNAIL_WIDTH}:-1`
  const vf = `${analyzePrefix}${transform}`
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

export interface FfmpegResult {
  ok: boolean
  stdout: string
}

export async function runFfmpeg (client: PluginClient, args: string[]): Promise<FfmpegResult> {
  try {
    const result = await client.run('ffmpeg', args, {
      label: 'ffmpeg',
      timeout: FFMPEG_TIMEOUT,
    })
    return {
      ok: result.exitCode === 0,
      stdout: result.stdout,
    }
  } catch {
    return {
      ok: false,
      stdout: '',
    }
  }
}

// Parsed luma stats from signalstats+metadata=print output. YAVG is the
// average luma value; YLOW/YHIGH are the 10th/90th percentile pixel values
// (their spread serves as a robust tonal-range proxy).
export interface FrameStats {
  yavg: number
  ylow: number
  yhigh: number
}

function parseSignalStat (stdout: string, key: string): number | null {
  const match = stdout.match(new RegExp(`lavfi\\.signalstats\\.${key}=([0-9.eE+-]+)`))
  if (!match) {
    return null
  }
  const value = parseFloat(match[1])
  return Number.isFinite(value) ? value : null
}

export function parseFrameStats (stdout: string): FrameStats | null {
  const yavg = parseSignalStat(stdout, 'YAVG')
  const ylow = parseSignalStat(stdout, 'YLOW')
  const yhigh = parseSignalStat(stdout, 'YHIGH')
  if (yavg === null || ylow === null || yhigh === null) {
    return null
  }
  return {
    yavg,
    ylow,
    yhigh,
  }
}

// A frame is "degenerate" if it's either too dark to convey content or has
// so little tonal variation that it's effectively a single color. Both
// conditions are independent — a dark scene with a single bright spot still
// passes (yavg low but spread wide), and a bright solid-grey slate still
// fails (yavg high but spread narrow).
export function isFrameDegenerate (stats: FrameStats): boolean {
  if (!Number.isFinite(stats.yavg) || !Number.isFinite(stats.ylow) || !Number.isFinite(stats.yhigh)) {
    return false
  }
  if (stats.yavg < BLACK_LUMA_THRESHOLD) {
    return true
  }
  if (stats.yhigh - stats.ylow < LOW_VARIANCE_SPREAD_THRESHOLD) {
    return true
  }
  return false
}

// Higher = better. Used to pick the "least bad" thumbnail when every
// candidate is degenerate — favors frames with wider tonal range over
// uniformly dark or uniformly flat ones.
export function frameQuality (stats: FrameStats): number {
  return stats.yhigh - stats.ylow
}
