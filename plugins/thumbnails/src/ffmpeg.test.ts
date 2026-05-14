import type { PluginClient, RunResult } from '@aviato-media/plugin-sdk'
import { describe, expect, test } from 'bun:test'

import {
  BLACK_LUMA_THRESHOLD,
  buildAudioArgs,
  buildImageArgs,
  buildProbeRotationArgs,
  buildRotationFilter,
  buildTimestampCandidates,
  buildVideoArgs,
  calculateTimestamp,
  detectVideoRotation,
  frameQuality,
  isAudio,
  isFrameDegenerate,
  isImage,
  isVideo,
  LOW_VARIANCE_SPREAD_THRESHOLD,
  parseFrameStats,
  parseRotation,
  runFfmpeg,
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
  test('analyze:true prepends signalstats+metadata=print to the -vf chain', () => {
    const args = buildVideoArgs('/input/movie.mkv', '/output/thumb.jpg', '00:05:00', { analyze: true })
    const vfIndex = args.indexOf('-vf')
    expect(args[vfIndex + 1]).toBe('signalstats,metadata=mode=print:file=-,scale=300:-1')
  })
  test('analyze:true composes correctly with rotation', () => {
    const args = buildVideoArgs('/input/portrait.mp4', '/output/thumb.jpg', '00:00:01', {
      rotation: 90,
      analyze: true,
    })
    const vfIndex = args.indexOf('-vf')
    expect(args[vfIndex + 1]).toBe('signalstats,metadata=mode=print:file=-,transpose=1,scale=300:-1')
    expect(args).toContain('-noautorotate')
  })
  test('analyze:false (default) omits signalstats so existing callers are unaffected', () => {
    const args = buildVideoArgs('/input/movie.mkv', '/output/thumb.jpg', '00:05:00')
    const vfIndex = args.indexOf('-vf')
    expect(args[vfIndex + 1]).not.toContain('signalstats')
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

describe('buildTimestampCandidates', () => {
  test('returns a single early offset when duration is unknown or invalid', () => {
    expect(buildTimestampCandidates()).toEqual(['00:00:01'])
    expect(buildTimestampCandidates(0)).toEqual(['00:00:01'])
    expect(buildTimestampCandidates(-1)).toEqual(['00:00:01'])
  })
  test('leads with the 10% offset so the happy path matches calculateTimestamp', () => {
    const candidates = buildTimestampCandidates(600)
    expect(candidates[0]).toBe(calculateTimestamp(600))
  })
  test('fans out across the clip for typical durations', () => {
    // 1000s clip: 10%, 25%, and 5% stay under the 5-minute cap; 50%, 40%, 75%
    // and 90% all collapse onto 00:05:00 and dedupe to a single entry.
    expect(buildTimestampCandidates(1000)).toEqual([
      '00:01:40', '00:04:10', '00:05:00', '00:00:50',
    ])
  })
  test('caps each candidate at the legacy 5-minute bound', () => {
    for (const ts of buildTimestampCandidates(7200)) {
      const [h, m] = ts.split(':').map(Number)
      expect(h * 3600 + m * 60).toBeLessThanOrEqual(300)
    }
  })
  test('deduplicates collapsed candidates without preserving empty slots', () => {
    const candidates = buildTimestampCandidates(5)
    const unique = new Set(candidates)
    expect(candidates.length).toBe(unique.size)
    expect(candidates.length).toBeGreaterThan(1)
  })
})

function statsOutput (yavg: number, ylow: number, yhigh: number): string {
  return [
    'frame:0    pts:0      pts_time:0',
    'lavfi.signalstats.YMIN=0',
    `lavfi.signalstats.YLOW=${ylow}`,
    `lavfi.signalstats.YAVG=${yavg}`,
    `lavfi.signalstats.YHIGH=${yhigh}`,
    'lavfi.signalstats.YMAX=255',
  ].join('\n')
}

describe('parseFrameStats', () => {
  test('extracts YAVG, YLOW and YHIGH together', () => {
    const stats = parseFrameStats(statsOutput(80, 20, 220))
    expect(stats).toEqual({
      yavg: 80,
      ylow: 20,
      yhigh: 220,
    })
  })
  test('handles fractional and scientific notation', () => {
    const stats = parseFrameStats([
      'lavfi.signalstats.YAVG=12.345',
      'lavfi.signalstats.YLOW=1.5e1',
      'lavfi.signalstats.YHIGH=200',
    ].join('\n'))
    expect(stats!.yavg).toBeCloseTo(12.345, 3)
    expect(stats!.ylow).toBe(15)
    expect(stats!.yhigh).toBe(200)
  })
  test('returns null when any of the three required tags is missing', () => {
    expect(parseFrameStats('lavfi.signalstats.YAVG=80\nlavfi.signalstats.YLOW=20')).toBe(null)
    expect(parseFrameStats('lavfi.signalstats.YAVG=80\nlavfi.signalstats.YHIGH=220')).toBe(null)
    expect(parseFrameStats('')).toBe(null)
  })
  test('returns null when any tag value is non-finite', () => {
    expect(parseFrameStats([
      'lavfi.signalstats.YAVG=nan',
      'lavfi.signalstats.YLOW=20',
      'lavfi.signalstats.YHIGH=220',
    ].join('\n'))).toBe(null)
  })
})

describe('isFrameDegenerate', () => {
  test('flags frames whose average luma is below the black threshold', () => {
    expect(isFrameDegenerate({
      yavg: 0,
      ylow: 0,
      yhigh: 50,
    })).toBe(true)
    expect(isFrameDegenerate({
      yavg: BLACK_LUMA_THRESHOLD - 0.01,
      ylow: 0,
      yhigh: 50,
    })).toBe(true)
  })
  test('flags low-variance frames even when not dark', () => {
    // Solid grey slate: YAVG well above black, but YHIGH-YLOW collapses.
    expect(isFrameDegenerate({
      yavg: 128,
      ylow: 126,
      yhigh: 130,
    })).toBe(true)
    expect(isFrameDegenerate({
      yavg: 200,
      ylow: 195,
      yhigh: 200,
    })).toBe(true)
  })
  test('accepts dark scenes that still have meaningful tonal range', () => {
    // Night-time shot with a single highlight: YAVG low but spread wide.
    expect(isFrameDegenerate({
      yavg: 30,
      ylow: 10,
      yhigh: 180,
    })).toBe(false)
  })
  test('accepts ordinary frames', () => {
    expect(isFrameDegenerate({
      yavg: 110,
      ylow: 30,
      yhigh: 200,
    })).toBe(false)
    expect(isFrameDegenerate({
      yavg: 200,
      ylow: 100,
      yhigh: 250,
    })).toBe(false)
  })
  test('the spread cutoff matches LOW_VARIANCE_SPREAD_THRESHOLD', () => {
    expect(isFrameDegenerate({
      yavg: 100,
      ylow: 100,
      yhigh: 100 + LOW_VARIANCE_SPREAD_THRESHOLD - 1,
    })).toBe(true)
    expect(isFrameDegenerate({
      yavg: 100,
      ylow: 100,
      yhigh: 100 + LOW_VARIANCE_SPREAD_THRESHOLD,
    })).toBe(false)
  })
  test('does not flag stats containing non-finite values (treat probe junk as accept)', () => {
    expect(isFrameDegenerate({
      yavg: Number.NaN,
      ylow: 0,
      yhigh: 50,
    })).toBe(false)
    expect(isFrameDegenerate({
      yavg: 100,
      ylow: Number.POSITIVE_INFINITY,
      yhigh: 200,
    })).toBe(false)
  })
})

describe('frameQuality', () => {
  test('returns the YHIGH-YLOW spread so wider tonal range scores higher', () => {
    expect(frameQuality({
      yavg: 100,
      ylow: 30,
      yhigh: 200,
    })).toBe(170)
    expect(frameQuality({
      yavg: 100,
      ylow: 99,
      yhigh: 101,
    })).toBe(2)
  })
  test('ranks a dark-but-detailed frame above a uniform grey slate', () => {
    const darkDetailed = frameQuality({
      yavg: 20,
      ylow: 0,
      yhigh: 180,
    })
    const greySlate = frameQuality({
      yavg: 128,
      ylow: 126,
      yhigh: 130,
    })
    expect(darkDetailed).toBeGreaterThan(greySlate)
  })
})

describe('runFfmpeg', () => {
  test('returns { ok: true, stdout } when ffmpeg exits 0 and includes signalstats output', async () => {
    const stdout = statsOutput(80, 30, 200)
    const client = mockClient(async () => probeResult(stdout))
    expect(await runFfmpeg(client, ['-i', '/x.mp4'])).toEqual({
      ok: true,
      stdout,
    })
  })
  test('returns { ok: false } when ffmpeg exits non-zero', async () => {
    const client = mockClient(async () => probeResult('partial output', 1))
    const result = await runFfmpeg(client, ['-i', '/x.mp4'])
    expect(result.ok).toBe(false)
    expect(result.stdout).toBe('partial output')
  })
  test('returns { ok: false, stdout: "" } when client.run throws', async () => {
    const client = mockClient(async () => {
      throw new Error('boom')
    })
    expect(await runFfmpeg(client, ['-i', '/x.mp4'])).toEqual({
      ok: false,
      stdout: '',
    })
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
