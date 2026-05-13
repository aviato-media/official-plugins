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
        name: 'Books',
        icon: 'Book',
        description: 'Ebook library with author, series, and publisher browsing',
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
            subtitle: {
              type: 'string',
              label: 'Subtitle',
              widget: 'text',
              editable: true,
              order: 1,
            },
            author: {
              type: 'string',
              label: 'Author',
              widget: 'text',
              editable: true,
              order: 2,
              entity: {
                type: 'person',
                role: 'author',
              },
            },
            series: {
              type: 'string',
              label: 'Series',
              widget: 'text',
              editable: true,
              order: 3,
            },
            seriesPosition: {
              type: 'number',
              label: 'Series Position',
              widget: 'number',
              editable: true,
              order: 4,
            },
            description: {
              type: 'string',
              label: 'Description',
              widget: 'textarea',
              editable: true,
              order: 5,
            },
            year: {
              type: 'number',
              label: 'Year',
              widget: 'number',
              editable: true,
              order: 6,
            },
            genres: {
              type: 'array',
              items: {
                type: 'string',
              },
              label: 'Genres',
              widget: 'tags',
              editable: true,
              order: 7,
              entity: {
                type: 'genre',
                role: 'genre',
              },
            },
            publisher: {
              type: 'string',
              label: 'Publisher',
              widget: 'text',
              editable: true,
              order: 8,
            },
            language: {
              type: 'string',
              label: 'Language',
              widget: 'text',
              editable: true,
              order: 9,
            },
            isbn: {
              type: 'string',
              label: 'ISBN',
              widget: 'text',
              editable: true,
              order: 10,
            },
            pageCount: {
              type: 'number',
              label: 'Pages',
              widget: 'number',
              editable: true,
              order: 11,
            },
          },
        },
        searchableFields: ['title', 'subtitle', 'author', 'series', 'publisher', 'isbn'],
        filterableFields: ['author', 'series', 'genres', 'publisher', 'language', 'year'],
        watchedVerb: {
          done: 'Read',
          undo: 'Mark Unread',
          inProgress: 'Reading',
        },
        libraryViewBy: ['items', 'entity:genre'],
        libraryViewLabels: {
          items: 'Books',
        },
        itemRenderer: {
          slots: {
            subtitle: {
              field: 'author',
              format: 'raw',
            },
            overview: {
              fields: ['description', 'overview'],
            },
          },
          extras: [
            {
              type: 'entity-cards',
              title: 'Author',
              role: 'author',
              entityType: 'person',
            },
            {
              type: 'kv-grid',
              title: 'Details',
              fields: ['series', 'seriesPosition', 'year', 'publisher', 'language', 'pageCount', 'isbn'],
            },
            // Genre already shows in the header chip strip — don't duplicate.
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
          id: 'author-asc',
          label: 'Author A-Z',
          field: 'author',
          direction: 'asc',
        },
        {
          id: 'series-asc',
          label: 'Series Order',
          field: 'seriesPosition',
          direction: 'asc',
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
          id: 'pageCount-desc',
          label: 'Longest First',
          field: 'pageCount',
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
          id: 'author',
          label: 'Author',
          field: 'author',
          type: 'select',
        },
        {
          id: 'series',
          label: 'Series',
          field: 'series',
          type: 'select',
        },
        {
          id: 'genre',
          label: 'Genre',
          field: 'genres',
          type: 'select',
        },
        {
          id: 'publisher',
          label: 'Publisher',
          field: 'publisher',
          type: 'select',
        },
        {
          id: 'language',
          label: 'Language',
          field: 'language',
          type: 'select',
        },
        {
          id: 'year',
          label: 'Year',
          field: 'year',
          type: 'range',
        },
      ]
    },

    async getGroupingOptions (): Promise<GroupingOption[]> {
      return [
        {
          id: 'author',
          label: 'By Author',
          field: 'author',
        },
        {
          id: 'series',
          label: 'By Series',
          field: 'series',
        },
        {
          id: 'genre',
          label: 'By Genre',
          field: 'genres',
        },
        {
          id: 'publisher',
          label: 'By Publisher',
          field: 'publisher',
        },
        {
          id: 'language',
          label: 'By Language',
          field: 'language',
        },
        {
          id: 'year',
          label: 'By Year',
          field: 'year',
        },
      ]
    },

    async getItemSummary (item: LibraryItem): Promise<ItemSummary> {
      const fields = item.metadata as Record<string, unknown>
      const badges = []

      let subtitle = fields.author as string | undefined
      if (fields.series) {
        const seriesStr = fields.seriesPosition
          ? `${fields.series} #${fields.seriesPosition}`
          : fields.series as string
        subtitle = subtitle ? `${subtitle} — ${seriesStr}` : seriesStr
      }

      if (fields.pageCount) {
        badges.push({
          label: `${fields.pageCount} pages`,
        })
      }
      const genres = Array.isArray(fields.genres) ? fields.genres as string[] : []
      for (const genre of genres) {
        badges.push({
          label: genre,
          color: 'blue',
        })
      }

      return {
        title: item.title,
        subtitle,
        badges,
      }
    },

    async getItemDetail (item: LibraryItem): Promise<ItemDetail> {
      const fields = item.metadata as Record<string, unknown>
      const detailFields = []

      if (fields.author) {
        detailFields.push({
          label: 'Author',
          value: fields.author as string,
        })
      }
      if (fields.series) {
        const seriesStr = fields.seriesPosition
          ? `${fields.series} #${fields.seriesPosition}`
          : fields.series as string
        detailFields.push({
          label: 'Series',
          value: seriesStr,
        })
      }
      if (fields.year) {
        detailFields.push({
          label: 'Year',
          value: String(fields.year),
        })
      }
      const detailGenres = Array.isArray(fields.genres) ? fields.genres as string[] : []
      if (detailGenres.length > 0) {
        detailFields.push({
          label: detailGenres.length > 1 ? 'Genres' : 'Genre',
          value: detailGenres.join(', '),
        })
      }
      if (fields.publisher) {
        detailFields.push({
          label: 'Publisher',
          value: fields.publisher as string,
        })
      }
      if (fields.language) {
        detailFields.push({
          label: 'Language',
          value: fields.language as string,
        })
      }
      if (fields.pageCount) {
        detailFields.push({
          label: 'Pages',
          value: String(fields.pageCount),
        })
      }

      return {
        title: item.title,
        subtitle: fields.author as string | undefined,
        description: fields.description as string | undefined,
        fields: detailFields,
      }
    },
  },
})
