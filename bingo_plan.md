# Bingo card generator

Builds on the Mistral plan: events have prompts; players get a card with randomised prompts and fill cells by taking/uploading photos, which are analysed (Mistral) and stored on the card.

---

## Core flow

- **Grid**: 3×3 by default; event organiser can choose 5×5.
- **Prompts**: Stored per event. **Minimum 8** for 3×3 (middle cell is a **free space**); **minimum 24** for 5×5 (center free). Organisers can add more; when generating a card we shuffle and use 8 or 24, with the center cell fixed as “Free space”.
- **Images**: Players provide photos per cell. On `/bingo/<CARD_ID>` they see their grid of prompts; **clicking a prompt** opens camera or file upload. After upload, the photo is attached to that cell and **analysed** (Mistral describe); result is stored on the card.

---

## MVP

### Models (`models/bingo.ts`)

- **events**: name, slug, ownerId, description, **gridSize** ('3' | '5'), **prompts** (JSON array, ≥8 for 3×3, ≥24 for 5×5), blob.
- **bingo_cards**: eventId, ownerId (nullable for MVP), approved (default false), **blob** — cell data:  
  `{ "cells": [ { "prompt": "...", "imageUrl": "...", "description": "..." }, ... ] }` (9 or 25 entries; center cell is “Free space”).

### Admin

1. **list-events** — List all events; link to create/edit.
2. **create-event** — Create event: name, slug, grid size (3 or 5), description, prompts (≥8 for 3×3, ≥24 for 5×5).
3. **edit-event** — Edit event: same fields; add/edit/delete prompts. Admin sections (client-driven via `bingo-event-admin.ts`):
   - **View all cards**: List all bingo cards for this event (link to `/bingo/:cardId`, show filled count). Data from `GET /api/bingo-event/:eventId/admin-data`.
   - **View all prompts**: Table of each prompt with photos uploaded across cards (thumbnail, description). Optional column: “Match” (TODO: use Mistral to score description vs prompt).

### Public

4. **show-event** (`/event/<slug>`) — Event details; **Join** creates a new bingo card (randomised prompts), redirects to `/bingo/<CARD_ID>`.
5. **Bingo card** (`/bingo/<CARD_ID>`) — Grid of cells. Each cell shows prompt; if filled, show thumbnail + optional description. Click cell → file input (camera or upload) → upload (e.g. UploadThing) → POST to API with cell index + image URL → server stores image on cell and runs Mistral describe, saves description in blob; UI updates.

### API

6. **POST /api/bingo-cell** — Body: `{ cardId, cellIndex, imageUrl }`. Load card, update cell at index with imageUrl, call Mistral describe, save description into blob, return updated cell or card.

---

## Future features

- Admins can **view all bingo cards** for an event and **review** images/descriptions; use Mistral to check “does description match prompt?”.
- **Ban users** (admin).
- **Auth**: Players must be logged in to join; they can only contribute to **their own** card.

---

## Reference

- Mistral describe: `config/lib-mistral.ts`, `POST /api/mistral-describe`.
- Upload: UploadThing (e.g. reuse or add bingo upload route), then server-side attach + describe.
- Schema: `models/bingo.ts`; wire in `models/master-schema.ts` and `config/config.ts`.


## Example prompts:

```
Team photo
Photo of yourself
Photo of your team lead
Photo of your project board
Photo with the judges
Photo of lunch
Photo with someone from UNSW Founders
Photo of the event T-Shirt
Photo with someone from Mistral
Photo of your app
```

---

## Refactor plan: TypeScript + D3 + Socket.IO

Goal: move game logic into testable TypeScript (`bingo-game.ts`), serve card state as JSON, render the card with D3 on the client, and use Socket.IO for real-time updates (e.g. upload/analysis complete). Page loads fast with a thin shell, then fetches and renders.

### 1. Game logic in `bingo-game.ts`

- **Location**: `websites/smugmug/src/js/bingo-game.ts` (or a shared lib under `config/` if server also needs it).
- **Responsibilities** (pure logic, no DB/templates):
  - **Types**: e.g. `BingoCell`, `BingoCardState`, `GameState` (cardId, eventName, gridSize, cells).
  - **Validation**: `minPromptsForGridSize(3 | 5)`, `validatePrompts(prompts, gridSize)`, `parsePromptsText(text)`.
  - **Card generation**: `buildCellsFromPrompts(prompts: string[], gridSize: 3 | 5)` — shuffle, place “Free space” at center, return array of `{ prompt, imageUrl?, description?, isFreeSpace }`.
  - **Rebuild / normalize**: given blob cells (possibly empty or from DB), return a full cells array (e.g. rebuild from event prompts when cells missing).
- **Testing**: unit tests can import these functions and assert on prompts validation, cell order, free-space index, etc. No Handlebars, no HTTP.

### 2. JSON API for game state

- **GET `/api/bingo/card/:id`** (or `GET /api/bingo-card/:id`):
  - Returns JSON: `{ cardId, eventName, gridSize, cells: BingoCell[] }` (and optionally `error`).
  - Server loads card + event from DB; uses logic from `bingo-game.ts` (or inlined initially) to normalize/rebuild cells; returns serializable state. No HTML.
- **POST `/api/bingo-cell`**: keep existing; body `{ cardId, cellIndex, imageUrl }`. Optionally have the server call shared helpers from `bingo-game.ts` for validation/normalization so behaviour stays consistent and testable.

### 3. Bingo page: thin shell + client-side render

- **Route**: `/bingo/:id` still serves a single HTML page (e.g. `bingo-card.hbs`).
- **Page content**: minimal shell — wrapper (nav, etc.), a container for the card (e.g. `#bingo-card-root`), and script tags that load the client app (e.g. `bingo-game.js` built from `bingo-game.ts`). No Handlebars iteration over `cells`; no `{{#each}}` for the grid.
- **Client flow**:
  1. On load, optionally show a loading state.
  2. `fetch GET /api/bingo/card/:id` (id from route or `data-card-id`).
  3. On success: pass JSON to a **render** function that uses **D3** to build/update the grid (one cell per item: prompt, optional image, optional description, free-space styling).
  4. On error: show error message in the container.
- **Interactivity**: click cell → file input (camera/upload) → UploadThing upload → when URL is known, either POST to `/api/bingo-cell` and then refresh state (fetch again) or, with Socket.IO (see below), wait for a “cell updated” event and then update the D3 view from the event payload. Image preview: once the image URL is available (or when server confirms), swap it in for a nice preview (e.g. set image `src` in the cell).

### 4. WebSocket (Socket.IO) — test first, then reusable lib

Thalia already uses **Socket.IO** (see `server/server.ts`, `websockets` in website config; anitabell contact form uses `io()` and `socket.emit('form-interaction', …)`). So we use Socket.IO, not raw WebSockets.

- **Step 4a — Simple Socket.IO test page**
  - Add a minimal page (e.g. `/socket-test` or `/ws-test`) that:
    - Loads Socket.IO client (e.g. `/socket.io/socket.io.js`).
    - Connects with `io()`.
    - Listens for `connect` and a custom event (e.g. `server-pong`).
    - Has a button that emits a custom event (e.g. `client-ping`).
    - Server: in SmugMug config, add a `websockets.listeners['client-ping']` that replies with `socket.emit('server-pong', { message: '…' })`.
  - Verifies: connection, emit, listen, and that the website’s Socket.IO setup works for SmugMug.

- **Step 4b — Reusable client lib: `lib-websocket.ts` (or `lib-socket.ts`)**
  - **Server-side** (e.g. `config/lib-websocket.ts` or `config/lib-socket.ts`):
    - Helpers for the website’s Socket.IO usage: e.g. `emitToCard(cardId, event, payload)` that finds sockets “subscribed” to that card (see below) and emits to them. Optional: simple in-memory map `cardId -> Set<socketId>` for “who is viewing this card”.
    - No need to replace Thalia’s existing Socket.IO setup; just add SmugMug-specific listeners and optionally a small “room” or map by `cardId`.
  - **Client-side** (e.g. in `src/js/` or a small script used by bingo):
    - Thin wrapper: connect with `io()`, optionally send “subscribe to card” (e.g. `emit('bingo-subscribe', { cardId })`), and expose `on(event, callback)` so the bingo UI can listen for `bingo-cell-updated` (or similar).
  - So “lib-websocket” = server helpers + client wrapper; both can live under names that make it clear they’re Socket.IO-based.

- **Step 4c — Bingo integration**
  - When a client is viewing `/bingo/:id`, after connecting it sends `bingo-subscribe`, `{ cardId }`. Server stores that this socket is viewing that card (in-memory map or Socket.IO room).
  - When POST `/api/bingo-cell` completes (cell updated, Mistral description saved), server calls the lib to `emitToCard(cardId, 'bingo-cell-updated', { cellIndex, cell: { prompt, imageUrl, description } })`.
  - Client listens for `bingo-cell-updated` and updates the D3-rendered cell (or the in-memory state and re-renders that cell) so the image and description appear without a full page reload. Optionally show a short “Upload success” or “Analyzed” toast.

### 5. Upload flow and image preview

- **Upload**: Keep using **UploadThing**. Client opens file picker → uploads file to UploadThing → gets back a URL.
- **Optional “SmugMug path” on your server**: After UploadThing returns a URL, the client still POSTs to `/api/bingo-cell` with that URL. If you want a “SmugMug path,” the server can, inside the bingo-cell handler, download the image from UploadThing and push it to SmugMug (or your storage), then store the SmugMug (or your) URL in the cell instead. That keeps the client unchanged; the server does the extra step when configured.
- **Preview**: As soon as the client has the UploadThing URL (before or in parallel with POST), it can set a temporary image in the cell for instant feedback. When the server responds (or when the Socket.IO `bingo-cell-updated` fires with the final cell, possibly with a different URL if you switched to SmugMug), swap in the final image and description so the UI stays consistent.

### 6. Build and deployment

- **Client TypeScript**: `bingo-game.ts` (and any D3/render code) must run in the browser. Options: (a) Bun/build step that compiles `bingo-game.ts` → `bingo-game.js` and serve that; (b) bundle with a small build (e.g. esbuild) that includes D3. Ensure the bingo page script tag points to the built JS.
- **D3**: Add D3 as a dependency (e.g. `d3` in package.json or via CDN for the bingo page). The “render card” function uses D3 to create/update the grid DOM from the JSON state.

### 7. Order of work (suggested)

1. **Socket.IO test page** + server listener (`client-ping` / `server-pong`) — confirm wiring.
2. **`lib-websocket.ts`** (or `lib-socket.ts`): server helpers (emit to card), client wrapper (connect, subscribe, on).
3. **`bingo-game.ts`**: types, `buildCellsFromPrompts`, validation helpers; unit tests.
4. **GET `/api/bingo/card/:id`**: return JSON state; server uses bingo-game logic to normalize cells.
5. **Bingo page**: minimal Handlebars shell + client fetches JSON and renders with D3; no Handlebars grid.
6. **Upload + POST**: keep current flow; on success, either refetch state or (once Socket.IO is wired) listen for `bingo-cell-updated` and update the D3 view; optional immediate preview with UploadThing URL.
7. **Optional**: server-side “SmugMug path” in bingo-cell handler (download from UploadThing, push to SmugMug, save that URL).

---

## Edit event admin (`edit-event.hbs` + `bingo-event-admin.ts`)

- **API**: `GET /api/bingo-event/:eventId/admin-data` — returns `{ eventId, eventName, gridSize, prompts: string[], cards: [{ id, createdAt, filledCount, cells }] }` so the client can render view-all-cards and view-all-prompts without extra requests.
- **View all cards**: Container `#view-all-cards` with `#cards-list` (or similar). Script fetches admin-data, then renders a list of cards: each item links to `/bingo/:cardId`, shows filled count (e.g. “5/9”), optionally a mini D3 grid preview.
- **View all prompts**: Container `#view-all-prompts` with `#prompts-table`. Script builds a table: one row per prompt (from event prompts), columns: #, Prompt, Photos (count or thumbnails + descriptions from all cards’ cells where `cell.prompt === prompt`), and a “Match” column (TODO: use magic AI wand to score description vs prompt).
- **Pattern**: Same as bingo-game — page has `data-event-id`, script loads on DOMContentLoaded, fetches JSON, uses D3 (or DOM) to render sections. No Handlebars iteration for cards or prompt rows.