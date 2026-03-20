# SmugMug (Thalia) — data model

This page describes the MySQL schemas used by the **smugmug** site: tables re-exported from Thalia (`users`, `sessions`, `audits`, `albums`, `images`, `mail`) plus app-local models under `websites/smugmug/models/` (`fruit`, `image_notes`, `events`, `bingo_cards`).

**Product direction** for the next iteration is in [`DESIGN/PRD.md`](../DESIGN/PRD.md) and [`DESIGN/design.md`](../DESIGN/design.md) (Photo Hunt). The ER diagram below reflects the **hackathon proof of concept**; expect **new tables and columns** — see [Photo Hunt target model](#photo-hunt-target-model-prd-aligned) at the end.

## Entity–relationship diagram

```mermaid
erDiagram
  users ||--o{ sessions : "has"
  users ||--o{ audits : "performs"
  sessions ||--o{ audits : "context"
  users ||--o{ events : "owns"
  users ||--o{ bingo_cards : "owns"
  events ||--o{ bingo_cards : "has"
  albums ||--o{ images : "contains"
  images ||--o{ image_notes : "logical keys"

  users {
    int id PK
    varchar name
    varchar email UK
    varchar password
    text photo
    varchar role
    boolean locked
    boolean verified
    varchar password_reset_token
    timestamp password_reset_expires
    timestamp created_at
    timestamp updated_at
    timestamp deleted_at
  }

  sessions {
    varchar sid PK
    timestamp expires
    json data
    int user_id FK
    boolean logged_out
    timestamp created_at
    timestamp updated_at
  }

  audits {
    int id PK
    int user_id FK
    varchar ip
    varchar session_id FK
    varchar action
    json blob
    timestamp action_at
    timestamp created_at
    timestamp updated_at
    timestamp deleted_at
  }

  mail {
    int id PK
    varchar mail_from
    varchar mail_to
    varchar mail_cc
    varchar mail_bcc
    varchar subject
    text body_text
    text body_html
    timestamp created_at
    timestamp updated_at
    timestamp deleted_at
  }

  albums {
    int id PK
    varchar album_key
    varchar name
    text description
    varchar privacy
    varchar url
    varchar url_name
    varchar uri
    varchar web_uri
    varchar date_added
    varchar date_modified
    varchar password
    timestamp created_at
    timestamp updated_at
    timestamp deleted_at
  }

  images {
    int id PK
    int album_id FK
    varchar album_key
    varchar image_key
    text caption
    varchar filename
    varchar url
    int original_size
    int original_width
    int original_height
    varchar thumbnail_url
    varchar archived_uri
    int archived_size
    varchar archived_md5
    varchar preferred_display_file_extension
    varchar uri
    timestamp created_at
    timestamp updated_at
    timestamp deleted_at
  }

  image_notes {
    int id PK
    varchar album_key
    varchar image_key
    text note
    timestamp created_at
    timestamp updated_at
    timestamp deleted_at
  }

  fruit {
    int id PK
    text name
    text color
    text taste
    timestamp created_at
    timestamp updated_at
    timestamp deleted_at
  }

  events {
    int id PK
    varchar name
    varchar slug UK
    int owner_id FK
    text description
    varchar grid_size
    text prompts
    json blob
    timestamp created_at
    timestamp updated_at
    timestamp deleted_at
  }

  bingo_cards {
    int id PK
    int event_id FK
    int owner_id FK
    boolean approved
    json blob
    timestamp created_at
    timestamp updated_at
    timestamp deleted_at
  }
```

### Notes on the diagram

- **`images.album_id`** is a **declared** Drizzle FK to **`albums.id`**. **`album_key`** on both `albums` and `images` matches **SmugMug API** identifiers; keep them consistent with sync jobs.
- **`image_notes`** is tied to a photo by **`(album_key, image_key)`** only — there is **no** `.references()` to **`images`**. Treat the link as **logical** until you add a unique constraint and FK (or store `image_id`).
- **`events.owner_id`** and **`bingo_cards.owner_id`** reference **`users.id`**; **`bingo_cards.event_id`** references **`events.id`** (defined in `websites/smugmug/models/bingo.ts`).
- **`albums`** has **no** `owner_user_id` in schema — gallery ownership is implied by SmugMug / sync code, not a local user FK.
- **`mail`** is independent of users/sessions (no `user_id`). Drizzle uses columns `from`, `to`, `cc`, `bcc`, `text`, `html` — the diagram uses **`mail_from`**, **`body_text`**, etc., so Mermaid avoids reserved words and duplicate `type name` pairs.
- **`audits`** event time is stored in MySQL as column **`timestamp`**; the diagram labels it **`action_at`** for clarity (same convention as Paperless `models.md`).
- **`fruit`** is a standalone demo-style table with **no** foreign keys.

## Table summary

| Table | Purpose |
|-------|---------|
| `albums` | Cached SmugMug album metadata (keys, URIs, privacy, dates). |
| `images` | Cached SmugMug image row per photo; **`album_id`** links to local `albums`. |
| `image_notes` | JSON/text blob per image (AI description, faces, EXIF, etc.) keyed by SmugMug **`album_key` + `image_key`**. |
| `events` | Bingo / photo-hunt event: name, slug, grid size, prompt list, optional **`blob`** (e.g. `approvedCardIds` for PoC public previews). |
| `bingo_cards` | Player session for an event; **`blob`** holds cell prompts + image URLs + Mistral fields (PoC — likely superseded or complemented by normalized rows for moderation). |
| `users` | Thalia Security users (login, role, verification). |
| `sessions` | Session store; optional **`user_id`**. |
| `audits` | Security/audit log. |
| `mail` | Stored outbound mail payloads. |
| `fruit` | Simple example CRUD table (name, color, taste). |

## Suggested future additions

1. **`image_notes` ↔ `images`** — Add **`UNIQUE (album_key, image_key)`** on **`images`** (if not already) and either **`image_notes.image_id` FK** or a composite FK so notes cannot orphan.
2. **Indexes** — Composite index **`(album_key, image_key)`** on **`image_notes`** (and/or **`images`**) for fast lookups; **`bingo_cards (event_id, approved)`** for public galleries.
3. **Album ↔ user** — Optional **`albums.owner_user_id`** (or sync metadata: **`synced_by_user_id`**, **`last_synced_at`**) if multiple admins sync the same DB.
4. **SmugMug sync versioning** — **`smugmug_etag`**, **`last_modified_at`** on **`albums`/`images`** to drive incremental sync and conflict detection.
5. **Bingo** — **`bingo_card_cells`** normalized table if you need per-cell moderation, ordering, or queries without parsing JSON; keep **`blob`** for denormalized cache if preferred.
6. **Events ↔ galleries** — Optional **`events.featured_album_id`** or **`album_key`** if an event should bind to a SmugMug album in the DB.
7. **Retention / GDPR** — Flags or purge jobs for **`image_notes`** and **`bingo_cards.blob`** when users withdraw consent; document relationship to SmugMug deletes.
8. **`mail` ↔ user** — Optional **`user_id`** or **`trigger`** for per-user mail logs and resends (same pattern as Paperless `models.md`).
9. **`fruit`** — Remove or gate behind dev if it is only scaffolding; or prefix demo tables (`demo_fruit`) so production migrations stay clear.

---

## Photo Hunt target model (PRD-aligned)

The PoC model conflates **player state**, **per-prompt uploads**, and **moderation** inside **`bingo_cards.blob`**. The PRD calls for **per-photo approval**, **bulk approve**, **superuser-gated discovery**, and a **clear completion** state. A practical evolution:

### New or altered columns

| Table | Change | Purpose |
|-------|--------|--------|
| `users` | Add `is_superuser` (boolean, default false) | Platform operator: approve events for homepage + directory. |
| `events` | Add `approved_for_public_listing`, `public_listing_approved_at`, `public_listing_approved_by` (or equivalent in `blob` short-term) | Superuser gate: unlisted events still work via **direct URL**. |
| `events` | Eventually drop or ignore `grid_size` in product logic; keep column nullable/deprecated for migration | Bounded hunt = **prompt list length**, not 3×3 / 5×5. |

### New tables (recommended shape — names negotiable)

**`hunt_sessions`** (may start as `bingo_cards` renamed in a later migration)

- `id`, `event_id`, `owner_id` (nullable for guests), `created_at`, `updated_at`
- `current_prompt_index` (or “next prompt ordinal”)
- `completed_at` (null until all prompts done once)
- Optional: `client_fingerprint` / notes — v1 relies on **localStorage** + `id`, not a server anonymous key

**`hunt_submissions`** (one row per photo tied to a prompt attempt)

- `id`, `hunt_session_id`, `event_id` (denormalised for listing queries), `prompt_index`, `prompt_text` (snapshot)
- `image_url`, `thumbnail_url`, `description`, `score`, `safe` (or JSON `moderation` blob)
- `approved_for_public_gallery` (boolean), `moderated_at`, `moderated_by_user_id`
- Indexes: `(event_id, approved_for_public_gallery)`, `(hunt_session_id, prompt_index)`

Bulk approve = `UPDATE hunt_submissions SET approved_for_public_gallery = 1, … WHERE id IN (…)`.

### Target ER (sketch)

```mermaid
erDiagram
  users ||--o{ events : "owns"
  users ||--o{ hunt_sessions : "owns"
  events ||--o{ hunt_sessions : "has"
  events ||--o{ hunt_submissions : "has"
  hunt_sessions ||--o{ hunt_submissions : "submits"

  users {
    int id PK
    boolean is_superuser
  }

  events {
    int id PK
    boolean approved_for_public_listing
    timestamp public_listing_approved_at
  }

  hunt_sessions {
    int id PK
    int event_id FK
    int owner_id FK
    int current_prompt_index
    timestamp completed_at
  }

  hunt_submissions {
    int id PK
    int hunt_session_id FK
    int event_id FK
    int prompt_index
    boolean approved_for_public_gallery
  }
```

Keep **`bingo_cards`** + JSON **`blob`** during migration: backfill **`hunt_submissions`** from existing cells, then switch APIs and drop or archive blob-heavy paths.

### Diagram maintenance

After each Drizzle migration, refresh the **main ER diagram** in this file so it stays the single place agents and humans compare **as-built** vs **PRD**.

---

*Generated from `websites/smugmug/models/*.ts`, Thalia `models/smugmug.ts`, `models/security-models.ts`, and `server/mail`.*
