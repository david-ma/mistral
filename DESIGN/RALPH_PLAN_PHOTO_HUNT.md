# Ralph plan — Photo Hunt evolution

Execution checklist for `websites/smugmug`. **Planning mode** (Cursor **ralph-plan** skill): no code or tests in this file. **Execution** (**ralph-loop**): one meaningful checkbox per loop where possible; use project tests as backpressure.

> **Extended checklist:** The default ralph-plan template suggests 3–7 items; this plan intentionally lists **more loops** so you can execute in order without replanning. Adjacent loops may be **merged** into a single loop if scope is small (call out in commit/PR).

## Context

- Thalia site: **events**, **bingo_cards**, UploadThing, Mistral, optional SmugMug (`README.md`, `config/config.ts`, `models/bingo.ts`).
- Product: **photo hunt** (not bingo grid), **full prompt list once then done**, **deferred registration** (`localStorage` card id), **per-photo** moderation + **bulk approve**, **`isSuperuser`**, **homepage latest 3** + **directory** (superuser-approved only), **unlisted events** via direct URL (`DESIGN/design.md`, `DESIGN/PRD.md`).
- **Schema target:** `src/models.md` (PoC ER + Photo Hunt target model section).
- **UI references:** **`Midnight Mono`** + **`DESIGN/uncodixfy.md`** (locked — see `DESIGN/design.md`); primary prototypes under `DESIGN/stitch/midnight_*` and related `code.html` files.
- **Handoff:** Record loop outcomes in commit messages; optional `agents/tasks/` if you add that layout later.

## Goals

- Ship **end-to-end** photo hunt on existing stack with **tested** security boundaries.
- Replace JSON-**blob**-only moderation with **queryable** per-submission + **event listing** flags.
- Align **player** and **admin** surfaces with chosen **design system** and Australian English copy.

## Plan (Ralph loops — recommended order)

- [ ] **Loop 1 — Screen map (Midnight + Uncodixify)** — Map **routes → `DESIGN/stitch/*` prototype** (midnight mobile + desktop flows); note any gaps. Output: table in `DESIGN/design.md` (or `DESIGN/ui-map.md` if you prefer a dedicated file).
- [ ] **Loop 2 — Engineering ADR (remaining §18)** — Document **`hunt_submissions` + session table** naming, **`users.isSuperuser`** placement (Thalia core vs site), **SmugMug one album per event** lifecycle (create timing, folder path, retries). Decisions **1a–4b** already in `DESIGN/design.md`; this loop closes **implementation** detail only. Output: `DESIGN/adr-0001-photo-hunt-data.md` (or extend `design.md`).
- [ ] **Loop 3 — Drizzle schema + migration** — Implement columns/tables from ADR (`users.isSuperuser`, event **public listing** fields, submissions + approval flags). No behaviour change required yet if migration is additive-only.
- [ ] **Loop 4 — Legacy bridge** — Dual-read or one-off **backfill** from `bingo_cards.blob` / `events.blob.approvedCardIds` into new shape; document deprecation path. **Acceptance:** existing cards still load OR documented migration break for PoC data only.
- [ ] **Loop 5 — Hunt API vertical slice** — JSON (or extended controllers) for: create/continue session, **n of m** state, **submit** photo (UploadThing → Mistral path unchanged), **mark complete**. **Acceptance:** `bun test` covers pure helpers + at least one handler contract where feasible.
- [ ] **Loop 6 — Player UI** — Handlebars + built TS: event landing, prompt flow, completion, aligned with **Loop 1** map; remove bingo/grid as **primary** metaphor. **Acceptance:** guest can complete a hunt against **Loop 5** API in dev.
- [ ] **Loop 7 — Save progress** — “Save your hunt”: link **localStorage** session to **user** after login/sign-up; implement ADR merge rules. **Acceptance:** tests for happy path + one conflict/edge case.
- [ ] **Loop 8 — Event admin moderation** — Queue UI + **per-photo approve/revoke** + **bulk approve**; public event gallery reads **only** approved submissions. **Acceptance:** non-approved photos never appear in public gallery section.
- [ ] **Loop 9 — Superuser discovery** — UI for **approve/unapprove event for listing**; **homepage** (latest **3**); **`/directory`** (or equivalent) listing **only** approved events; unlisted events **omitted** but **direct `/event/:slug`** still works.
- [ ] **Loop 10 — Security + route audit** — `RoleRouteRule` for every new path; **guest** cannot hit admin/superuser JSON; superuser routes gated on **`isSuperuser`**. **Acceptance:** integration-style tests for 401/403 expectations (`thalia-testing` patterns).
- [ ] **Loop 11 — Hardening (narrow scope)** — Per interview **7a**: **`config.domains`** checklist for new routes + nginx/host-header smoke (`docs/nginx-proxy-debug.md`). **Do not** require rate limiting in this loop (optional follow-up milestone).
- [ ] **Loop 12 — Docs + ER sync** — Update `README.md` product description; refresh **`src/models.md`** Mermaid ER to match shipped schema; align `DESIGN/user_flow_prd_new_player_journey.html` with PRD if flow timing changed.

## Interview — **resolved** (`1a, 2a, 3a, 4b, 5b, 6b, 7a`)

| Q | Answer | Where recorded |
|---|--------|----------------|
| 1 | **`hunt_submissions`** table | `DESIGN/design.md` |
| 2 | **≥ 3 prompts on create event** | `DESIGN/design.md`, PRD FR-2 |
| 3 | **`isSuperuser`** via **SQL / seed** | `DESIGN/design.md` |
| 4 | Save progress: **last write wins per prompt** | `DESIGN/design.md`, PRD FR-8 |
| 5 | **Midnight Mono + Uncodixify** | `DESIGN/design.md` |
| 6 | SmugMug **one album per event** | `DESIGN/design.md`, PRD §12 |
| 7 | Loop 11: **security + tests only** (no required rate limit) | `DESIGN/design.md`, Loop 11 text above |

PRD **§18** trimmed; remaining items are **implementation validation** only.

## Risks / unknowns

- **Mistral** cost/latency at scale — monitor; queue/retry policy may need a later loop.
- **Blob → rows** migration may leave orphan edge cases — document “known bad” PoC cards.
- **Neon / Arctic / Slate prototypes** are **reference only** unless scope changes — **Midnight + Uncodixify** is locked.
- **Thalia `users` table** may live in framework package — confirm where **`isSuperuser`** migrates (`thalia` vs site-only overlay).

## Notes

- **SmugMug:** **One album per event** is v1 scope — may land in the same loop as upload pipeline or immediately after **Loop 5**, but do not leave production on a single shared album long term.
- Parked (post-MVP): rename `bingo_*` symbols, OG images, vision-only safety gate (`README.md` future work), `photo_hunt_project_documentation.html` placeholders.
- Each loop should end with **green tests** (or a explicit skip + issue) before starting the next.
