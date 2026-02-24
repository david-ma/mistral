# SmugMug Thalia Project Plan

## Development and testing

- **Dev server:** Run with `bun dev smugmug` (or equivalent). Serves at **localhost:1337**.
- **Logs:** Dev server stdout → `/tmp/thalia-smugmug.log`; stderr → `/tmp/thalia-smugmug.err`. Check these when debugging.
- **Tests:** One test file so far: **`tests/models.test.ts`** — connects to the DB and checks that a raw query and the `users` and `fruit` tables work. Run with `bun test tests/models.test.ts`.

---

## Overview

New Thalia project **smugmug** at `/usr/local/dev/Thalia/websites/smugmug`: a self-contained webapp for managing SmugMug galleries, images, uploads, and metadata. Credentials are loaded from a **gitignored auth file** (e.g. `config/smugmugAuth.js`), similar to `config/mailAuth.js` in thalia_ubc. The code is designed so that **SmugMug integration can be reused** on other Thalia sites (e.g. dataviz, user-upload sites) by importing shared services and storing only album/photo keys or URLs in their databases.

---

## References

| Document / Resource | Purpose |
|---------------------|--------|
| [websites/thalia_ubc/thalia_skill.md](/usr/local/dev/Thalia/websites/thalia_ubc/thalia_skill.md) | Thalia project setup, controllers, templates, DB, auth-file pattern |
| [websites/thalia_ubc](/usr/local/dev/Thalia/websites/thalia_ubc) | Example: `page()`, `mailAuth.js` loading, config structure |
| [websites/homelab](/usr/local/dev/Thalia/websites/homelab) | Example: minimal Thalia site, CrudFactory, API-style controllers |
| [models/smugmug.ts](/usr/local/dev/Thalia/models/smugmug.ts) | Shared Drizzle schema: `albums`, `images` (for local cache / cross-site refs) |
| [websites/dataviz/src/js/smugmug.ts](/usr/local/dev/Thalia/websites/dataviz/src/js/smugmug.ts) | Existing browser-side OAuth and API usage (reference only; we move to server-side) |
| [server/controllers.ts](/usr/local/dev/Thalia/server/controllers.ts) | `SmugMugUploader`: OAuth 1.0a, upload to album, `smugmugApiCall`, signing |
| SmugMug API v2 | https://api.smugmug.com/api/v2/doc — nodes, albums, images, upload, PATCH for metadata |

---

## Auth File Pattern

- **Path:** `config/smugmugAuth.js` (or `config/smugmugAuth.ts` with a simple export). Do **not** commit this file.
- **Pattern:** Same idea as thalia_ubc’s `config/mailAuth.js`: load via `path.join(import.meta.dirname, 'smugmugAuth.js')`, require file to exist at startup (or fail fast with a clear message).
- **Contents:** Export an object with at least:
  - `consumer_key`, `consumer_secret`
  - `oauth_token`, `oauth_token_secret` (after completing OAuth 1.0a once)
  - Optionally `album` (default album key) for uploads.
- **.gitignore:** Add `config/smugmugAuth.js` (and any `*Auth*.js` in config if desired). Add `config/smugmugAuth.example.js` (with placeholder keys) as a template.

---

## What the User Wants (Feature Checklist)

- [x] **View all galleries** — List galleries (albums) from SmugMug (e.g. from user’s root or a chosen folder node).
- [x] **Enter a gallery** — Navigate into a gallery and see **all images** in that gallery.
- [ ] **Bulk upload** — Upload multiple images to a chosen album in one go.
- [ ] **View individual image and metadata** — Open a single image and display its metadata (caption, filename, dimensions, etc.).
- [ ] **Edit metadata on a single image** — Change caption/title or other editable fields for one image (SmugMug PATCH).
- [ ] **Bulk metadata edit** — Apply metadata changes (e.g. caption template, keywords) to all images in an album.

---

## Future Use Cases (Drive Reusable Design)

These inform what we build in a **reusable** way so other Thalia sites can depend on it.

### Use case 1: Dataviz blogpost

- **Scenario:** When publishing a new blogpost, we generate a JPG (e.g. chart/thumbnail).
- **Need:** Upload that JPG to SmugMug via a **live service** (server-side), then store only the **URL** or **SmugMug album + photo key** in the dataviz database.
- **Implication:** We need a **server-side SmugMug client/service** that any Thalia site can import (e.g. from Thalia or from `websites/smugmug`), which can:
  - Accept credentials (from that site’s own auth file or env),
  - Upload a file to a given album,
  - Return stable identifiers (album key, image key, URL) so the caller can store them in its DB.

### Use case 2: User-uploaded photos website

- **Scenario:** A site allows users to upload photos; we want to store them in SmugMug (in an album we control) and only keep **references** in our database.
- **Need:** Either:
  - **Server-side:** Client sends file to our Thalia endpoint; server uses SmugMug client to upload to a designated album and returns/saves image key and URL; or
  - **Client-direct (if we add it later):** Client uploads directly to SmugMug (e.g. signed URL or proxy that adds OAuth) and we only save the returned image key/URL in our DB.
- **Implication:** Reusable **upload-to-album** API and possibly **“get upload URL” or proxy** so the rest of the app only deals with keys/URLs.

### Use case 3: Shared data model

- **Scenario:** Multiple sites (dataviz, smugmug webapp, future sites) need to store references to SmugMug content.
- **Current:** [models/smugmug.ts](/usr/local/dev/Thalia/models/smugmug.ts) already defines `albums` and `images` in Thalia’s `models/` so they can be imported across websites.
- **Implication:** Keep using Thalia’s `models/smugmug.ts` for any **local** album/image cache or foreign keys; other sites may only store `imageKey`, `albumKey`, `url` in their own tables and optionally use the shared schema.

---

## Step-by-Step Implementation Checklist

### Phase 1: Project and auth

- [x] Create minimal Thalia project under `websites/smugmug` (config, src, public, package.json, thalia symlink).
- [x] Add `config/smugmugAuth.js` (gitignored) and `config/smugmugAuth.example.js` (template); document in README or plan. (We load from `config/secrets.js` or `config/smugmugAuth.js`; 503 when missing.)
- [x] In `config/config.ts`, load auth file via loadSmugMugCreds(); do not commit secrets.
- [x] Add `smugmug_skill.md` and keep it updated as we add patterns.

### Phase 2: SmugMug API client (reusable)

- [x] Introduce a **SmugMug API client** in `config/lib-smugmug.ts`: credentials, OAuth 1.0a, **list albums** (`listAlbums`), **list images in album** (`getAlbumImages`), **get album** (`getAlbum`), **PATCH album** (`patchAlbum`), **get node children** (`getNodeChildren`); generic **GET/PATCH** via `get(creds, path)` / `patch(creds, path, body)` with **`apiPath`** helper (e.g. `apiPath.album(key)`, `apiPath.albumImages(key)`).
- [ ] **Get one image** (by image key) — not yet a dedicated helper; can use `get(creds, path)` with appropriate path.
- [x] **Upload image to album** — Thalia's `SmugMugUploader` used from album page (override `image` partial with `albumKey`).
- [ ] **PATCH image metadata** — single-image PATCH not yet in lib-smugmug.
- [ ] **PATCH multiple images** (or batch) — not yet.
- [x] Use SmugMug API v2 for endpoints (album, album!images, User!albums, etc.).
- [ ] Optionally: make client importable from other projects (e.g. import from `websites/smugmug`).

### Phase 3: Webapp – galleries and images

- [x] **List galleries:** Controller `galleries` + template; JSON at `list-smugmug-albums`; display as list with links to `/album/:slug` (slug = urlName or albumKey).
- [x] **Gallery detail:** Route `/album/:slug`; controller resolves slug → albumKey via DB, fetches album + images from DB; template `album-show.hbs` shows thumbnails, metadata, edit form, upload; top-up syncs from API after response.
- [x] **Album metadata edit:** POST to `album-edit` → `patchAlbum` → redirect to album.
- [ ] **Image detail:** Route like `image/:imageKey` (or album + image); show image and metadata (caption, filename, dimensions, etc.).
- [ ] **Single-image metadata edit:** Form + PATCH request to SmugMug to update caption/title etc.; then redirect or re-render image detail.

### Phase 4: Bulk operations

- [ ] **Bulk upload:** Page to select an album (or use default), choose multiple files, POST to server; server uploads each to SmugMug and shows success/failure (and optionally stores refs in local DB if we use one).
- [ ] **Bulk metadata edit:** UI to apply a metadata change (e.g. caption prefix/suffix, keyword) to all images in the current album; server loops (or batches) PATCH requests to SmugMug.

### Phase 5: Polish and reuse

- [x] Document in `smugmug_skill.md`: auth file shape, API notes, album-json endpoint, use cases (dataviz, user uploads).
- [ ] If we upstream a client to Thalia: keep `websites/smugmug` as the main consumer and document import path in skill file.
- [ ] Ensure `models/smugmug.ts` remains the shared place for album/image schema when other sites need to store keys/URLs.

### Extra (implemented)

- [x] **`GET /album-json/:albumKey`** — JSON endpoint returning combined album metadata + `images` array (Promise.all of `getAlbum` + `getAlbumImages`). Documented in "JSON endpoints" and skill.
- [x] **`apiPath`** in `lib-smugmug.ts` — `apiPath.album(key)`, `apiPath.albumImages(key)` for use with `get(creds, path)` to call any endpoint.
- [x] **Album show UI** — Prominent album title (h1), full metadata dl, edit form (Name, Description, Privacy, UrlName), upload partial with `albumKey`.
- [x] **Create album** — GET `create-album` (form), POST `album-create` → `createAlbum()` to FolderAlbums; redirect to `/album/:slug` using urlName from response. NiceName only sent when user provides URL name (omit otherwise to avoid API 400/409).
- [x] **Slug = urlName in URLs** — Public URLs use urlName (e.g. `/album/My-Smug-Album`). albumKey is resolved in the backend via `resolveSlugToAlbumKey(db, slug)` (match by urlName or albumKey). albumKey is not shown in the address bar; forms still post albumKey for API calls.

---

## Review findings (plan vs implementation)

- **Phase 1:** Project exists; auth loaded via `loadSmugMugCreds()` from `secrets.js` or `smugmugAuth.js` (503 when missing, not fail-fast). Skill doc in place.
- **Phase 2:** Full client in `config/lib-smugmug.ts`: OAuth 1.0a, `get`/`patch`, `apiPath`, `listAlbums`, `getAlbum`, `getAlbumImages`, `patchAlbum`, `getNodeChildren`. Upload uses Thalia's `SmugMugUploader`. Still missing: dedicated get-one-image helper, PATCH image metadata, batch PATCH.
- **Phase 3:** Galleries list (`/galleries`, `list-smugmug-albums`), album detail (`/album/:slug` with slug→albumKey resolution, DB display + top-up), create album, album-edit POST (redirect by slug). Not yet: image detail page, single-image metadata edit.
- **Phase 4–5:** Bulk upload and bulk metadata edit not started. Skill doc updated (auth, API notes, album-json).
- **Feature checklist:** View galleries and Enter gallery are done. Bulk upload, view/edit single image, bulk metadata edit remain.
- **Extra:** `/album-json/:albumKey` returns combined album + images; `apiPath` for generic endpoint calls.

---

## Next steps (recommended order)

1. **Image detail page** — Route (e.g. `/image/:imageKey` or `/album/:albumKey/image/:imageKey`); controller to fetch one image metadata (add `getImage(creds, imageKey)` in lib-smugmug or use `get(creds, apiPath.image(imageKey))`); template to show image, caption, filename, dimensions, link back to album.
2. **Single-image metadata edit** — On image detail, form + POST to controller that calls PATCH on the AlbumImage (add `patchImage(creds, imageKey, fields)` in lib-smugmug); redirect back to image or album.
3. **Bulk upload** — Allow multiple file selection on album page (or dedicated page); POST multiple files; server loops uploads via existing upload endpoint and reports success/failure.
4. **Bulk metadata edit** — From album page, form (e.g. caption prefix/suffix or keyword); controller fetches image list, loops PATCH per image (or batch if API supports it).
5. **Optional:** Route protection (ThaliaSecurity) so galleries/album/image/upload require login; homepage or entry point for unauthenticated users.
6. **Optional:** Dedicated `getImage` and `patchImage` in lib-smugmug; extend `apiPath` for image paths for consistency.

---

## API Documentation (SmugMug)

- **Base:** https://api.smugmug.com/api/v2/doc  
- **Auth:** OAuth 1.0a (request token, authorize, access token). Existing implementation in `server/controllers.ts` (SmugMugUploader).
- **Key concepts:** **User** → **Node** (folder/album) → **Album** (has **AlbumImage**). Upload goes to `upload.smugmug.com` for a node/album. Metadata edits via PATCH on the AlbumImage resource.
- **Endpoints to use:**  
  - User/node tree: e.g. `!authuser`, then node’s `!children`.  
  - Album images: album node’s `!albumimages` (or equivalent from doc).  
  - Single image: AlbumImage URI.  
  - Upload: POST to upload.smugmug.com with OAuth.  
  - PATCH: AlbumImage URI for caption/title/keywords.

(Consult the live API doc for exact paths and request/response shapes.)

### Create album (SmugMug API)

- **Endpoint:** POST to **FolderAlbums** of the folder where the album should live, not User!albums (User!albums is GET-only and returns 405 for POST). Example: `POST /api/v2/folder/user/username!albums` (user’s root folder). See https://api.smugmug.com/api/v2/doc/reference/album.html.
- **Body:** `Title` (required), `NiceName` (optional), `Privacy` (optional), `Description` (optional). Use **Title** for the album name; the API doc uses "Title" not "Name".
- **URL name / NiceName:** Optional. If the user does **not** provide a URL name, **omit** `NiceName` from the request. SmugMug will auto-generate a URL slug from the album title. If you send an empty NiceName or auto-derive one (e.g. from the title), the API can return **400** (bad request) or **409** (e.g. duplicate NiceName). Only include `NiceName` when the user explicitly supplies a value.
- **Response:** Returns the created Album object; derive `albumKey` from `Uri` (last path segment) and use `UrlName` / `NiceName` for redirects if present.

---

## JSON endpoints (this app)

- **`GET /album-json/:slug`** — Returns album metadata plus images as JSON. Slug can be urlName or albumKey; resolved via DB (`resolveSlugToAlbumKey`). Uses `loadSmugMugCreds()`, then `Promise.all([getAlbum(), getAlbumImages()])`. Response: `SmugMugAlbumDetail` fields plus `images` array. Errors: 400 if slug missing, 404 if album not found, 503 if DB/creds not configured, 500 on API failure.

---

## What we need to build for the website

This section describes the app structure, security, and SmugMug integration so the site is explorable and reusable.

### Goals

- **Explore the SmugMug API** and write our own **helper functions** in this project (e.g. look up albums, store them locally, then display). Keep helpers in one place (e.g. `lib/smugmug.ts` or `lib/`) so we can refine the API surface and later reuse it elsewhere.
- **Friendly public homepage** — simple landing: what the app is, link to log in. No SmugMug data or actions on the public side.
- **Most functionality behind login** — gallery list, album browse, image view/edit, bulk upload, bulk metadata edit, and any “sync from SmugMug / store locally” flows live in the **authenticated area**.
- **Use Thalia user security** — we already have `users`, `sessions`, and `audits` in the schema, so we can use Thalia’s security (e.g. `ThaliaSecurity`, role-based routes, login/logout, audit logging) and keep the app consistent and auditable.

### Suggested structure

| Area | Who | What |
|------|-----|------|
| **Homepage** | Public | Friendly landing: short blurb, “Log in” (and “Sign up” if we add registration). |
| **Auth** | Public | Login form, logout; optional sign-up and “forgot password” later. |
| **Dashboard / galleries** | Authenticated | List of albums (from SmugMug and/or local cache). Entry point after login. |
| **Album detail** | Authenticated | All images in one album; thumbnails; links to image detail; actions: bulk upload, bulk metadata edit. |
| **Image detail** | Authenticated | Single image + metadata; form to edit metadata (PATCH). |
| **Bulk upload** | Authenticated | Choose album, multi-file upload; server uses SmugMug helpers to upload and optionally store refs in local `albums`/`images` tables. |
| **Helpers / lib** | Server-only | SmugMug API client + our helper functions: e.g. `listAlbums()`, `getAlbumImages()`, `syncAlbumToLocal()`, `uploadToAlbum()`, `patchImageMetadata()`. These sit in front of the raw API and can cache or persist to the local DB. |

### Security and schema

- **Thalia security:** Wire up `ThaliaSecurity` (or equivalent) with `mailAuth` for the app, using the existing **users**, **sessions**, and **audits** tables. Define routes so that only the homepage and auth routes are public; everything under e.g. `/galleries`, `/album/*`, `/image/*`, `/upload` requires an authenticated user (and optionally specific roles).
- **Audit:** Use the **audits** table to log logins, logouts, and sensitive actions (e.g. bulk edit, bulk upload) so we have a trail.
- **SmugMug credentials:** Stay server-side only; load from `config/smugmugAuth.js`. Helpers use these credentials to talk to SmugMug; the client never sees them.

### Build order (high level)

1. **Auth and layout** — Thalia security, login/logout, simple “authenticated” layout or wrapper so we can protect routes. Optional: seed one admin user so we can log in.
2. **SmugMug helpers** — Small client (OAuth signing, base URL) plus helper functions: at least “list my albums” and “list images in album”; optionally “get one image” and “PATCH image”. No UI yet, just callable from controllers.
3. **Homepage** — Public landing page and “Log in” link.
4. **Galleries (list)** — Authenticated page that uses helpers to list albums (and optionally sync/cache to local `albums`), then display them.
5. **Album detail** — Authenticated page for one album: load images via helpers (and optionally cache in local `images`), show thumbnails and links to image detail.
6. **Image detail + single-image edit** — View one image and metadata; form to PATCH caption/title etc.
7. **Bulk upload** — Authenticated flow: pick album, upload files, server uses helpers to upload to SmugMug and optionally write to local DB.
8. **Bulk metadata edit** — Authenticated flow: from an album page, apply a metadata change to all images (helpers loop PATCH or batch).
9. **Polish** — Error handling, loading states, audit events, and any docs (e.g. in `smugmug_skill.md`) for reusing the helpers elsewhere.

---

## Summary

- **Smugmug webapp:** Auth from gitignored `config/smugmugAuth.js`; implement list galleries → open gallery → list images → view image → edit (single + bulk) metadata and bulk upload.
- **Reuse:** Shared SmugMug client and Thalia `models/smugmug.ts` support dataviz (upload chart JPG, store URL/key) and user-upload sites (upload to our album, store ref in DB).
- **Plan vs skill:** This file is the **project plan** with checklist and references; **smugmug_skill.md** is the **reusable skill** for any Thalia project that uses SmugMug (auth, client usage, best practices, and examples).
