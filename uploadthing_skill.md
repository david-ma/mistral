# UploadThing integration (SmugMug skill)

Generic knowledge for using UploadThing with the SmugMug Thalia site: flow, config, cleanup, and reuse. Use this when maintaining or extending the UploadThing → SmugMug pipeline.

---

## Overview

Images are uploaded **browser → UploadThing** (not to our server), then our server **fetches from UploadThing and sends to SmugMug**. The server never receives the file bytes from the client. Files used for SmugMug are tagged **"temporary"** on UploadThing and can be pruned when storage exceeds a threshold.

---

## Flow

1. User selects/drops an image on the album page.
2. **Browser** uploads the file to UploadThing via the UploadThing client (presigned URL from our `/api/uploadthing`).
3. UploadThing stores the file and tags it **temporary** (middleware returns `{ tag: 'temporary' }`).
4. **Browser** POSTs to `/uploadPhoto` with JSON: `uploadThingUrl`, `albumKey`, optional `filename`, `fileKey`, `size`.
5. **Server** fetches the file from the UploadThing URL, uploads to SmugMug via `lib-smugmug.uploadToAlbum`, inserts into the `images` table, records the file as temporary for cleanup, and runs cleanup if over threshold.
6. **Cleanup** (automatic or manual): when total size of tracked temporary files exceeds the threshold, oldest files are deleted from UploadThing and removed from the local store.

---

## Where the code lives

| Location | Purpose |
|----------|---------|
| **`config/uploadthing.ts`** | UploadThing file router: route `smugmugImage` (images, 16MB, 4 files), middleware returns `{ tag: 'temporary' }`. |
| **`config/config.ts`** | Loads `UPLOADTHING_TOKEN` from `config/secrets.js`, mounts `/api/uploadthing` (Fetch adapter) and `/api/uploadthing-cleanup`, custom `uploadPhoto` controller (JSON vs form). |
| **`config/uploadthing-cleanup.ts`** | Track temporary file keys in `data/uploadthing-temp.json`, `addTempFile()`, `runCleanupIfNeeded(token, threshold)`. |
| **`config/lib-smugmug.ts`** | `uploadToAlbum(creds, albumKey, fileBuffer, mimeType, options)` — OAuth-signed POST to `upload.smugmug.com` (buffer in, no disk write). |
| **`src/partials/image.hbs`** | Image partial: loads `/js/uploadthing-init.js`, uses `window.uploadFilesToUploadThing('smugmugImage', { files })` then POSTs JSON to `/uploadPhoto`; falls back to legacy form upload. |
| **`public/js/uploadthing-init.js`** | ESM script: `genUploader({ url: origin + '/api/uploadthing' })`, sets `window.uploadFilesToUploadThing`. |

---

## Secrets

- **`config/secrets.js`** must export **`UPLOADTHING_TOKEN`** (string). Same file can also export `smugmug` and other secrets.
- Loaded via **`loadUploadThingToken()`** in config; passed into `createRouteHandler({ router, config: { token } })` and into `UTApi` for cleanup.
- Do **not** commit `secrets.js`; keep it in `.gitignore`.

---

## UploadThing file router

- **Route slug:** `smugmugImage`.
- **Config:** image, max 16MB, max 4 files.
- **Middleware:** returns `{ tag: 'temporary' }` so these uploads are eligible for threshold-based cleanup.
- **onUploadComplete:** optional logging; tagging is done in middleware.

---

## Routes

| Path | Method | Purpose |
|------|--------|---------|
| **`/api/uploadthing`** | GET, POST | UploadThing route handler (presigned URLs, callbacks). Used by the browser client. |
| **`/uploadPhoto`** | POST | **JSON body:** `uploadThingUrl` (or `url`), `albumKey`, optional `filename`, `fileKey`, `size` → fetch from UploadThing, upload to SmugMug, record temp, run cleanup. **Form body:** legacy flow (file to server, then SmugMug). |
| **`/api/uploadthing-cleanup`** | GET/POST | Admin-only; runs `runCleanupIfNeeded(token)` and returns `{ deleted, freedBytes }`. |

---

## Temporary-file cleanup

- **Store:** `data/uploadthing-temp.json` — array of `{ fileKey, size, createdAt }`.
- **When we record:** After a successful UploadThing → SmugMug upload, if the client sent `fileKey` (and optionally `size`), we call **`addTempFile(fileKey, size ?? 0)`**.
- **Threshold:** Default **500 MB**. Override with `UPLOADTHING_STORAGE_THRESHOLD_BYTES` in `uploadthing-cleanup.ts` (or env) if needed.
- **Logic:** **`runCleanupIfNeeded(token, thresholdBytes)`** sums sizes in the store; if over threshold, deletes **oldest by `createdAt`** from UploadThing via **`UTApi.deleteFiles`** and removes them from the store until under threshold.
- **When it runs:** After each successful UploadThing→SmugMug upload (fire-and-forget), and on demand via **`/api/uploadthing-cleanup`**.

---

## Client (browser)

- **`/js/uploadthing-init.js`** loads from ESM (e.g. `esm.sh`), sets **`window.uploadFilesToUploadThing`** using **`genUploader({ url: origin + '/api/uploadthing' })`**.
- **Image partial:** If `window.uploadFilesToUploadThing` exists and `albumKey` is set, uploads with **`uploadFiles('smugmugImage', { files: [file] })`**, then POSTs to **`/uploadPhoto`** with JSON: `uploadThingUrl`, `albumKey`, `filename`, `fileKey`, `size`.
- **Fallback:** If the client isn’t loaded or there’s no `albumKey`, uses the existing form POST to `/uploadPhoto` (legacy).

---

## lib-smugmug: uploadToAlbum

- **Signature:** `uploadToAlbum(creds, albumKey, fileBuffer, mimeType, options?)`
- **Options:** `filename`, `caption`, `title`, `keywords`.
- **Behaviour:** Builds OAuth 1.0a signed multipart POST to `upload.smugmug.com`, sends the buffer (no temp file). Returns the raw upload response (`Image.AlbumImageUri`, `Image.URL`, etc.); use **`get(creds, albumImageUri)`** for full AlbumImage metadata and DB insert.

---

## Dependencies

- **`uploadthing`** (e.g. `^7.7.4`) in `package.json`. Run **`bun install`** in `websites/smugmug` if needed.

---

## Australian English

Per Thalia skill: use Australian English in copy and comments.

---

## Reference

- UploadThing docs: https://docs.uploadthing.com (uploading-files, file-routes, backend-adapters/fetch, api-reference/ut-api)
- Project plan: [smugmug_plan.md](smugmug_plan.md)
- SmugMug skill: [smugmug_skill.md](smugmug_skill.md)
