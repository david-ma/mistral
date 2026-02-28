# Bingo card generator

Builds on the Mistral plan: events have prompts; players get a card with randomised prompts and fill cells by taking/uploading photos, which are analysed (Mistral) and stored on the card.

---

## Core flow

- **Grid**: 3×3 by default; event organiser can choose 5×5.
- **Prompts**: Stored per event (9 for 3×3, 25 for 5×5). When a card is generated, prompts are **randomised** and assigned to cells.
- **Images**: Players provide photos per cell. On `/bingo/<CARD_ID>` they see their grid of prompts; **clicking a prompt** opens camera or file upload. After upload, the photo is attached to that cell and **analysed** (Mistral describe); result is stored on the card.

---

## MVP

### Models (`models/bingo.ts`)

- **events**: name, slug, ownerId, description, **gridSize** ('3' | '5'), **prompts** (JSON array of 9 or 25 strings), blob.
- **bingo_cards**: eventId, ownerId (nullable for MVP), approved (default false), **blob** — cell data:  
  `{ "cells": [ { "prompt": "...", "imageUrl": "...", "description": "..." }, ... ] }` (9 or 25 entries in cell order).

### Admin

1. **list-events** — List all events; link to create/edit.
2. **create-event** — Create event: name, slug, grid size (3 or 5), description, prompts (9 or 25).
3. **edit-event** — Edit event: same fields; add/edit/delete prompts.

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
