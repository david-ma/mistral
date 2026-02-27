# SmugMug Thalia Skill

Generic knowledge for using SmugMug with Thalia: auth, API client usage, reuse across projects, and best practices. Use this when building or integrating SmugMug in any Thalia website.

SmugMug is a paid image sharing, image hosting service. We have a paid account with them, and we use it to host images for the Thalia website. They have an API that we can use to interact with our account.

---

## Quick context (smugmug webapp)

- **Display:** Galleries and album pages read from **local DB** first (fast); a **top-up** runs after response (fire-and-forget) to sync from SmugMug API. Top-up lives in `config/smugmug-topup.ts` and can be removed or replaced (e.g. by a JSON endpoint the front end calls).
- **URLs:** Public routes use **urlName** (NiceName) as the slug, not albumKey (e.g. `/album/My-Smug-Album`). Backend resolves slug → albumKey via DB (match urlName or albumKey). albumKey is used only for API calls and form payloads.
- **Create album:** POST to **FolderAlbums** (`/api/v2/folder/user/:username!albums`), not User!albums (405). Body: `Title` (required), `NiceName` (optional), `Privacy`, `Description`. **Omit NiceName when the user leaves URL name blank**—SmugMug auto-generates from the title; sending empty or derived NiceName can cause 400/409.
- **Config:** `config/config.ts` has typed controllers; `resolveSlugToAlbumKey(db, slug)` for slug→albumKey; redirects after create/edit use slug (urlName) when available.
- **Upload (album page):** The image partial uses **UploadThing** first: browser uploads to UploadThing, then POSTs the file URL + albumKey to `/uploadPhoto`; the server fetches from UploadThing and uploads to SmugMug. No file bytes hit our server. Legacy form upload to `/uploadPhoto` remains as a fallback. See [uploadthing_skill.md](uploadthing_skill.md).

---

## Where SmugMug Code Lives

| Location | Purpose |
|----------|---------|
| **Thalia `models/smugmug.ts`** | Shared Drizzle schema: `albums`, `images`. Use when a site needs to store SmugMug album/image references (keys, URLs) in its database. Import from `thalia` or project’s models. |
| **Thalia `server/controllers.ts`** | `SmugMugUploader`: OAuth 1.0a, single-file upload to an album, `smugmugApiCall`. Used by example-auth and doombox; used as **legacy fallback** when UploadThing is unavailable. |
| **websites/smugmug – UploadThing** | See [uploadthing_skill.md](uploadthing_skill.md): file router, `/api/uploadthing`, cleanup of temporary files, image partial wiring. |
| **websites/smugmug** | Dedicated SmugMug webapp: galleries, images, bulk upload, metadata edit. **Upload flow:** client → UploadThing → server fetches and sends to SmugMug via `config/lib-smugmug.ts` `uploadToAlbum()`. Reusable API client in `config/lib-smugmug.ts` for list albums/images, PATCH, create album, and upload. |
| **Other sites (dataviz, doombox, etc.)** | Import Thalia’s `SmugMugUploader` or the client from smugmug (`lib-smugmug.ts`); load credentials from their own auth file; store only album key, image key, or URL in their DB. |

---

## Auth: Never Commit Credentials

- **Use an auth file** outside version control (e.g. `config/smugmugAuth.js` or `config/secrets.js`).
- **Pattern:** Same as `config/mailAuth.js` in thalia_ubc: load via `path.join(import.meta.dirname, 'secrets.js')` or `smugmugAuth.js`; check `fs.existsSync`; in smugmug webapp, `loadSmugMugCreds()` tries `secrets.js` then `smugmugAuth.js` and expects a `smugmug` export (or default).
- **Shape (SmugMug):** Export an object with:
  - `consumer_key`, `consumer_secret` (SmugMug app)
  - `oauth_token`, `oauth_token_secret` (after one-time OAuth 1.0a flow)
  - Optional: `album` (default album key for uploads)
- **UploadThing (smugmug webapp only):** In `config/secrets.js` also export **`UPLOADTHING_TOKEN`** (string) for the UploadThing route handler and cleanup. See [uploadthing_skill.md](uploadthing_skill.md).
- **.gitignore:** Add `config/smugmugAuth.js`, `config/secrets.js` (and optionally `config/*Auth*.js`).
- **Template:** Commit `config/smugmugAuth.example.js` with placeholder keys and a short comment on how to obtain OAuth tokens.

---

## Obtaining OAuth 1.0a Tokens

1. Create an application at SmugMug (get consumer key and secret).
2. Use Thalia’s existing flow (e.g. in example-auth): request token → send user to SmugMug authorize URL → callback with verifier → exchange for access token.
3. Put the final `oauth_token` and `oauth_token_secret` into your auth file and never commit them.

---

## Best Practices

### Server-side only for secrets

- Do **not** put consumer secret or token secret in frontend code. All OAuth and uploads that need secrets should go through your Thalia server (controller or shared client).

### Store references, not blobs

- In your app DB, store **SmugMug identifiers**: album key, image key, or canonical image URL. Use Thalia’s `models/smugmug.ts` (or your own tables) for that. Do not store image bytes in your DB.

### One auth file per project

- Each Thalia project that uses SmugMug should have its own auth file (e.g. `config/smugmugAuth.js`) so credentials can differ per environment and are not shared by accident.

### Reusable client design

- Build a **SmugMug client** that accepts a credentials object and exposes: list albums, list images in album, get image, upload to album, PATCH image metadata. Then the smugmug webapp and other sites can share it without duplicating OAuth/signing logic.

### Australian English

- Per Thalia skill: use Australian English in copy and comments.

---

## Use Case 1: Dataviz – Publish blogpost and upload chart image

**Goal:** When publishing a new blogpost, generate a JPG (e.g. chart), upload it to SmugMug, and store only the URL or album+photo key in the dataviz database.

**Steps:**

1. In dataviz, add a dependency on the SmugMug client (from Thalia or from `websites/smugmug`).
2. Add `config/smugmugAuth.js` to dataviz (gitignored), with the same shape as above.
3. In the publish flow: generate the JPG, call the client’s “upload to album” with the file and target album key, get back image key and URL.
4. Store in dataviz DB: e.g. `smugmug_url`, `smugmug_key`, `smugmug_album` (or use Thalia’s `images` table / your own columns).
5. When rendering the blogpost, use the stored URL or build it from key/album.

**What we need to build:** A server-side “upload to album” API that returns stable identifiers (and optionally URL). The smugmug project’s client should support this.

---

## Use Case 2: User-uploaded photos site

**Goal:** Users upload photos; we store them in a SmugMug album we control and only save references in our database.

**Option A – UploadThing then SmugMug (smugmug webapp):**

1. User selects file; browser uploads to **UploadThing** (no file bytes to our server).
2. Browser POSTs to our endpoint with the UploadThing file URL and albumKey.
3. Server fetches the file from UploadThing, uploads to SmugMug via `uploadToAlbum`, saves refs in DB, returns thumbnail URL. See [uploadthing_skill.md](uploadthing_skill.md).

**Option A2 – Server proxy (legacy / other sites):**

1. User submits file to our Thalia endpoint (e.g. POST `/upload-photo`).
2. Server uses SmugMug client to upload to a fixed (or per-user) album.
3. Client returns image key and URL; we save them in our DB and show the user a link or thumbnail.

**Option B – Client-direct (future):**

- If SmugMug supports signed upload URLs or a flow where the client can upload without our server seeing the file, we could add that later; our DB would still only store key/URL returned after upload.

**What we need to build:** Same “upload to album” client plus a small controller that accepts multipart form, calls the client, and returns (or persists) image key/URL.

---

## Use Case 3: Shared schema (models/smugmug.ts)

- **Thalia `models/smugmug.ts`** defines `albums` and `images` so multiple sites can share a common shape for SmugMug data.
- Use it when you need a **local cache** of SmugMug albums/images or when you want **foreign keys** to SmugMug content (e.g. a `blog_posts` table with `smugmug_image_id`).
- For minimal integration (e.g. only storing URL + key), you can add columns to your existing tables instead of using the full schema; the shared schema is there when you want consistency across projects.

---

## Importing SmugMug into Another Thalia Site

1. **Credentials:** Add gitignored `config/smugmugAuth.js` (and example template) to the project.
2. **Client:** Depend on the SmugMug client (once it lives in Thalia or smugmug): e.g. `import { SmugMugClient } from 'thalia/smugmug'` or from `../../websites/smugmug/lib/smugmug-client`.
3. **Config:** In `config/config.ts`, load the auth file and construct the client; pass credentials to the client.
4. **Controllers:** Call client methods from your controllers (upload, list albums, etc.); respond with JSON or render templates that use the returned data.
5. **Database:** If you need to store refs, use Thalia’s `models/smugmug.ts` or add columns (e.g. `smugmug_key`, `smugmug_url`) to your own schema.

---

## SmugMug API Notes

- **Base:** https://api.smugmug.com/api/v2/doc  
- **Auth:** OAuth 1.0a. Sign requests with consumer + token secrets; use Authorization header (realm + OAuth params).  
- **Upload:** POST to `upload.smugmug.com` for a given node/album; multipart form with file.  
- **Metadata:** PATCH the AlbumImage resource for caption, title, keywords, etc.  
- **Structure:** User → Nodes (folders/albums) → Album → AlbumImages. Use `!authuser`, node `!children`, and album `!albumimages` (or equivalent from the doc).
- **Create album:** POST to **FolderAlbums** (e.g. `/api/v2/folder/user/:username!albums`), not User!albums (GET-only, 405 on POST). Body: `Title`, optional `NiceName`, `Privacy`, `Description`. **NiceName is optional**—omit it when not provided so SmugMug generates a slug from the title; sending empty or auto-derived NiceName can cause 400 or 409.

### Album JSON endpoint (smugmug webapp)

- **`GET /album-json/:slug`** — Slug is urlName or albumKey (resolved via DB). Returns normalised album metadata + `images` array. 404 if not found, 503 if DB/creds missing, 500 on API errors.

---

## Reference

- Project plan and checklist: [smugmug_plan.md](smugmug_plan.md)
- UploadThing integration (smugmug webapp): [uploadthing_skill.md](uploadthing_skill.md)
- Thalia guide: [websites/thalia_ubc/thalia_skill.md](/usr/local/dev/Thalia/websites/thalia_ubc/thalia_skill.md)
- Shared schema: [models/smugmug.ts](/usr/local/dev/Thalia/models/smugmug.ts)
- Thalia uploader (legacy fallback): [server/controllers.ts](/usr/local/dev/Thalia/server/controllers.ts) (`SmugMugUploader`)
- SmugMug upload from buffer: `websites/smugmug/config/lib-smugmug.ts` (`uploadToAlbum`)
