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

function formatDuration (seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (hours > 0) {
    return `${hours}h ${mins}m`
  }
  return `${mins}m`
}

function getAuthor (fields: Record<string, unknown>): string | undefined {
  // The embedded-metadata plugin emits `author` and writes the same value to
  // `artist` for backward compat. Other indexers may emit only one — fall
  // back so the detail page never goes blank when the data is present.
  return (fields.author as string | undefined) ?? (fields.artist as string | undefined)
}

function getGenres (fields: Record<string, unknown>): string[] {
  const list = fields.genres
  if (Array.isArray(list)) {
    return list.filter((g): g is string => typeof g === 'string' && g.length > 0)
  }
  return []
}

createPlugin({
  library: {
    async getSchema (): Promise<LibrarySchema> {
      return {
        name: 'Audiobooks',
        icon: 'Headphones',
        description: 'Audiobook library with author, narrator, and series browsing',
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
            author: {
              type: 'string',
              label: 'Author',
              widget: 'text',
              editable: true,
              order: 1,
              entity: {
                type: 'person',
                role: 'author',
              },
            },
            narrator: {
              type: 'string',
              label: 'Narrator',
              widget: 'text',
              editable: true,
              order: 2,
              entity: {
                type: 'person',
                role: 'narrator',
              },
            },
            series: {
              type: 'string',
              label: 'Series',
              widget: 'text',
              editable: true,
              order: 3,
              entity: {
                type: 'series',
                role: 'series',
                splitOn: 'none',
              },
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
            publisher: {
              type: 'string',
              label: 'Publisher',
              widget: 'text',
              editable: true,
              order: 7,
            },
            language: {
              type: 'string',
              label: 'Language',
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
            duration: {
              type: 'number',
            },
            chapterCount: {
              type: 'number',
            },
          },
        },
        searchableFields: ['title', 'author', 'narrator', 'series'],
        filterableFields: ['author', 'narrator', 'series', 'genres', 'year', 'language', 'publisher'],
        watchedVerb: {
          done: 'Listened',
          undo: 'Mark Unlistened',
          inProgress: 'Listening',
        },
        libraryViewBy: ['items', 'entity:series', 'entity:genre'],
        libraryViewLabels: {
          items: 'Books',
        },
        display: {
          poster: {
            aspect: 'square',
          },
        },
        entitySchemas: {
          series: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                label: 'Series Name',
                widget: 'text',
                editable: true,
                order: 0,
              },
              description: {
                type: 'string',
                label: 'Description',
                widget: 'textarea',
                editable: true,
                order: 1,
              },
            },
          },
        },
        entityRenderers: {
          series: {
            view: 'list',
            viewOptions: {
              sortBy: 'seriesPosition',
              sortFormat: 'number',
              dedupeItemSubtitle: true,
              itemAspect: 'square',
            },
            slots: {
              title: { field: 'name' },
              subtitle: { value: 'Series' },
              overview: { field: 'description' },
              poster: { prefer: ['poster'] },
              links: { include: ['externalLinks', 'canonicalIds'] },
              itemTitle: { field: 'title' },
              itemSubtitle: { template: 'Book {seriesPosition}' },
              itemThumbnail: { prefer: ['poster', 'thumbnail'] },
            },
          },
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
            backdrop: {
              prefer: ['backdrop', 'thumbnail'],
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
              type: 'entity-cards',
              title: 'Narrator',
              role: 'narrator',
              entityType: 'person',
            },
            {
              type: 'entity-cards',
              title: 'Series',
              role: 'series',
              entityType: 'series',
            },
            {
              type: 'kv-grid',
              title: 'Details',
              fields: ['series', 'seriesPosition', 'year', 'duration', 'publisher', 'language'],
            },
            // Genres already show in the header chip strip — don't duplicate.
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
          id: 'duration-desc',
          label: 'Longest First',
          field: 'duration',
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
          id: 'narrator',
          label: 'Narrator',
          field: 'narrator',
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
          id: 'narrator',
          label: 'By Narrator',
          field: 'narrator',
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

      let subtitle = getAuthor(fields)
      if (fields.series) {
        const seriesStr = fields.seriesPosition
          ? `${fields.series} #${fields.seriesPosition}`
          : fields.series as string
        subtitle = subtitle ? `${subtitle} — ${seriesStr}` : seriesStr
      }

      if (fields.duration) {
        badges.push({
          label: formatDuration(fields.duration as number),
        })
      }
      if (fields.chapterCount) {
        badges.push({
          label: `${fields.chapterCount} chapters`,
        })
      }
      for (const genre of getGenres(fields)) {
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
      const author = getAuthor(fields)
      const genres = getGenres(fields)

      if (author) {
        detailFields.push({
          label: 'Author',
          value: author,
        })
      }
      if (fields.narrator) {
        detailFields.push({
          label: 'Narrator',
          value: fields.narrator as string,
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
      if (genres.length > 0) {
        detailFields.push({
          label: genres.length > 1 ? 'Genres' : 'Genre',
          value: genres.join(', '),
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
      if (fields.duration) {
        detailFields.push({
          label: 'Duration',
          value: formatDuration(fields.duration as number),
        })
      }
      if (fields.chapterCount) {
        detailFields.push({
          label: 'Chapters',
          value: String(fields.chapterCount),
        })
      }

      return {
        title: item.title,
        subtitle: author,
        description: fields.description as string | undefined,
        fields: detailFields,
      }
    },
  },
})
