# Ralph plan — Photo Hunt evolution

Execution checklist for `websites/smugmug`. Planning mode per `ralph-plan` skill; implement in `ralph-loop` with tests as backpressure.

## Context

- Thalia site with **events**, **bingo_cards**, UploadThing, Mistral, optional SmugMug (`README.md`, `config/config.ts`, `models/bingo.ts`).
- Stakeholder direction: **photo hunt** (not bingo grid), **full prompt list once then done**, **deferred registration** (`localStorage`), **per-photo** + **bulk** moderation, **`isSuperuser`** for **homepage (3) + directory** (unlisted = URL only).
- Design intent: `DESIGN/prompt.md`, decisions: `DESIGN/design.md`, requirements: `DESIGN/PRD.md`.

## Goals

- Ship a **coherent photo hunt** UX on top of the existing stack.
- **Unblock** anonymous play; **gate** public galleries with approvals.
- Make **homepage**, **directory**, and **event gallery** curation **explicit** and testable.

## Plan

- [ ] **Loop 1 — Data model + API sketch** — Resolve PRD §18 **engineering** items (`cells[]` vs submissions table, listing flag shape, bootstrap `isSuperuser`). Output: ADR or `DESIGN/design.md` subsection; still no required behaviour change.
- [ ] **Loop 2 — Schema + migration** — `users.isSuperuser`; event **approvedForPublicListing** (+ timestamp); **per-photo** approval fields; Drizzle migration; backward compatibility for `events.blob.approvedCardIds` until deprecated.
- [ ] **Loop 3 — Hunt API + state** — Ordered prompt progress through **full list once** + **completion**; JSON endpoints; Mistral pipeline unchanged.
- [ ] **Loop 4 — Player UI** — Handlebars + TS: prompt **n of m**, upload, **done** state; remove bingo/grid metaphor; Australian English copy.
- [ ] **Loop 5 — Progressive registration** — “Save progress”: **localStorage** card → account linking; edge cases tested.
- [ ] **Loop 6 — Admin + superuser UI** — Event admin: moderation queue, **bulk approve**; superuser: listing approval; homepage **latest 3** + **directory** route; secure controllers.
- [ ] **Loop 7 — Tests + security pass** — Extend `tests/photohunt.test.ts` and add integration tests for new APIs; verify `RoleRouteRule` for all new paths.

## Interview (optional)

See closing questions in the main chat message (user-interview encoding) or PRD §18.

## Risks / Unknowns

- Migration from **`cells[]`** to a new model may break existing cards — need compatibility layer or one-off migration script.
- Mistral rate limits at large events — monitor and queue (out of scope until observed).
- **Host header / domains** — ThaliaSecurity requires `config.domains` alignment when adding routes (`thalia-security` skill).

## Notes

- Parked: rename internal `bingo_*` identifiers; OG images; rate limiting; vision-only safety gate (`README.md` future work).
- After each loop: prefer `agents/tasks/` or project `tests/` failures as the next backpressure (per `ralph-loop`).
