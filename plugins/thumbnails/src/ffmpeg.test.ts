import type { PluginClient, RunResult } from '@aviato-media/plugin-sdk'
import { describe, expect, test } from 'bun:test'

import {
  buildAudioArgs,
  buildImageArgs,
  buildProbeRotationArgs,
  buildRotationFilter,
  buildVideoArgs,
  calculateTimestamp,
  detectVideoRotation,
  isAudio,
  isImage,
  isVideo,
  parseRotation,
} from './ffmpeg'

function mockClient (run: (cmd: string, args: string[]) => Promise<RunResult>): PluginClient {
  return { run } as unknown as PluginClient
}

function probeResult (stdout: string, exitCode = 0): RunResult {
  return {
    stdout,
    stderr: '',
    exitCode,
  }
}

describe('calculateTimestamp', () => {
  test('returns 00:00:01 for no duration', () => {
    expect(calculateTimestamp()).toBe('00:00:01')
    expect(calculateTimestamp(0)).toBe('00:00:01')
    expect(calculateTimestamp(-5)).toBe('00:00:01')
  })
  test('returns 10% of duration for normal videos', () => {
    expect(calculateTimestamp(2000)).toBe('00:03:20') // 10% = 200s, under cap
    expect(calculateTimestamp(600)).toBe('00:01:00')
    expect(calculateTimestamp(100)).toBe('00:00:10')
  })
  test('caps at 5 minutes for long videos', () => {
    expect(calculateTimestamp(4000)).toBe('00:05:00') // 10% = 400s, capped to 300s
    expect(calculateTimestamp(7200)).toBe('00:05:00')
    expect(calculateTimestamp(36000)).toBe('00:05:00')
  })
  test('handles short videos', () => {
    expect(calculateTimestamp(10)).toBe('00:00:01')
    expect(calculateTimestamp(5)).toBe('00:00:00')
  })
})

describe('buildVideoArgs', () => {
  test('builds correct FFmpeg arguments', () => {
    const args = buildVideoArgs('/input/movie.mkv', '/output/thumb.jpg', '00:05:00')
    expect(args).toEqual(['-ss', '00:05:00', '-i', '/input/movie.mkv', '-vframes', '1', '-vf', 'scale=300:-1', '-q:v', '5', '/output/thumb.jpg', '-y'])
  })
  test('omits rotation filter and -noautorotate when rotation is 0', () => {
    const args = buildVideoArgs('/input/movie.mkv', '/output/thumb.jpg', '00:05:00', { rotation: 0 })
    expect(args).not.toContain('-noautorotate')
    expect(args).toEqual(['-ss', '00:05:00', '-i', '/input/movie.mkv', '-vframes', '1', '-vf', 'scale=300:-1', '-q:v', '5', '/output/thumb.jpg', '-y'])
  })
  test('prepends transpose filter and -noautorotate for 90° clockwise', () => {
    const args = buildVideoArgs('/input/portrait.mp4', '/output/thumb.jpg', '00:00:01', { rotation: 90 })
    expect(args).toEqual([
      '-ss', '00:00:01',
      '-noautorotate',
      '-i', '/input/portrait.mp4',
      '-vframes', '1',
      '-vf', 'transpose=1,scale=300:-1',
      '-q:v', '5',
      '/output/thumb.jpg',
      '-y',
    ])
  })
  test('uses transpose=2 for 270° clockwise', () => {
    const args = buildVideoArgs('/input/portrait.mp4', '/output/thumb.jpg', '00:00:01', { rotation: 270 })
    const vfIndex = args.indexOf('-vf')
    expect(args[vfIndex + 1]).toBe('transpose=2,scale=300:-1')
    expect(args).toContain('-noautorotate')
  })
  test('uses hflip,vflip for 180°', () => {
    const args = buildVideoArgs('/input/upside-down.mp4', '/output/thumb.jpg', '00:00:01', { rotation: 180 })
    const vfIndex = args.indexOf('-vf')
    expect(args[vfIndex + 1]).toBe('hflip,vflip,scale=300:-1')
    expect(args).toContain('-noautorotate')
  })
  test('-noautorotate sits between -ss and -i so it applies to the input', () => {
    const args = buildVideoArgs('/input/portrait.mp4', '/output/thumb.jpg', '00:00:01', { rotation: 90 })
    const noAuto = args.indexOf('-noautorotate')
    const inputIdx = args.indexOf('-i')
    expect(noAuto).toBeGreaterThan(-1)
    expect(noAuto).toBeLessThan(inputIdx)
  })
})

describe('buildRotationFilter', () => {
  test('returns null for 0 / no-op rotations', () => {
    expect(buildRotationFilter(0)).toBe(null)
    expect(buildRotationFilter(360)).toBe(null)
    expect(buildRotationFilter(-360)).toBe(null)
  })
  test('maps 90° clockwise to transpose=1', () => {
    expect(buildRotationFilter(90)).toBe('transpose=1')
  })
  test('maps 180° to hflip,vflip', () => {
    expect(buildRotationFilter(180)).toBe('hflip,vflip')
    expect(buildRotationFilter(-180)).toBe('hflip,vflip')
  })
  test('maps 270° clockwise (-90 CCW) to transpose=2', () => {
    expect(buildRotationFilter(270)).toBe('transpose=2')
    expect(buildRotationFilter(-90)).toBe('transpose=2')
  })
  test('rounds noisy floating-point rotations to the nearest 90°', () => {
    expect(buildRotationFilter(89.9)).toBe('transpose=1')
    expect(buildRotationFilter(-89.5)).toBe('transpose=2')
  })
  test('returns null for non-finite input', () => {
    expect(buildRotationFilter(Number.NaN)).toBe(null)
    expect(buildRotationFilter(Number.POSITIVE_INFINITY)).toBe(null)
  })
})

describe('parseRotation', () => {
  test('reads -90 from Display Matrix side_data as 90° clockwise', () => {
    const probe = {
      streams: [
        {
          side_data_list: [
            {
              side_data_type: 'Display Matrix',
              rotation: -90,
            },
          ],
        },
      ],
    }
    expect(parseRotation(probe)).toBe(90)
  })
  test('reads +90 from Display Matrix side_data as 270° clockwise', () => {
    const probe = {
      streams: [
        {
          side_data_list: [{
            side_data_type: 'Display Matrix',
            rotation: 90,
          }],
        },
      ],
    }
    expect(parseRotation(probe)).toBe(270)
  })
  test('reads 180 from Display Matrix side_data', () => {
    const probe = {
      streams: [
        {
          side_data_list: [{
            side_data_type: 'Display Matrix',
            rotation: 180,
          }],
        },
      ],
    }
    expect(parseRotation(probe)).toBe(180)
  })
  test('falls back to legacy tags.rotate when side_data is absent', () => {
    const probe = {
      streams: [
        { tags: { rotate: '90' } },
      ],
    }
    expect(parseRotation(probe)).toBe(90)
  })
  test('handles legacy tags.rotate=270', () => {
    const probe = {
      streams: [
        { tags: { rotate: 270 } },
      ],
    }
    expect(parseRotation(probe)).toBe(270)
  })
  test('prefers Display Matrix when both side_data and tags.rotate are present', () => {
    const probe = {
      streams: [
        {
          side_data_list: [{
            side_data_type: 'Display Matrix',
            rotation: -90,
          }],
          tags: { rotate: '180' },
        },
      ],
    }
    expect(parseRotation(probe)).toBe(90)
  })
  test('matches side_data_type case-insensitively', () => {
    const probe = {
      streams: [
        {
          side_data_list: [{
            side_data_type: 'display matrix',
            rotation: -90,
          }],
        },
      ],
    }
    expect(parseRotation(probe)).toBe(90)
  })
  test('ignores non-Display-Matrix side_data entries', () => {
    const probe = {
      streams: [
        {
          side_data_list: [
            { side_data_type: 'DOVI configuration record' },
            {
              side_data_type: 'Display Matrix',
              rotation: -90,
            },
          ],
        },
      ],
    }
    expect(parseRotation(probe)).toBe(90)
  })
  test('returns 0 when no rotation metadata is present', () => {
    expect(parseRotation({ streams: [{}] })).toBe(0)
    expect(parseRotation({ streams: [] })).toBe(0)
  })
  test('returns 0 for malformed input', () => {
    expect(parseRotation(null)).toBe(0)
    expect(parseRotation(undefined)).toBe(0)
    expect(parseRotation('not json')).toBe(0)
    expect(parseRotation({
      streams: [{
        side_data_list: [{
          side_data_type: 'Display Matrix',
          rotation: 'not-a-number',
        }],
      }],
    })).toBe(0)
  })
})

describe('detectVideoRotation', () => {
  test('returns CW degrees parsed from a real Display Matrix payload', async () => {
    const stdout = JSON.stringify({
      streams: [
        {
          side_data_list: [{
            side_data_type: 'Display Matrix',
            rotation: -90,
          }],
        },
      ],
    })
    const client = mockClient(async () => probeResult(stdout))
    expect(await detectVideoRotation(client, '/x.mov')).toBe(90)
  })
  test('invokes ffprobe with the buildProbeRotationArgs argv', async () => {
    let captured: { cmd: string,
      args: string[] } | null = null
    const client = mockClient(async (cmd, args) => {
      captured = {
        cmd,
        args,
      }
      return probeResult('{"streams":[]}')
    })
    await detectVideoRotation(client, '/clip.mp4')
    expect(captured!.cmd).toBe('ffprobe')
    expect(captured!.args).toEqual(buildProbeRotationArgs('/clip.mp4'))
  })
  test('returns 0 when ffprobe exits non-zero', async () => {
    const client = mockClient(async () => probeResult('', 1))
    expect(await detectVideoRotation(client, '/x.mp4')).toBe(0)
  })
  test('returns 0 when ffprobe stdout is malformed JSON', async () => {
    const client = mockClient(async () => probeResult('not-json'))
    expect(await detectVideoRotation(client, '/x.mp4')).toBe(0)
  })
  test('returns 0 when ffprobe throws (timeout, ENOENT, etc.)', async () => {
    const client = mockClient(async () => {
      throw new Error('boom')
    })
    expect(await detectVideoRotation(client, '/x.mp4')).toBe(0)
  })
})

describe('buildProbeRotationArgs', () => {
  test('queries only the first video stream and asks for rotation entries as JSON', () => {
    const args = buildProbeRotationArgs('/input/clip.mov')
    expect(args).toEqual([
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream_side_data:stream_tags=rotate',
      '-of', 'json',
      '/input/clip.mov',
    ])
  })
  test('uses stream_side_data, not stream=side_data_list — the latter returns empty entries', () => {
    const args = buildProbeRotationArgs('/x.mp4')
    const showIdx = args.indexOf('-show_entries')
    expect(args[showIdx + 1]).toContain('stream_side_data')
    expect(args[showIdx + 1]).not.toContain('stream=side_data_list')
  })
})

describe('buildImageArgs', () => {
  test('builds correct FFmpeg arguments', () => {
    const args = buildImageArgs('/input/photo.jpg', '/output/thumb.jpg')
    expect(args).toEqual(['-i', '/input/photo.jpg', '-vf', 'scale=300:-1', '-q:v', '5', '/output/thumb.jpg', '-y'])
  })
})

describe('buildAudioArgs', () => {
  test('extracts embedded cover art via optional video stream mapping', () => {
    const args = buildAudioArgs('/input/book.m4b', '/output/thumb.jpg')
    expect(args).toEqual(['-i', '/input/book.m4b', '-an', '-map', '0:v?', '-vf', 'scale=300:-1', '-q:v', '5', '/output/thumb.jpg', '-y'])
  })
})

describe('isVideo', () => {
  test('recognizes video extensions in both bare and dotted form', () => {
    expect(isVideo('mkv')).toBe(true)
    expect(isVideo('.mkv')).toBe(true)
    expect(isVideo('mp4')).toBe(true)
    expect(isVideo('avi')).toBe(true)
    expect(isVideo('webm')).toBe(true)
    expect(isVideo('MKV')).toBe(true)
  })
  test('rejects non-video extensions', () => {
    expect(isVideo('jpg')).toBe(false)
    expect(isVideo('mp3')).toBe(false)
    expect(isVideo('')).toBe(false)
  })
})

describe('isImage', () => {
  test('recognizes image extensions in both bare and dotted form', () => {
    expect(isImage('jpg')).toBe(true)
    expect(isImage('.jpg')).toBe(true)
    expect(isImage('jpeg')).toBe(true)
    expect(isImage('png')).toBe(true)
    expect(isImage('webp')).toBe(true)
    expect(isImage('PNG')).toBe(true)
  })
  test('rejects non-image extensions', () => {
    expect(isImage('mkv')).toBe(false)
    expect(isImage('')).toBe(false)
  })
})

describe('isAudio', () => {
  test('recognizes audio extensions in both bare and dotted form', () => {
    expect(isAudio('mp3')).toBe(true)
    expect(isAudio('.mp3')).toBe(true)
    expect(isAudio('m4a')).toBe(true)
    expect(isAudio('m4b')).toBe(true)
    expect(isAudio('flac')).toBe(true)
    expect(isAudio('opus')).toBe(true)
    expect(isAudio('M4B')).toBe(true)
  })
  test('rejects non-audio extensions', () => {
    expect(isAudio('mkv')).toBe(false)
    expect(isAudio('jpg')).toBe(false)
    expect(isAudio('')).toBe(false)
  })
})
