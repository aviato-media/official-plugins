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
        name: 'Movies',
        icon: 'FilmStrip',
        itemSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              label: 'Title',
              widget: 'text',
              editable: true,
              order: 0,
            },
            originalTitle: {
              type: 'string',
              label: 'Original Title',
              widget: 'text',
              editable: true,
              order: 1,
            },
            sortTitle: {
              type: 'string',
              label: 'Sort Title',
              widget: 'text',
              editable: true,
              order: 2,
            },
            tagline: {
              type: 'string',
              label: 'Tagline',
              widget: 'text',
              editable: true,
              order: 3,
            },
            overview: {
              type: 'string',
              label: 'Overview',
              widget: 'textarea',
              editable: true,
              order: 4,
            },
            year: {
              type: 'number',
              label: 'Release Year',
              widget: 'number',
              editable: true,
              order: 5,
            },
            releaseDate: {
              type: 'string',
              label: 'Release Date',
              widget: 'date',
              editable: true,
              order: 6,
            },
            runtime: {
              type: 'number',
              label: 'Runtime (min)',
              widget: 'number',
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
            studio: {
              type: 'string',
              label: 'Studio',
              widget: 'text',
              editable: true,
              order: 9,
            },
            edition: {
              type: 'string',
              label: 'Edition',
              widget: 'text',
              editable: true,
              order: 10,
            },
            genres: {
              type: 'array',
              items: {
                type: 'string',
              },
              label: 'Genres',
              widget: 'tags',
              editable: true,
              order: 11,
              entity: {
                type: 'genre',
                role: 'genre',
              },
            },
            searchTerms: {
              type: 'string',
              label: 'Search Terms',
              widget: 'text',
              editable: true,
              order: 12,
            },
            voteAverage: {
              type: 'number',
            },
            tmdbId: {
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
        searchableFields: ['title', 'overview', 'tagline'],
        filterableFields: ['year', 'genres', 'resolution', 'voteAverage'],
        watchedVerb: {
          done: 'Watched',
          undo: 'Mark Unwatched',
          inProgress: 'Watching',
        },
        // Cast/director links come from the indexer plugin (e.g. TMDB),
        // which emits them as EntityReference objects in IndexResult.
        // No `entity` annotations on itemSchema fields are needed — there
        // are no plain-string fields to synthesize from.
        itemRenderer: {
          slots: {
            subtitle: {
              field: 'year',
              format: 'year',
            },
            overview: {
              field: 'overview',
            },
            rating: {
              field: 'voteAverage',
              fallbackField: 'rating',
            },
            backdrop: {
              prefer: ['backdrop', 'thumbnail'],
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
            {
              type: 'entity-cards',
              title: 'Crew',
              role: 'director',
              entityType: 'person',
            },
          ],
        },
      }
    },

    async getSortOptions (): Promise<SortOption[]> {
      return [
        {
          id: 'title-asc',
          label: 'Title A-Z',
          field: 'title',
          direction: 'asc',
        },
        {
          id: 'title-desc',
          label: 'Title Z-A',
          field: 'title',
          direction: 'desc',
        },
        {
          id: 'year-desc',
          label: 'Newest First',
          field: 'year',
          direction: 'desc',
        },
        {
          id: 'year-asc',
          label: 'Oldest First',
          field: 'year',
          direction: 'asc',
        },
        {
          id: 'rating-desc',
          label: 'Highest Rated',
          field: 'voteAverage',
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
          id: 'genre',
          label: 'Genre',
          field: 'genres',
          type: 'select',
        },
        {
          id: 'year',
          label: 'Year',
          field: 'year',
          type: 'range',
        },
        {
          id: 'rating',
          label: 'Rating',
          field: 'voteAverage',
          type: 'range',
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
          id: 'genre',
          label: 'By Genre',
          field: 'genres',
        },
        {
          id: 'year',
          label: 'By Year',
          field: 'year',
        },
        {
          id: 'decade',
          label: 'By Decade',
          field: 'year',
        },
      ]
    },

    async getItemSummary (item: LibraryItem): Promise<ItemSummary> {
      const fields = item.metadata as Record<string, unknown>
      const year = fields.year ? ` (${fields.year})` : ''
      const rating = fields.voteAverage ? `${(fields.voteAverage as number).toFixed(1)}` : undefined
      const badges = []

      if (rating) {
        badges.push({
          label: rating,
          color: 'yellow',
        })
      }
      if (fields.resolution) {
        badges.push({
          label: fields.resolution as string,
        })
      }

      return {
        title: item.title,
        subtitle: year ? year.trim() : undefined,
        badges,
      }
    },

    async getItemDetail (item: LibraryItem): Promise<ItemDetail> {
      const fields = item.metadata as Record<string, unknown>
      const detailFields = []

      if (fields.year) {
        detailFields.push({
          label: 'Year',
          value: String(fields.year),
        })
      }
      if (fields.runtime) {
        detailFields.push({
          label: 'Runtime',
          value: `${fields.runtime} min`,
        })
      }
      if (fields.voteAverage) {
        detailFields.push({
          label: 'Rating',
          value: `${(fields.voteAverage as number).toFixed(1)}/10`,
        })
      }
      if (fields.genres) {
        detailFields.push({
          label: 'Genres',
          value: (fields.genres as string[]).join(', '),
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
      if (fields.codec) {
        detailFields.push({
          label: 'Codec',
          value: fields.codec as string,
        })
      }

      return {
        title: item.title,
        subtitle: fields.tagline as string | undefined,
        description: fields.overview as string | undefined,
        fields: detailFields,
      }
    },
  },
})
