# Design decisions — Photo Hunt evolution

## Document status

Living document. Resolved items belong here; unresolved items stay in `DESIGN/PRD.md` → **Open questions / decisions needed**.

---

## Stakeholder interview — 2026-03-20 (resolved)

| Topic | Decision |
|--------|-----------|
| **Prompt exhaustion** | When the player completes **every prompt once**, the hunt **ends** with a clear **“You’re done”** state (no loop). |
| **Public event gallery** | **Per-photo** approval. Event admins **bulk-approve** by selecting **multiple photos** in one action. Primary goal: **flag malicious content** and **prevent abuse** of the public platform (not only aesthetics). |
| **Homepage & directory** | Homepage shows the **latest 3** events that are **superuser-approved** for public listing. A **full directory** link exists; the directory lists **only** those same **superuser-approved** events. **Unapproved** events are **not** listed publicly but remain reachable by **direct URL** so organisers can create, test, and share links **without** waiting for superuser approval. |
| **Superuser (platform)** | Implemented as a dedicated flag on the user record (e.g. **`isSuperuser`**) — **not** implied by generic `admin` alone unless you choose to bootstrap the first superuser that way. |
| **Anonymous continuity** | **`localStorage` card id** only for v1 (no signed cookie / server session requirement). |
| **Minimum prompts** | **≥ 3** prompts required to create or publish an event (exact enforcement point—create vs save vs “go live”—see PRD). |

*Wording note:* “Superadmin” in conversation = **superuser** in docs (same role).

---

## Agreed product direction (from stakeholder)

1. **No bingo aesthetics** — Remove grid/free-space framing from UX and copy; product is a **photo hunt**.
2. **Prompt stream (bounded list)** — Players work through the event’s prompt list **in order** until **all prompts are done once**, then the hunt **completes** (no endless loop).
3. **Event-centric** — Admins **sign up** and create **events** with **event pages**; players join from those pages.
4. **Progressive registration** — Account creation **after** uploads, when the player wants to **save progress** (aligns with existing homepage prototype using local storage + later account).
5. **Two-level curation**  
   - **Event admin**: **Per-photo** approval for what appears on the **public event page**; support **bulk select → approve**; align moderation with **abuse and safety**.  
   - **Superuser**: Approve events for **public discovery** (homepage “latest 3” + **full directory**). Unlisted events stay **shareable by URL** only.

---

## Current implementation snapshot (repo)

| Area | Today |
|------|--------|
| Data | `events` (name, slug, ownerId, description, gridSize, prompts JSON, blob), `bingo_cards` (eventId, ownerId, approved, blob with `cells[]`). |
| Public join | `/event/:slug`, `/event/:slug/join` creates a card; play at `/bingo/:cardId`. |
| Event page showcase | `event.blob.approvedCardIds` → load those cards for previews on `event-show`. |
| Homepage | Lists/links events; Unihack-specific photo hunt entry on `index` with localStorage card id. |
| AI | Mistral vision description + JSON score/safety on `bingo`-style cell upload API. |
| Auth | ThaliaSecurity: guests can read `/event`; `user`/`admin` for organiser routes. |

### ER diagram (PoC as shipped)

The living **entity–relationship diagram** for this site is maintained in [`src/models.md`](../src/models.md) (Mermaid + table summary). It matches the hackathon **proof of concept**: **`events`** + **`bingo_cards`** with a JSON **`blob`** for grid cells, **`events.blob.approvedCardIds`** for card-level public previews, and Thalia **`users`** / **`sessions`** / **`albums`** / **`images`**.

That diagram **does** help the PRD and brief: it makes explicit what must change — there is **no** first-class row per photo submission, **no** `isSuperuser`, and **no** event-level “listed for discovery” flag in the schema today.

### Schema gaps vs Photo Hunt PRD

| PRD need | PoC (`models.md`) gap |
|----------|------------------------|
| **Per-photo** public gallery + **bulk approve** | Cell data lives in **`bingo_cards.blob`**; hard to query, index, or approve rows in bulk without loading every card JSON. |
| **Superuser** + **directory / homepage (3)** | No **`users.isSuperuser`**; no **`events`** fields for “approved for public listing” + timestamp. |
| **Bounded hunt (n of m, then done)** | **`grid_size`** + fixed cell count is encoded in blob shape; prompt list length is separate from “session progress” unless derived in app code. |
| **Moderation / abuse** | **`bingo_cards.approved`** is card-level, not per upload; safety/score live inside cell JSON. |

**Direction:** introduce **new tables** (and/or columns) rather than stretching JSON further — see **`src/models.md` → Photo Hunt target model** and PRD §10 / §18.

---

## Architectural principles for the redesign

1. **Prefer evolving schemas** (Drizzle migrations, backward-compatible JSON blobs) over big-bang renames until domain language stabilises (`bingo_cards` may remain internal table name initially).
2. **Keep upload + Mistral pipeline** as a single well-tested path; change **client UX** and **data shape** (e.g. list of submissions vs fixed-length `cells`) around it.
3. **Explicit curation flags** in DB or JSON for: **per-submission** “approved for public event gallery”, and **per-event** “approved for public directory / homepage” (superuser). Homepage ordering: **latest 3** by approved-for-listing timestamp (or `updatedAt` — engineering detail).
4. **Guest-safe defaults**: anything that could leak unmoderated content must be gated by approval flags or admin-only views; **default** for new uploads is **not** public until event admin approves each photo (bulk tools reduce friction).
5. **Unlisted events**: **Direct URL** always works for the event slug (for organisers and invited players); **discovery** (homepage + directory) requires superuser approval.

---

## Copy and locale

- Australian English for user-facing strings.

---

## Out of scope for initial design lock (see PRD)

- Full moderation SaaS (queues, SLAs, legal hold).
- Native mobile apps (web-first).
- Payments / ticketing (unless added later).
