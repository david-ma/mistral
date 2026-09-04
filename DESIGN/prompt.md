# Design brief — Photo Hunt (Thalia / SmugMug site)

## North star

Turn the hackathon **bingo-grid** experience into a **photo hunt**: players work through the event’s **full prompt list once** (minimum **3** prompts), with a clear **completion** state — optimised for **low friction** on mobile at venues. Players start immediately from an **event page**; they are **not** asked to register until they have uploaded photos and want to **save progress** across devices (**localStorage** card id until then).

## Brand and experience

- **Abandon** bingo language, grid metaphors, “free space”, and fixed 3×3 / 5×5 layouts as the primary mental model.
- **Embrace** scavenger-hunt energy: one prompt at a time (or a short queue), clear progress, fast camera/upload path.
- **Tone**: friendly, energetic, Australian English in UI copy (project convention).

## Roles

| Role | Job to be done |
|------|----------------|
| **Player** | Join an event, complete prompts with photos, optionally save progress with an account. |
| **Event admin** | Create and edit events; **per-photo** approve (including **bulk approve**) what appears in the **public event gallery** — focus on **safety and abuse prevention**. |
| **Superuser** (`isSuperuser`) | Approve events for **public discovery**: **homepage** (latest **3**) and **full directory**; unlisted events stay **URL-only** for organisers. |

## Success (qualitative)

- A new player can go from **event link → first upload** in under a minute on a phone.
- Admins trust the **public event page** as a showcase they control.
- The homepage and directory reflect **vetted** events only; **draft / unlisted** events remain shareable by **direct link** without superuser approval.

## Technical anchor (non-negotiables from the stack)

- **Thalia** (Bun, Handlebars, Drizzle, MariaDB/MySQL).
- Existing pipelines: **UploadThing** → server → **Mistral** (vision describe + relevance/safety scoring), optional **SmugMug** persistence.
- **ThaliaSecurity** (`guest` / `user` / `admin`): extend deliberately; avoid breaking public event join flows.

## Handoff

This brief pairs with:

- `DESIGN/design.md` — recorded decisions and assumptions.
- `DESIGN/PRD.md` — requirements, stories, phasing, open questions.
- `DESIGN/RALPH_PLAN_PHOTO_HUNT.md` — execution-sized checklist for Ralph loops.
- `src/models.md` — **as-built ER diagram** (PoC) plus **Photo Hunt target model** (proposed tables/columns); keep in sync with Drizzle after migrations.
