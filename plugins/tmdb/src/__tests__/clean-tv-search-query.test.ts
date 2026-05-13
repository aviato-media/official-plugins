import { describe, expect, test } from 'bun:test'

import { cleanTvSearchQuery } from '../index.js'

describe('cleanTvSearchQuery', () => {
  describe('with file URI (parseTvFilename path)', () => {
    test('extracts series name from S01E01 filename', () => {
      const result = cleanTvSearchQuery(
        'Silicon Valley - S01E01 - Minimum Viable Product Bluray-1080p Remux',
        'tv/Silicon Valley/S01/Silicon Valley - S01E01 - Minimum Viable Product Bluray-1080p Remux.mkv',
      )
      expect(result).toBe('Silicon Valley')
    })

    test('extracts series name from dot-separated filename', () => {
      const result = cleanTvSearchQuery(
        'The.Office.S02E05.720p.BluRay.x264',
        '/media/tv/The Office/Season 02/The.Office.S02E05.720p.BluRay.x264.mkv',
      )
      expect(result).toBe('The Office')
    })

    test('extracts series name with year', () => {
      const result = cleanTvSearchQuery(
        'House of the Dragon (2022) S01E01',
        '/tv/House of the Dragon (2022)/Season 01/House of the Dragon (2022) S01E01.mkv',
      )
      expect(result).toBe('House of the Dragon')
    })

    test('extracts series name from multi-episode file', () => {
      const result = cleanTvSearchQuery(
        'Breaking Bad - S05E15E16 - Granite State & Felina',
        '/tv/Breaking Bad/S05/Breaking Bad - S05E15E16 - Granite State & Felina.mkv',
      )
      expect(result).toBe('Breaking Bad')
    })

    test('handles 1x01 format', () => {
      const result = cleanTvSearchQuery(
        'Seinfeld 1x01 The Seinfeld Chronicles',
        '/tv/Seinfeld/Season 1/Seinfeld 1x01 The Seinfeld Chronicles.mkv',
      )
      expect(result).toBe('Seinfeld')
    })
  })

  describe('regex fallback (no file URI)', () => {
    test('strips S01E01 and everything after', () => {
      const result = cleanTvSearchQuery(
        'Silicon Valley - S01E01 - Minimum Viable Product Bluray-1080p Remux',
      )
      expect(result).toBe('Silicon Valley')
    })

    test('strips dot-separated S##E## pattern', () => {
      const result = cleanTvSearchQuery(
        'The.Office.S02E05.720p.BluRay.x264',
      )
      expect(result).toBe('The Office')
    })

    test('strips 1x01 format', () => {
      const result = cleanTvSearchQuery(
        'Game of Thrones 1x01 Winter Is Coming',
      )
      expect(result).toBe('Game of Thrones')
    })

    test('strips Season N Episode N format', () => {
      const result = cleanTvSearchQuery(
        'Stranger Things Season 4 Episode 1',
      )
      expect(result).toBe('Stranger Things')
    })

    test('strips quality indicators without episode info', () => {
      const result = cleanTvSearchQuery(
        'The Mandalorian 1080p Remux',
      )
      expect(result).toBe('The Mandalorian')
    })

    test('strips bluray source tag', () => {
      const result = cleanTvSearchQuery(
        'Pied Piper Bluray-1080p',
      )
      expect(result).toBe('Pied Piper')
    })

    test('strips web-dl source tag', () => {
      const result = cleanTvSearchQuery(
        'Succession WEB-DL 2160p',
      )
      expect(result).toBe('Succession')
    })

    test('returns original title when already clean', () => {
      const result = cleanTvSearchQuery('Silicon Valley')
      expect(result).toBe('Silicon Valley')
    })

    test('normalises dot separators', () => {
      const result = cleanTvSearchQuery('Mr.Robot.S01E01')
      expect(result).toBe('Mr Robot')
    })

    test('normalises underscore separators', () => {
      const result = cleanTvSearchQuery('The_Wire_S01E01')
      expect(result).toBe('The Wire')
    })

    test('returns original title if cleaning would produce empty string', () => {
      const result = cleanTvSearchQuery('S01E01')
      expect(result).toBe('S01E01')
    })
  })

  describe('file URI with unparseable filename falls back to regex', () => {
    test('uses regex fallback when filename has no episode pattern', () => {
      const result = cleanTvSearchQuery(
        'Some Show 1080p Remux',
        '/tv/Some Show/episode.mkv',
      )
      expect(result).toBe('Some Show')
    })
  })

  // ── Common folder/file naming conventions ──────────────
  // These test realistic paths seen in the wild from Plex, Jellyfin,
  // Sonarr, manual rips, etc. The title param simulates what FFprobe
  // or the filename parser might feed into the bundle.

  describe('folder-derived show name (filename lacks show name)', () => {
    test('S01/S01E01.mp4 — short season folder, episode-only filename', () => {
      const result = cleanTvSearchQuery(
        'S01E01',
        '/tv/Simpsons/S01/S01E01.mp4',
      )
      expect(result).toBe('Simpsons')
    })

    test('Season 1/Episode 1.mp4 — wordy folder, wordy filename', () => {
      const result = cleanTvSearchQuery(
        'Episode 1',
        "/tv/Bob's Burgers/Season 1/Episode 1.mp4",
      )
      expect(result).toBe("Bob's Burgers")
    })

    test('Season 01/01.mp4 — bare episode number', () => {
      const result = cleanTvSearchQuery(
        '01',
        '/tv/Futurama/Season 01/01.mp4',
      )
      expect(result).toBe('Futurama')
    })

    test('Season 1/E01.mp4 — E-prefix episode number', () => {
      const result = cleanTvSearchQuery(
        'E01',
        '/tv/Archer/Season 1/E01.mp4',
      )
      expect(result).toBe('Archer')
    })

    test('S1/E01 - Episode Title.mp4 — single-digit season folder', () => {
      const result = cleanTvSearchQuery(
        'E01 - Episode Title',
        '/tv/Arrested Development/S1/E01 - Episode Title.mp4',
      )
      expect(result).toBe('Arrested Development')
    })

    test('Season 02/s02e05.mkv — lowercase in filename', () => {
      const result = cleanTvSearchQuery(
        's02e05',
        '/tv/The Wire/Season 02/s02e05.mkv',
      )
      expect(result).toBe('The Wire')
    })
  })

  describe('show name in both filename and folder', () => {
    test('Plex-style: Show Name - s01e01 - Episode Title.mkv', () => {
      const result = cleanTvSearchQuery(
        'The Simpsons - s01e01 - Simpsons Roasting on an Open Fire',
        '/tv/The Simpsons/Season 01/The Simpsons - s01e01 - Simpsons Roasting on an Open Fire.mkv',
      )
      expect(result).toBe('The Simpsons')
    })

    test('Sonarr-style: Show Name - S01E01 - Episode Title [Quality].mkv', () => {
      const result = cleanTvSearchQuery(
        "Bob's Burgers - S03E01 - Ear-sy Rider [Bluray-1080p]",
        "/tv/Bob's Burgers/Season 03/Bob's Burgers - S03E01 - Ear-sy Rider [Bluray-1080p].mkv",
      )
      expect(result).toBe("Bob's Burgers")
    })

    test('dot-separated with quality: Show.Name.S01E01.720p.BluRay.mkv', () => {
      const result = cleanTvSearchQuery(
        'Its.Always.Sunny.in.Philadelphia.S01E01.720p.BluRay',
        '/tv/Its Always Sunny in Philadelphia/Season 01/Its.Always.Sunny.in.Philadelphia.S01E01.720p.BluRay.mkv',
      )
      // Parser extracts from filename — can't reconstruct apostrophes that aren't there
      // "Its Always Sunny in Philadelphia" is close enough for TMDB search
      expect(result).toBe('Its Always Sunny in Philadelphia')
    })
  })

  describe('special characters and edge cases', () => {
    test('show name with apostrophe', () => {
      const result = cleanTvSearchQuery(
        "Grey's Anatomy - S01E01",
        "/tv/Grey's Anatomy/Season 01/Grey's Anatomy - S01E01.mkv",
      )
      expect(result).toBe("Grey's Anatomy")
    })

    test('show name with colon', () => {
      const result = cleanTvSearchQuery(
        'Star Trek Discovery - S01E01',
        '/tv/Star Trek Discovery/Season 01/Star Trek Discovery - S01E01.mkv',
      )
      expect(result).toBe('Star Trek Discovery')
    })

    test('show name with year disambiguation', () => {
      const result = cleanTvSearchQuery(
        'Doctor Who (2005) - S01E01',
        '/tv/Doctor Who (2005)/Season 01/Doctor Who (2005) - S01E01.mkv',
      )
      expect(result).toBe('Doctor Who')
    })

    test('anime-style numbering: Show - 01.mkv', () => {
      const result = cleanTvSearchQuery(
        'Cowboy Bebop - 01',
        '/tv/Cowboy Bebop/Season 1/Cowboy Bebop - 01.mkv',
      )
      expect(result).toBe('Cowboy Bebop')
    })

    test('deeply nested path with extra folders', () => {
      const result = cleanTvSearchQuery(
        'Friends S01E01',
        '/media/nas/tv/Friends/Season 01/Friends S01E01.mkv',
      )
      expect(result).toBe('Friends')
    })

    test('show name with "The" prefix', () => {
      const result = cleanTvSearchQuery(
        'The Mandalorian - S02E01 - Chapter 9',
        '/tv/The Mandalorian/Season 02/The Mandalorian - S02E01 - Chapter 9.mkv',
      )
      expect(result).toBe('The Mandalorian')
    })

    test('show with numbers in name', () => {
      const result = cleanTvSearchQuery(
        '24 - S01E01 - 12:00 AM - 1:00 AM',
        '/tv/24/Season 01/24 - S01E01 - 12:00 AM - 1:00 AM.mkv',
      )
      expect(result).toBe('24')
    })

    test('show with ampersand', () => {
      const result = cleanTvSearchQuery(
        'Law & Order SVU S01E01',
        '/tv/Law & Order SVU/Season 01/Law & Order SVU S01E01.mkv',
      )
      expect(result).toBe('Law & Order SVU')
    })
  })

  describe('quality and release group variations', () => {
    test('Remux with codec info', () => {
      const result = cleanTvSearchQuery(
        'Severance S01E01 2160p ATVP WEB-DL DDP5.1 Atmos H.265',
        '/tv/Severance/Season 01/Severance S01E01 2160p ATVP WEB-DL DDP5.1 Atmos H.265.mkv',
      )
      expect(result).toBe('Severance')
    })

    test('bracketed release group', () => {
      const result = cleanTvSearchQuery(
        '[YTS.MX] Peep Show S01E01',
        '/tv/Peep Show/Season 01/[YTS.MX] Peep Show S01E01.mkv',
      )
      expect(result).toBe('Peep Show')
    })

    test('PROPER/REPACK tags', () => {
      const result = cleanTvSearchQuery(
        'Ted Lasso S01E01 PROPER 1080p',
        '/tv/Ted Lasso/Season 01/Ted Lasso S01E01 PROPER 1080p.mkv',
      )
      expect(result).toBe('Ted Lasso')
    })
  })
})
