/**
 * UploadThing file router for SmugMug: images uploaded here are tagged "temporary"
 * and can be pruned when storage exceeds a threshold.
 */
import { createUploadthing, type FileRouter } from 'uploadthing/server'

const f = createUploadthing()

export const uploadthingRouter = {
  /** Images for SmugMug: tagged temporary so they can be cleaned up when storage is high. */
  smugmugImage: f({
    image: {
      maxFileSize: '16MB',
      maxFileCount: 4,
    },
  })
    .middleware(() => {
      return { tag: 'temporary' as const }
    })
    .onUploadComplete(({ metadata }) => {
      // Metadata (tag: 'temporary') is stored with the file for later cleanup.
      if (metadata?.tag) {
        console.log('[uploadthing] File tagged:', metadata.tag)
      }
    }),
} satisfies FileRouter

export type UploadthingRouter = typeof uploadthingRouter
