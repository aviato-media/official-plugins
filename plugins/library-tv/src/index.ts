import type {
  FilterOption,
  GroupingOption,
  ItemDetail,
  ItemSummary,
  LibraryItem,
  LibrarySchema,
  SortOption,
} from '@aviato-media/plugin-sdk'
import { createPlugin } from '@aviato-media/plugin-sdk'

createPlugin({
  library: {
    async getSchema (): Promise<LibrarySchema> {
      return {
        name: 'TV Shows',
        icon: 'Television',
        itemSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              label: 'Episode Title',
              widget: 'text',
              editable: true,
              order: 0,
            },
            episodeOverview: {
              type: 'string',
              label: 'Overview',
              widget: 'textarea',
              editable: true,
              order: 1,
            },
            airDate: {
              type: 'string',
              label: 'Air Date',
              widget: 'date',
              editable: true,
              order: 2,
            },
            episodeRuntime: {
              type: 'number',
              label: 'Runtime (min)',
              widget: 'number',
              editable: true,
              order: 3,
            },
            seriesName: {
              type: 'string',
            },
            season: {
              type: 'number',
            },
            episode: {
              type: 'number',
            },
            episodeEnd: {
              type: 'number',
            },
            episodeTitle: {
              type: 'string',
            },
            seriesOverview: {
              type: 'string',
            },
            firstAirDate: {
              type: 'string',
            },
            seriesVoteAverage: {
              type: 'number',
            },
            episodeVoteAverage: {
              type: 'number',
            },
            seriesStatus: {
              type: 'string',
            },
            numberOfSeasons: {
              type: 'number',
            },
            genres: {
              type: 'array',
              items: {
                type: 'string',
              },
            },
            tmdbSeriesId: {
              type: 'number',
            },
            resolution: {
              type: 'string',
            },
            source: {
              type: 'string',
            },
            codec: {
              type: 'string',
            },
          },
        },
        searchableFields: ['title', 'episodeTitle', 'episodeOverview', 'seriesOverview'],
        filterableFields: ['seriesName', 'season', 'genres', 'seriesStatus', 'resolution'],
        watchedVerb: {
          done: 'Watched',
          undo: 'Mark Unwatched',
          inProgress: 'Watching',
        },
        continueWatching: {
          // The show name lives on the linked parent entity, not in the
          // episode metadata. Different indexers in the same library can
          // attach the parent under either role, so try both — TMDB writes
          // 'show'; some other indexers (and parent-hierarchy synthesis)
          // write 'series'.
          title: { entityRole: ['show', 'series'] },
          // "S3 · E19 — My Choosiest Choice of All". Missing fields render
          // as empty in the template, so libraries that lack episodeTitle
          // still get the S/E prefix without a trailing dash.
          subtitle: {
            template: 'S{season} · E{episode} — {episodeTitle}',
          },
        },
        libraryViewBy: ['entity:show', 'items'],
        libraryViewLabels: {
          items: 'Episodes',
        },
        display: {
          heroBadges: { field: 'genres' },
        },
        // Cast links come from the indexer plugin (e.g. TMDB), emitted as
        // EntityReference objects in IndexResult. No `entity` annotations
        // on itemSchema fields are needed — there are no plain-string
        // fields to synthesize from.
        itemRenderer: {
          slots: {
            // Show name above the H1 — clickable, jumps to the show entity
            // page. Roles fall back from the canonical 'show' to the legacy
            // 'series' for indexers that tag with the older name.
            parentTitle: {
              entityRole: ['show', 'series'],
            },
            // "S3 · E19" — the season segment is clickable and deep-links
            // into the Season 3 group on the show entity page via
            // ?season=3 (consumed by HorizontalScrollView).
            subtitle: {
              segments: [
                {
                  template: 'S{season}',
                  linkToEntity: {
                    entityRole: ['show', 'series'],
                    queryParam: {
                      name: 'season',
                      field: 'season',
                    },
                  },
                },
                {
                  template: 'E{episode}',
                },
              ],
            },
            // Air date moves out of the meta strip onto its own muted line
            // above the genre chips, so the strip stays focused on
            // S/E · duration · rating · quality badges.
            caption: {
              field: 'airDate',
              format: 'date',
            },
            overview: {
              fields: ['episodeOverview', 'seriesOverview'],
            },
            rating: {
              field: 'episodeVoteAverage',
              fallbackField: 'voteAverage',
            },
            backdrop: {
              prefer: ['thumbnail', 'backdrop'],
            },
          },
          extras: [
            {
              type: 'entity-cards',
              title: 'Cast',
              role: 'cast',
              entityType: 'person',
              limit: 20,
            },
          ],
        },
        // Episodes are identified by show + season/episode number — fix-match
        // the show, not the individual episode.
        allowItemRematch: false,
        entitySchemas: {
          show: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                label: 'Series Title',
                widget: 'text',
                editable: true,
                order: 0,
              },
              tagline: {
                type: 'string',
                label: 'Tagline',
                widget: 'text',
                editable: true,
                order: 1,
              },
              overview: {
                type: 'string',
                label: 'Overview',
                widget: 'textarea',
                editable: true,
                order: 2,
              },
              firstAirDate: {
                type: 'string',
                label: 'First Aired',
                widget: 'date',
                editable: true,
                order: 3,
              },
              status: {
                type: 'string',
                label: 'Status',
                widget: 'text',
                editable: true,
                order: 4,
              },
              numberOfSeasons: {
                type: 'number',
                label: 'Seasons',
                widget: 'number',
                editable: true,
                order: 5,
              },
              network: {
                type: 'string',
                label: 'Network',
                widget: 'text',
                editable: true,
                order: 6,
              },
              originalLanguage: {
                type: 'string',
                label: 'Original Language',
                widget: 'text',
                editable: true,
                order: 7,
              },
              contentRating: {
                type: 'string',
                label: 'Content Rating',
                widget: 'text',
                editable: true,
                order: 8,
              },
              genres: {
                type: 'array',
                items: {
                  type: 'string',
                },
                label: 'Genres',
                widget: 'tags',
                editable: true,
                order: 9,
                entity: {
                  type: 'genre',
                  role: 'genre',
                },
              },
            },
          },
        },
        entityRenderers: {
          show: {
            view: 'horizontal-scroll',
            viewOptions: {
              groupBy: 'season',
              sortBy: 'episode',
              groupLabel: 'Season {value}',
            },
            slots: {
              title: { field: 'name' },
              subtitle: { fields: ['firstAirDate', 'status', 'numberOfSeasons', 'voteAverage'] },
              chips: { field: 'genres' },
              overview: { fields: ['overview', 'biography'] },
              poster: { prefer: ['poster'] },
              backdrop: { prefer: ['backdrop', 'poster'] },
              links: { include: ['externalLinks', 'canonicalIds'] },
              itemTitle: { field: 'episodeTitle' },
              itemSubtitle: { template: 'Episode {episode} · {episodeRuntime}m' },
              itemDescription: { field: 'episodeOverview' },
              itemThumbnail: { prefer: ['thumbnail', 'backdrop', 'poster'] },
            },
          },
        },
      }
    },

    async getSortOptions (): Promise<SortOption[]> {
      return [
        {
          id: 'series-asc',
          label: 'Series A-Z',
          field: 'seriesName',
          direction: 'asc',
        },
        {
          id: 'series-desc',
          label: 'Series Z-A',
          field: 'seriesName',
          direction: 'desc',
        },
        {
          id: 'episode-asc',
          label: 'Episode Order',
          field: 'episode',
          direction: 'asc',
        },
        {
          id: 'airdate-desc',
          label: 'Newest Aired',
          field: 'airDate',
          direction: 'desc',
        },
        {
          id: 'airdate-asc',
          label: 'Oldest Aired',
          field: 'airDate',
          direction: 'asc',
        },
        {
          id: 'rating-desc',
          label: 'Highest Rated',
          field: 'seriesVoteAverage',
          direction: 'desc',
        },
        {
          id: 'added-desc',
          label: 'Recently Added',
          field: 'addedAt',
          direction: 'desc',
        },
      ]
    },

    async getFilterOptions (): Promise<FilterOption[]> {
      return [
        {
          id: 'series',
          label: 'Series',
          field: 'seriesName',
          type: 'select',
        },
        {
          id: 'season',
          label: 'Season',
          field: 'season',
          type: 'select',
        },
        {
          id: 'genre',
          label: 'Genre',
          field: 'genres',
          type: 'select',
        },
        {
          id: 'status',
          label: 'Series Status',
          field: 'seriesStatus',
          type: 'select',
        },
        {
          id: 'resolution',
          label: 'Resolution',
          field: 'resolution',
          type: 'select',
        },
      ]
    },

    async getGroupingOptions (): Promise<GroupingOption[]> {
      return [
        {
          id: 'series',
          label: 'By Series',
          field: 'seriesName',
        },
        {
          id: 'season',
          label: 'By Season',
          field: 'season',
        },
        {
          id: 'genre',
          label: 'By Genre',
          field: 'genres',
        },
      ]
    },

    async getItemSummary (item: LibraryItem): Promise<ItemSummary> {
      const fields = item.metadata as Record<string, unknown>
      const season = fields.season as number | undefined
      const episode = fields.episode as number | undefined
      const badges = []

      let subtitle: string | undefined
      if (season !== undefined && episode !== undefined) {
        subtitle = `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
      }
      if (fields.episodeTitle) {
        subtitle = subtitle ? `${subtitle} - ${fields.episodeTitle}` : fields.episodeTitle as string
      }

      if (fields.seriesVoteAverage) {
        badges.push({
          label: `${(fields.seriesVoteAverage as number).toFixed(1)}`,
          color: 'yellow',
        })
      }
      if (fields.resolution) {
        badges.push({
          label: fields.resolution as string,
        })
      }

      return {
        title: (fields.seriesName as string) ?? item.title,
        subtitle,
        badges,
      }
    },

    async getItemDetail (item: LibraryItem): Promise<ItemDetail> {
      const fields = item.metadata as Record<string, unknown>
      const detailFields = []

      if (fields.seriesName) {
        detailFields.push({
          label: 'Series',
          value: fields.seriesName as string,
        })
      }
      if (fields.season !== undefined) {
        detailFields.push({
          label: 'Season',
          value: String(fields.season),
        })
      }
      if (fields.episode !== undefined) {
        const ep = fields.episodeEnd
          ? `${fields.episode}-${fields.episodeEnd}`
          : String(fields.episode)
        detailFields.push({
          label: 'Episode',
          value: ep,
        })
      }
      if (fields.airDate) {
        detailFields.push({
          label: 'Air Date',
          value: fields.airDate as string,
        })
      }
      if (fields.episodeRuntime) {
        detailFields.push({
          label: 'Runtime',
          value: `${fields.episodeRuntime} min`,
        })
      }
      if (fields.episodeVoteAverage) {
        detailFields.push({
          label: 'Episode Rating',
          value: `${(fields.episodeVoteAverage as number).toFixed(1)}/10`,
        })
      }
      if (fields.seriesVoteAverage) {
        detailFields.push({
          label: 'Series Rating',
          value: `${(fields.seriesVoteAverage as number).toFixed(1)}/10`,
        })
      }
      if (fields.genres) {
        detailFields.push({
          label: 'Genres',
          value: (fields.genres as string[]).join(', '),
        })
      }
      if (fields.seriesStatus) {
        detailFields.push({
          label: 'Status',
          value: fields.seriesStatus as string,
        })
      }
      if (fields.numberOfSeasons) {
        detailFields.push({
          label: 'Seasons',
          value: String(fields.numberOfSeasons),
        })
      }
      if (fields.resolution) {
        detailFields.push({
          label: 'Resolution',
          value: fields.resolution as string,
        })
      }
      if (fields.source) {
        detailFields.push({
          label: 'Source',
          value: fields.source as string,
        })
      }

      return {
        title: item.title,
        subtitle: fields.episodeTitle as string | undefined,
        description: (fields.episodeOverview as string) ?? (fields.seriesOverview as string) ?? undefined,
        fields: detailFields,
      }
    },
  },
})
