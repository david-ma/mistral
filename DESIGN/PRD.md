# Product Requirements Document — Photo Hunt

**Project:** Thalia website `websites/smugmug` (evolution from Mistral hackathon “Bingo”)  
**Related docs:** `DESIGN/prompt.md`, `DESIGN/design.md`, `DESIGN/RALPH_PLAN_PHOTO_HUNT.md`  
**Last updated:** 2026-03-21 (Ralph plan interview `1a…7a` folded in; see `DESIGN/design.md`)

**Documentation note:** Canonical filenames in this repo are **`DESIGN/PRD.md`** and **`DESIGN/RALPH_PLAN_PHOTO_HUNT.md`** (and other `DESIGN/*` paths as written here). A prior tooling run incorrectly emitted **lowercase** duplicates of some of these files; that was an output error and has been **corrected** — always link to the **uppercase** paths above (important on case-sensitive filesystems).

---

## 1. Executive summary

Replace the **bingo grid** product metaphor with a **photo hunt**: players on an **event page** work through the event’s **full prompt list once**, then reach a clear **completion** state. Stack: **UploadThing + Mistral + optional SmugMug**. **Registration is deferred** until the player has contributed photos and wants **saved progress**. **Event admins** **per-photo** approve what appears on the **public event gallery** (including **bulk approve**); **superusers** (`isSuperuser`) approve which events appear in **public discovery** (homepage **latest 3** + **directory**). **Unapproved** events remain usable via **direct URL** only.

---

## 2. Background / context

The shipped hackathon app (`README.md`) uses **events** with prompt lists, **per-player cards** with a **fixed grid** (3×3 or 5×5), a **free space** (being phased out in places), **Mistral** for image description and relevance/safety, and **UploadThing** for uploads. **Thalia** provides routing, Handlebars UI, Drizzle models (`models/bingo.ts`), and **ThaliaSecurity**. Event admins already maintain **`approvedCardIds`** in `events.blob` to control which cards appear on the public event page.

This PRD describes the **next product generation**: same technical spine, **new player and admin UX**, **full-list prompt play** (complete once, then done), **per-photo gallery moderation**, and **superuser-gated discovery** (homepage + directory).

---

## 3. Problem statement

- The **grid + bingo** framing limits positioning (events are not games of chance; organisers want open-ended participation).
- Fixed **9/25** cells **cap engagement** and complicate prompt lists of arbitrary length.
- **High friction** (early sign-up) reduces participation at busy in-person events.
- **Curation** is partially implemented (approved cards) but does not yet express **platform-level** homepage editorial control.

---

## 4. Goals & objectives

| Goal | Success looks like |
|------|---------------------|
| Low-friction join | Player can start from an event URL and complete **first upload** without an account. |
| Bounded hunt | Player completes **each prompt once**; hunt then **ends** with an explicit done state (no loop). |
| Trustworthy public surfaces | Public **event gallery** shows only **event-admin-approved photos**; **homepage (3) + directory** list only **superuser-approved** events. Unlisted events work via **direct link** only. |
| Progressive trust | Account prompt appears **in context** after value delivered (photos uploaded), not on landing. |

**Non-goals for v1 of this PRD:** native apps, payments, full DMCA workflow, multi-tenant white-label.

---

## 5. Target users / personas

1. **Player (guest)** — Attendee with a phone; may be anonymous until “save progress”.
2. **Player (registered)** — Same as above, linked to `user` account and durable ownership of hunt state.
3. **Event admin** — Authenticated `user` or `admin` who owns or manages an event (exact ownership rules TBD).
4. **Superuser** — Operator with **`isSuperuser`** (or equivalent boolean on `users`) who can approve events for **public discovery** (homepage + directory). Distinct from ordinary **`admin`** unless you intentionally overlap for bootstrap.

---

## 6. Solution overview

- **Event pages** remain the hub: description, join CTA, featured gallery (curated).
- **Hunt session** replaces the mental model of a “card grid”: a player has **progress through prompts** (1…N, N = prompt count) and a **list of submissions** (photo + metadata + scores), backed by evolved **DB/API** (implementation: extend `cells[]` vs `hunt_submissions` — see §18).
- **Upload pipeline** reuses Mistral describe + scoring/safety; product may later split “relevance” vs “safety” further (`README.md` future work remains valid).
- **ThaliaSecurity** updated so public routes expose only safe, curated aggregates; admin routes expose full queues.

---

## 7. Key features & user stories

### P0 — must ship for coherent “Photo Hunt v1”

| ID | Priority | Story |
|----|----------|--------|
| PH-01 | P0 | As a **guest player**, I want to **start a hunt from an event page** with minimal steps, so that I can participate during the event without friction. |
| PH-02 | P0 | As a **guest player**, I want to see **the next prompt** (or clear progression), so that I know what to capture next. |
| PH-03 | P0 | As a **guest player**, I want to **upload a photo** for the current prompt, so that my submission is recorded and analysed. |
| PH-04 | P0 | As a **guest player**, I want to be prompted to **create an account only after I have uploads** and choose “save progress”, so that sign-up feels earned and optional until then. |
| PH-05 | P0 | As an **event admin**, I want to **approve individual photos** for the public event gallery and **bulk-approve** many at once, so that I can block abuse and malicious content without excessive clicking. |
| PH-06 | P0 | As a **superuser**, I want to **approve events for public discovery**, so that only vetted events appear in the **homepage (latest 3)** and **full directory**, while organisers can still share **unlisted** events by URL. |
| PH-07 | P0 | As an **event admin**, I want to **create and edit events** (name, slug, description, prompts), so that the hunt matches my occasion. |

### P1 — should ship if feasible

| ID | Priority | Story |
|----|----------|--------|
| PH-08 | P1 | As a **player**, I want to **resume on the same device** without an account via **localStorage** (card id), so that I do not lose progress mid-event. |
| PH-09 | P1 | As an **event admin**, I want a **queue of pending submissions** with scores/safety flags, so that I can approve faster. |
| PH-10 | P1 | As a **player**, I want to **see my past submissions** in one place, so that I feel progress and can retry prompts if allowed. |

### P2 — later

| ID | Priority | Story |
|----|----------|--------|
| PH-11 | P2 | As an **organiser**, I want **per-event safety profiles** (strict/moderate), so that scoring thresholds match audience. |
| PH-12 | P2 | As a **player**, I want **social sharing** of a single submission, so that I can show friends outside the app. |

---

## 8. Functional requirements

### 8.1 Event lifecycle

- **FR-1 (MUST)** The system MUST allow authenticated organisers to **create**, **read**, **update** events (existing routes extended; slugs remain unique).
- **FR-2 (MUST)** Each event MUST store an **ordered** list of prompt strings with **minimum length 3**, validated **on create event** (see `DESIGN/design.md`).
- **FR-3 (MUST)** The **public gallery section** of an event page MUST show **only** photos **explicitly approved** by the event admin (**per-photo**; default **not** public until approved).
- **FR-4 (SHOULD)** Deprecated concepts (**free space**, fixed grid size) SHOULD be removed from **user-visible** copy and primary UX; grid size may remain in DB temporarily for migration.

### 8.2 Player hunt flow

- **FR-5 (MUST)** A guest MUST be able to **start** a hunt from `/event/:slug` (or dedicated join action) **without** logging in.
- **FR-6 (MUST)** The client MUST support **photo capture or file pick** and upload via the existing **UploadThing** (or successor) pattern.
- **FR-7 (MUST)** Server MUST run **vision description** and **relevance + safety** scoring consistent with current behaviour unless deliberately changed in a migration note.
- **FR-8 (MUST)** When the player opts to **save progress**, the system MUST offer **account creation** or **login** and MUST **attach hunt state** to the authenticated user. If the user already has submissions for the same event, **last write wins per prompt** (see `DESIGN/design.md`).
- **FR-8b (MUST)** When the player completes **all prompts once**, the client MUST show a clear **completion / “You’re done”** state (no automatic prompt loop).

### 8.3 Curation

- **FR-9 (MUST)** Event admin MUST be able to **approve** and **revoke approval** on **individual photos** destined for the public event gallery, and MUST be able to **select multiple photos** and **bulk-approve** in one action.
- **FR-10 (MUST)** Superuser (`isSuperuser`) MUST be able to **approve** and **revoke** an event for **public discovery**.
- **FR-10a (MUST)** The **homepage** MUST display the **latest 3** events that are superuser-approved for listing (ordering rule: e.g. by approval time or event `updatedAt` — document in implementation).
- **FR-10b (MUST)** A **full directory** page MUST list **only** superuser-approved events (same eligibility as discovery).
- **FR-10c (MUST)** Events **not** superuser-approved MUST remain **reachable by direct URL** (`/event/:slug`, join/play flows) for organiser testing and private sharing; they MUST **not** appear on homepage or directory.

### 8.4 Security & visibility

- **FR-11 (MUST)** `guest` role MUST NOT access admin-only JSON or unapproved private queues via URL guessing (authorise by event ownership / role).
- **FR-12 (SHOULD)** Rate limiting or abuse controls SHOULD be considered for anonymous upload endpoints (tie to existing README ideas).

---

## 9. UX & design considerations

- **Mobile-first**: large tap targets, camera-first, minimal text before first action.
- **Progress**: show “Prompt **n** of **m**” (m ≥ 3); on completion, show a **clear done state**; avoid bingo/grid iconography.
- **Trust**: when asking for email/password, show **why** (“Save your hunt across devices”).
- **Admin**: separate **moderation** view from **edit event** to reduce cognitive load.
- **Homepage**: **Latest 3** superuser-approved events, plus prominent link to **full directory** (same approval gate). **Organisers** see messaging that unlisted events are shareable by link only.

---

## 10. Technical requirements & architecture (high level)

- **Stack:** Thalia, Bun, Handlebars, Drizzle, MariaDB/MySQL, UploadThing, Mistral API, optional SmugMug (`thalia`, `thalia-smugmug` skills).
- **Current ER (PoC):** [`src/models.md`](../src/models.md) — documents **`events`**, **`bingo_cards`**, Thalia **`users`**, SmugMug cache tables, etc. Treat it as the **as-built** picture; the Photo Hunt programme should **extend it** with new tables/columns (see that file’s *Photo Hunt target model* section) and keep the diagram updated after migrations.
- **Schema evolution:** Use a **`hunt_submissions`** table (and related session table) for per-row moderation and bulk approve, plus explicit listing flags — `users.isSuperuser` (bootstrap via **seed/SQL** per `DESIGN/design.md`), `events` columns for **approved for public listing** + timestamp, `approved_for_public_gallery` / `moderated_by` on submissions. Migrations via **drizzle-kit**. Deprecate card-level-only showcase (`approvedCardIds`) and heavy reliance on **`blob` cells** once the new model is live.
- **APIs:** REST-style JSON endpoints consistent with existing `/api/bingo-*` patterns; consider renaming **public** routes to `/api/hunt-*` in a phased way to avoid breaking bookmarks.
- **Testing:** Follow `thalia-testing` — extend `tests/photohunt.test.ts` and add integration tests for auth boundaries on new endpoints.

---

## 11. Success metrics / KPIs

| Metric | Notes |
|--------|--------|
| Time-to-first-upload | Median from event page load (instrument later). |
| Join conversion | % of sessions that upload ≥1 photo. |
| Save-progress conversion | % of uploading sessions that register. |
| Moderation lag | Time from upload to approval (if measured). |
| Homepage CTR | Clicks into featured events (optional). |

---

## 12. Dependencies & integrations

- **UploadThing** — client uploads, server-side finalize.
- **Mistral** — `config/lib-mistral.ts` describe + score/safety.
- **SmugMug** — **one album per event** for v1 (isolation); replace single shared `BINGO_ALBUM_KEY` pattern over time (`DESIGN/design.md`).
- **ThaliaSecurity** — route rules in `config/config.ts` must be updated for any new public/private paths.

---

## 13. Assumptions

1. **Single site** deployment (not multi-tenant SaaS) unless later specified.
2. **Superuser** is a **dedicated user flag** (`isSuperuser`), not “any admin” by default.
3. **Prompt list** is **finite**: completing it **once** ends the hunt (no loop).
4. Existing **card id** in **localStorage** is the v1 anonymous continuity mechanism.

---

## 14. Constraints & risks

| Risk | Mitigation |
|------|------------|
| Anonymous abuse | Rate limits, captcha (later), blocking unsafe uploads (see README safety roadmap). |
| Schema migration complexity | Phased release: add **per-photo approval** + **event listing flag**; migrate off `approvedCardIds` when ready. |
| Moderation workload | Bulk approve, clear safety flags, default “not public until approved”. |
| SEO / sharing | Event slugs remain human-readable; OG tags **P1**. |

---

## 15. Out of scope

- Bingo tournaments, leaderboards tied to “lines” or “blackout”.
- Mandatory accounts before any upload.
- Automated legal compliance beyond current safety JSON.

---

## 16. Release plan / phasing (Ralph-loop sized)

| Phase | Focus | Outcome |
|-------|--------|---------|
| **0** | Product + schema decisions | Stakeholder interview done; choose implementation data model + listing flags (PRD §18). |
| **1** | UX rebrand + copy | No bingo/grid in primary UI; event and hunt pages use photo-hunt language. |
| **2** | Full-list prompt flow | Player completes **all prompts once**; APIs + client beyond 9/25; **completion** UX. |
| **3** | Progressive registration | “Save progress” ties anonymous session to `user`; tests for merge/edge cases. |
| **4** | Curation v2 | Event admin **per-photo** + **bulk approve**; superuser **listing approval**; homepage **3** + **directory**; **unlisted** by URL. |
| **5** | Hardening | Security audit on new routes + tests; **rate limits optional** (deferred unless needed). |

Detailed execution checklist (**12 Ralph loops**, ordered): `DESIGN/RALPH_PLAN_PHOTO_HUNT.md`.

---

## 17. Future considerations / roadmap

- Structured safety severity (README §2–4).
- Vision-only safety pass before persist.
- Per-event safety profiles.
- Appeals and audit log.

---

## 18. Open questions / decisions needed

**Resolved — stakeholder interview (2026-03-20):** prompt exhaustion (**end**), gallery granularity (**per-photo** + **bulk approve**), homepage + directory (**latest 3** + directory, superuser-gated; **unlisted** = URL only), superuser (**`isSuperuser`**), anonymous id (**localStorage**), minimum count (**≥ 3**).

**Resolved — Ralph plan interview (see `DESIGN/design.md`):** **`hunt_submissions`** table (not JSON-only), **≥ 3 prompts on create**, **`isSuperuser`** via **manual SQL / seed**, save-progress **last write wins per prompt**, UI **Midnight Mono + Uncodixify**, SmugMug **one album per event**, first-release hardening **security + tests only** (no required rate limit).

**Still open (implementation validation):**

1. **`users.isSuperuser` location** — Thalia core `users` table vs site-only extension; confirm where Drizzle migrations must run.
2. **Per-event SmugMug album** — Exact lifecycle (create on event create vs first upload; folder path; failure/retry if API errors).

---

## Acceptance criteria (cross-cutting)

- **AC-1** Hunt supports **any** prompt count ≥ 3, not a fixed 9/25 grid; completing the list **once** ends the hunt.
- **AC-2** Public event page gallery shows **only** **per-photo** event-admin-approved submissions; **bulk approve** is available.
- **AC-3** Homepage shows **latest 3** superuser-approved events; **directory** lists **only** superuser-approved events; **unapproved** events are absent from both but **work via direct URL**.
- **AC-4** All new endpoints have **explicit** `guest`/`user`/`admin` behaviour documented and covered by tests where security-critical.
