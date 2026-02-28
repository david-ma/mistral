# Mistral AI Image Annotations – Plan

**Context:** SmugMug Thalia website at `websites/smugmug/`. See [smugmug_skill.md](smugmug_skill.md) and [thalia_skill.md](../thalia_ubc/thalia_skill.md).

**Goal:** Use AI (Mistral) to annotate images and show notes (AI-generated + non-AI metadata) in the UI.

---

## 1. Database: `image_notes` table

- **Table name:** `image_notes`
- **Columns:**
  - `albumKey` — varchar(255), matches SmugMug album key
  - `imageKey` — varchar(255), matches SmugMug image key (required)
  - `note` — text, JSON blob (e.g. `{ "description": "...", "faces": [...], "exif": {...} }`)
- **Link to images:** `(albumKey, imageKey)` identify a row in the existing `images` table. Prefer storing these and joining in queries; add a composite FK only if the `images` table has (or gets) a unique constraint on `(albumKey, imageKey)`.
- **Location:** Project-specific schema in `models/image_notes.ts`; exported from `models/master-schema.ts` and registered in `config/config.ts` under `database.schemas`.
- **Migration:** From project root run:
  - `bun drizzle-kit generate --name=add-image-notes`
  - `bun drizzle-kit push` (dev) or apply migration in production.

---

## 2. Step-by-step breakdown

### Mistral test page (prove the API)

A single page that confirms the Mistral vision API works end-to-end:

1. **Page:** `/mistral-test` — upload an image, get a description, show both on the page.
2. **Flow:**
   - User selects an image and uploads it via **UploadThing** (same client as SmugMug uploads; no file hits our server).
   - Front end receives the UploadThing file URL, then POSTs `{ "imageUrl": "..." }` to **`/api/mistral-describe`**.
   - Server loads `MISTRAL_API_KEY` from `config/secrets.js`, calls Mistral [Chat Completions API](https://docs.mistral.ai/capabilities/vision) with the image URL (Mistral accepts public URLs), and returns `{ description, usage?, error? }`.
   - Page displays the uploaded image and the description (and optional usage/raw).
3. **Secrets:** In `config/secrets.js` export **`MISTRAL_API_KEY`** (string). Do not commit.
4. **Implementation:** `config/lib-mistral.ts` for `loadMistralApiKey()` and `describeImage(imageUrl)`; `apiController` handles `POST /api/mistral-describe`; `src/mistral-test.hbs` for the test page; route `mistral-test` with appropriate permissions.
5. **Secrets:** In `config/secrets.js` add `export const MISTRAL_API_KEY = 'your-key'` (or get from [Mistral console](https://console.mistral.ai/)); do not commit.

### Phase A: Mistral API – test image recognition

1. **Get Mistral API access**
   - Sign up / get API key from Mistral.
   - Store key in `config/secrets.js` (or similar), gitignored; do not commit.

2. **Prove image-in, text-out**
   - The **Mistral test page** above does this: upload → describe → show. Optionally keep a small `scripts/` script for CLI testing.

3. **Decide response shape**
   - Choose a simple JSON shape for “one image’s notes”, e.g.  
     `{ "description": "...", "rawResponse": "..." }`  
     so it can be stored in `image_notes.note` later.

### Phase B: Add image recognition and persist notes

4. **Server-side “annotate one image”**
   - In the SmugMug project, add a server endpoint or internal helper that:
     - Input: `albumKey`, `imageKey` (and optionally image URL if you don’t fetch from SmugMug).
     - Fetches the image (from SmugMug URL or local cache).
     - Calls Mistral with the image, gets description (and optionally other fields).
     - Writes or updates a row in `image_notes` with `albumKey`, `imageKey`, and `note` (JSON string).

5. **Batch or on-demand**
   - **On-demand:** “Annotate” button on an image or album page that triggers the above for that image (or selected images).
   - **Batch:** Script or admin action that iterates over images in an album (or all images) and calls the annotate logic; respect rate limits and error handling.

6. **Advanced (later): facial recognition**
   - If Mistral (or another provider) supports face detection/recognition, add a second type of note (e.g. `"faces": [...]`) into the same `note` JSON or a separate structure, and merge into `image_notes.note` when you persist.

### Phase C: UI to show notes

7. **Display notes on image/album pages**
   - Where you already render an image (e.g. album view or single-image view), load `image_notes` for that image (by `albumKey` + `imageKey`).
   - Render:
     - AI description (and optionally raw response).
     - If you add faces later, show face-related info.
   - Handle “no notes yet” (e.g. “Annotate” button or “No description yet”).

8. **Non-AI notes (metadata)**
   - Add to the same UI (and optionally to `image_notes.note` or a separate column if you prefer):
     - Camera / EXIF: make, model, exposure, etc. (if available from SmugMug API or stored locally).
     - Location, date, time (from EXIF or SmugMug).
   - Fetch this from SmugMug image metadata or from your `images` table if you already cache it there.

---

## 3. Summary checklist

| Step | Description |
|------|-------------|
| A1 | Mistral API key in secrets, gitignored |
| A2 | Script: one image URL → Mistral → print description |
| A3 | Define JSON shape for `image_notes.note` |
| B4 | Server: annotate one image (fetch image → Mistral → save to `image_notes`) |
| B5 | Trigger: on-demand (button) and/or batch script |
| B6 | (Advanced) Facial recognition in same pipeline or separate |
| C7 | UI: load and show notes (description, faces) per image |
| C8 | UI: show non-AI metadata (EXIF, location, date/time) |

---

## 4. References

- **SmugMug:** [smugmug_skill.md](smugmug_skill.md) — auth, API client, `lib-smugmug.ts`, top-up, album/image keys.
- **Thalia:** [thalia_skill.md](../thalia_ubc/thalia_skill.md) — Drizzle workflow, migrations, `master-schema`, controllers, full-page vs wrap.
- **Schema:** `models/image_notes.ts` (this project), Thalia `models/smugmug.ts` for `albums` and `images`.


<!-- Example code for using the Mistral API -->
<!-- import { Mistral } from '@mistralai/mistralai';

const apiKey = process.env['MISTRAL_API_KEY'];

const client = new Mistral({ apiKey: apiKey });

const chatResponse = await client.chat.complete({
  model: 'mistral-small-latest',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: "What's in this image?" },
        {
          type: 'image_url',
          imageUrl:
            'https://docs.mistral.ai/img/eiffel-tower-paris.jpg',
        },
      ],
    },
  ],
}); -->