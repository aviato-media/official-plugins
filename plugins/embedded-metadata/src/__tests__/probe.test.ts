import { describe, expect, test } from 'bun:test'

import { detectCoverArtStream, parseProbeOutput } from '../probe.js'

// Fixture: MP4 with iTunes-style tags and cover art
const MP4_PROBE_OUTPUT = {
  format: {
    filename: '/media/movies/Blade Runner.mp4',
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    duration: '7020.123000',
    size: '2147483648',
    tags: {
      '©nam': 'Blade Runner',
      '©day': '1982-06-25',
      '©gen': 'Sci-Fi',
      '©ART': 'Ridley Scott',
      desc: 'A blade runner must pursue and terminate four replicants.',
      encoder: 'HandBrake 1.6.1',
    },
  },
  streams: [
    {
      index: 0,
      codec_type: 'video',
      codec_name: 'h264',
      width: 1920,
      height: 1080,
      disposition: {
        default: 1,
        attached_pic: 0,
      },
    },
    {
      index: 1,
      codec_type: 'audio',
      codec_name: 'aac',
      disposition: {
        default: 1,
        attached_pic: 0,
      },
    },
    {
      index: 2,
      codec_type: 'video',
      codec_name: 'mjpeg',
      width: 600,
      height: 900,
      disposition: {
        default: 0,
        attached_pic: 1,
      },
      tags: {
        comment: 'Cover (front)',
      },
    },
  ],
}

// Fixture: MKV with Matroska tags and canonical IDs
const MKV_PROBE_OUTPUT = {
  format: {
    filename: '/media/movies/Blade Runner.mkv',
    format_name: 'matroska,webm',
    duration: '7020.123000',
    size: '4294967296',
    tags: {
      TITLE: 'Blade Runner',
      DATE_RELEASED: '1982',
      GENRE: 'Sci-Fi',
      DESCRIPTION: 'A blade runner must pursue and terminate four replicants.',
      IMDB: 'tt0083658',
      TMDB: '78',
      ENCODER: 'mkvmerge v72.0.0',
    },
  },
  streams: [
    {
      index: 0,
      codec_type: 'video',
      codec_name: 'hevc',
      width: 3840,
      height: 2160,
      disposition: {
        default: 1,
        attached_pic: 0,
      },
    },
    {
      index: 1,
      codec_type: 'audio',
      codec_name: 'truehd',
      disposition: {
        default: 1,
        attached_pic: 0,
      },
    },
  ],
}

// Fixture: minimal file with no tags
const MINIMAL_PROBE_OUTPUT = {
  format: {
    filename: '/media/movies/unknown.avi',
    format_name: 'avi',
    duration: '3600.000000',
    size: '1073741824',
  },
  streams: [
    {
      index: 0,
      codec_type: 'video',
      codec_name: 'mpeg4',
      disposition: {
        default: 1,
        attached_pic: 0,
      },
    },
  ],
}

describe('parseProbeOutput', () => {
  test('parses MP4 probe output with iTunes tags', () => {
    const result = parseProbeOutput(MP4_PROBE_OUTPUT)
    expect(result.title).toBe('Blade Runner')
    expect(result.year).toBe(1982)
    expect(result.canonicalIds).toEqual([])
    expect(result.genres).toEqual(['Sci-Fi'])
    expect(result.fields.artist).toBe('Ridley Scott')
    expect(result.fields.author).toBe('Ridley Scott')
    expect(result.fields.description).toBe('A blade runner must pursue and terminate four replicants.')
    expect(result.fields.encoder).toBe('HandBrake 1.6.1')
  })

  test('parses MKV probe output with canonical IDs', () => {
    const result = parseProbeOutput(MKV_PROBE_OUTPUT)
    expect(result.title).toBe('Blade Runner')
    expect(result.year).toBe(1982)
    expect(result.canonicalIds).toContainEqual({
      provider: 'imdb',
      id: 'tt0083658',
    })
    expect(result.canonicalIds).toContainEqual({
      provider: 'tmdb',
      id: '78',
    })
    expect(result.genres).toEqual(['Sci-Fi'])
  })

  test('handles missing tags gracefully', () => {
    const result = parseProbeOutput(MINIMAL_PROBE_OUTPUT)
    expect(result.title).toBeUndefined()
    expect(result.year).toBeUndefined()
    expect(result.canonicalIds).toEqual([])
    expect(result.fields).toEqual({})
  })
})

describe('detectCoverArtStream', () => {
  test('finds attached picture stream in MP4', () => {
    const stream = detectCoverArtStream(MP4_PROBE_OUTPUT.streams)
    expect(stream).toBeDefined()
    expect(stream!.index).toBe(2)
    expect(stream!.codec_name).toBe('mjpeg')
  })

  test('returns undefined when no cover art stream', () => {
    const stream = detectCoverArtStream(MKV_PROBE_OUTPUT.streams)
    expect(stream).toBeUndefined()
  })

  test('returns undefined for empty streams', () => {
    const stream = detectCoverArtStream([])
    expect(stream).toBeUndefined()
  })
})
