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
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

createPlugin({
  library: {
    async getSchema (): Promise<LibrarySchema> {
      return {
        name: 'Music',
        icon: 'MusicNotes',
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
            artist: {
              type: 'string',
              label: 'Artist',
              widget: 'text',
              editable: true,
              order: 1,
              entity: {
                type: 'artist',
                role: 'artist',
              },
            },
            albumArtist: {
              type: 'string',
              label: 'Album Artist',
              widget: 'text',
              editable: true,
              order: 2,
              entity: {
                type: 'artist',
                role: 'album-artist',
              },
            },
            album: {
              type: 'string',
              label: 'Album',
              widget: 'text',
              editable: true,
              order: 3,
            },
            trackNumber: {
              type: 'number',
              label: 'Track Number',
              widget: 'number',
              editable: true,
              order: 4,
            },
            year: {
              type: 'number',
              label: 'Year',
              widget: 'number',
              editable: true,
              order: 5,
            },
            genres: {
              type: 'array',
              items: {
                type: 'string',
              },
              label: 'Genres',
              widget: 'tags',
              editable: true,
              order: 6,
              entity: {
                type: 'genre',
                role: 'genre',
              },
            },
            discNumber: {
              type: 'number',
              label: 'Disc Number',
              widget: 'number',
              editable: true,
              order: 7,
            },
            trackTotal: {
              type: 'number',
            },
            duration: {
              type: 'number',
            },
            mbid: {
              type: 'string',
            },
          },
        },
        searchableFields: ['title', 'artist', 'albumArtist', 'album'],
        filterableFields: ['artist', 'album', 'genres', 'year'],
        watchedVerb: {
          done: 'Played',
          undo: 'Mark Unplayed',
          inProgress: 'Playing',
        },
        // Finishing one track doesn't imply intent to resume the next,
        // so music libraries opt out of the Continue Watching row entirely.
        supportsContinueWatching: false,
        libraryViewBy: ['entity:artist', 'entity:release', 'items'],
        libraryViewLabels: {
          items: 'Tracks',
        },
        display: {
          poster: {
            aspect: 'square',
          },
        },
        itemRenderer: {
          slots: {
            subtitle: {
              field: 'artist',
              format: 'raw',
            },
            overview: {
              fields: ['description'],
            },
            backdrop: {
              prefer: ['backdrop', 'thumbnail'],
            },
          },
          extras: [
            {
              type: 'entity-cards',
              title: 'Artist',
              role: 'artist',
              entityType: 'artist',
            },
            {
              type: 'kv-grid',
              title: 'Track',
              fields: ['album', 'trackNumber', 'discNumber', 'year', 'genres', 'duration'],
            },
          ],
        },
        entitySchemas: {
          artist: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                label: 'Artist Name',
                widget: 'text',
                editable: true,
                order: 0,
              },
              type: {
                type: 'string',
                label: 'Type',
                widget: 'text',
                editable: true,
                order: 1,
              },
              country: {
                type: 'string',
                label: 'Country',
                widget: 'text',
                editable: true,
                order: 2,
              },
              biography: {
                type: 'string',
                label: 'Biography',
                widget: 'textarea',
                editable: true,
                order: 3,
              },
              genres: {
                type: 'array',
                items: {
                  type: 'string',
                },
                label: 'Genres',
                widget: 'tags',
                editable: true,
                order: 4,
                entity: {
                  type: 'genre',
                  role: 'genre',
                },
              },
            },
          },
          release: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                label: 'Release Title',
                widget: 'text',
                editable: true,
                order: 0,
              },
              artistName: {
                type: 'string',
                label: 'Artist',
                widget: 'text',
                editable: false,
                order: 1,
              },
              firstReleaseDate: {
                type: 'string',
                label: 'Release Date',
                widget: 'date',
                editable: true,
                order: 2,
              },
              country: {
                type: 'string',
                label: 'Country',
                widget: 'text',
                editable: true,
                order: 3,
              },
              label: {
                type: 'string',
                label: 'Label',
                widget: 'text',
                editable: true,
                order: 4,
              },
              barcode: {
                type: 'string',
                label: 'Barcode',
                widget: 'text',
                editable: true,
                order: 5,
              },
              annotation: {
                type: 'string',
                label: 'Annotation',
                widget: 'textarea',
                editable: true,
                order: 6,
              },
            },
          },
          'release-group': {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                label: 'Release Title',
                widget: 'text',
                editable: true,
                order: 0,
              },
              artistName: {
                type: 'string',
                label: 'Artist',
                widget: 'text',
                editable: false,
                order: 1,
              },
              firstReleaseDate: {
                type: 'string',
                label: 'First Release Date',
                widget: 'date',
                editable: true,
                order: 2,
              },
              annotation: {
                type: 'string',
                label: 'Annotation',
                widget: 'textarea',
                editable: true,
                order: 3,
              },
              genres: {
                type: 'array',
                items: {
                  type: 'string',
                },
                label: 'Genres',
                widget: 'tags',
                editable: true,
                order: 4,
                entity: {
                  type: 'genre',
                  role: 'genre',
                },
              },
            },
          },
        },
        entityRenderers: {
          artist: {
            view: 'horizontal-scroll',
            viewOptions: {
              source: 'children',
              childType: 'release-group',
              itemAspect: 'square',
              sortBy: 'firstReleaseDate',
              sortFormat: 'date',
            },
            slots: {
              title: { field: 'name' },
              subtitle: { fields: ['country', 'type'] },
              chips: { field: 'genres' },
              overview: { fields: ['biography', 'description'] },
              poster: { prefer: ['poster', 'thumbnail'] },
              backdrop: { prefer: ['backdrop', 'poster'] },
              links: { include: ['externalLinks', 'canonicalIds'] },
              // Item slots resolve against each child release entity's data
              itemTitle: { field: 'name' },
              itemSubtitle: {
                fields: ['firstReleaseDate'],
                format: 'year',
              },
              itemThumbnail: { prefer: ['poster', 'thumbnail'] },
              itemDescription: { show: false },
            },
          },
          release: {
            view: 'list',
            viewOptions: {
              groupBy: 'discNumber',
              sortBy: 'trackNumber',
              sortFormat: 'number',
              groupLabel: 'Disc {value}',
              dedupeItemSubtitle: true,
            },
            slots: {
              title: { field: 'name' },
              subtitle: { fields: ['artistName'] },
              chips: { field: 'genres' },
              overview: { fields: ['annotation', 'description'] },
              poster: { prefer: ['poster', 'thumbnail'] },
              backdrop: { prefer: ['backdrop', 'poster'] },
              links: { include: ['externalLinks', 'canonicalIds'] },
              itemTitle: { field: 'title' },
              itemSubtitle: { field: 'artist' },
              itemDescription: {
                field: 'duration',
                format: 'duration',
              },
              itemThumbnail: { prefer: ['thumbnail'] },
            },
            extras: [
              {
                type: 'kv-grid',
                title: 'Release Details',
                fields: ['artistName', 'firstReleaseDate', 'country', 'label', 'barcode'],
              },
            ],
          },
          'release-group': {
            view: 'list',
            viewOptions: {
              groupBy: 'discNumber',
              sortBy: 'trackNumber',
              sortFormat: 'number',
              groupLabel: 'Disc {value}',
              dedupeItemSubtitle: true,
            },
            slots: {
              title: { field: 'name' },
              subtitle: { fields: ['artistName'] },
              chips: { field: 'genres' },
              overview: { fields: ['annotation', 'description'] },
              poster: { prefer: ['poster', 'thumbnail'] },
              backdrop: { prefer: ['backdrop', 'poster'] },
              links: { include: ['externalLinks', 'canonicalIds'] },
              itemTitle: { field: 'title' },
              itemSubtitle: { field: 'artist' },
              itemDescription: {
                field: 'duration',
                format: 'duration',
              },
              itemThumbnail: { prefer: ['thumbnail'] },
            },
            extras: [
              {
                type: 'kv-grid',
                title: 'Release Details',
                fields: ['artistName', 'firstReleaseDate', 'country', 'label', 'barcode'],
              },
            ],
          },
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
          id: 'artist-asc',
          label: 'Artist A-Z',
          field: 'artist',
          direction: 'asc',
        },
        {
          id: 'album-asc',
          label: 'Album A-Z',
          field: 'album',
          direction: 'asc',
        },
        {
          id: 'track-asc',
          label: 'Track Order',
          field: 'trackNumber',
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
          id: 'artist',
          label: 'Artist',
          field: 'artist',
          type: 'select',
        },
        {
          id: 'album',
          label: 'Album',
          field: 'album',
          type: 'select',
        },
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
      ]
    },

    async getGroupingOptions (): Promise<GroupingOption[]> {
      return [
        {
          id: 'artist',
          label: 'By Artist',
          field: 'artist',
        },
        {
          id: 'album',
          label: 'By Album',
          field: 'album',
        },
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
      ]
    },

    async getItemSummary (item: LibraryItem): Promise<ItemSummary> {
      const fields = item.metadata as Record<string, unknown>
      const badges = []

      let subtitle = fields.artist as string | undefined
      if (fields.album) {
        subtitle = subtitle ? `${subtitle} — ${fields.album}` : fields.album as string
      }

      if (fields.duration) {
        badges.push({
          label: formatDuration(fields.duration as number),
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

      if (fields.artist) {
        detailFields.push({
          label: 'Artist',
          value: fields.artist as string,
        })
      }
      if (fields.albumArtist && fields.albumArtist !== fields.artist) {
        detailFields.push({
          label: 'Album Artist',
          value: fields.albumArtist as string,
        })
      }
      if (fields.album) {
        detailFields.push({
          label: 'Album',
          value: fields.album as string,
        })
      }
      if (fields.trackNumber !== undefined) {
        const track = fields.trackTotal
          ? `${fields.trackNumber}/${fields.trackTotal}`
          : String(fields.trackNumber)
        detailFields.push({
          label: 'Track',
          value: track,
        })
      }
      if (fields.discNumber) {
        detailFields.push({
          label: 'Disc',
          value: String(fields.discNumber),
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
      if (fields.duration) {
        detailFields.push({
          label: 'Duration',
          value: formatDuration(fields.duration as number),
        })
      }

      return {
        title: item.title,
        subtitle: fields.album as string | undefined,
        description: undefined,
        fields: detailFields,
      }
    },
  },
})
