---
title: SmugMug boots with empty /health — config.ts failed to load
date: 2026-07-24
---

# Bug report — smugmug config load failure hides behind a “healthy” listen

## Problem

- **Observed:** `bun dev smugmug` listens and `/health` responds, but with no machines, DB not connected, `lastInit: null` — because `config.ts` failed to import (`SmugMugUploader` missing).
- **Expected:** Site config loads; machines (incl. image uploader) and DB appear in `/health`.
- **Evidence:** Boot log `config.ts failed to load for smugmug` + `SyntaxError: Export named 'SmugMugUploader' not found`.
- **Scope / not in scope:** Site migration is required. Framework fail-fast (`THALIA_STRICT_CONFIG`) is optional follow-up; `/health` `config.loaded` already landed in framework.

## Current state

- **Current handling:** Failed config import is logged and swallowed; hollow default site still listens.
- **Workarounds:** None reliable — features simply missing.
- **Cost of inaction:** Operators think the site is up while galleries/upload/auth machines never init.

## Ideal solution

Config load failure aborts boot in development; `/health` always surfaces `config.error`; all sites use `ThaliaImageUploader`.

## Real solution

- **Chosen approach:** Migrate smugmug (and doombox) to `ThaliaImageUploader`; keep custom UploadThing→SmugMug JSON path; multipart falls through to the new machine.
- **Why not the ideal:** Framework strict-boot is separate; not blocking site recovery.
- **Non-goals:** Rewriting the UploadThing staging pipeline into the framework adapter; changing Nexus checks.
- **Risks / follow-ups:** Explicit `adapter: 'smugmug'` without secrets → soft `degraded` to local-disk (intentional).

## Summary

`bun dev smugmug` listens on the port and `/health` responds, but the payload shows **no machines**, **DB not connected**, and **`lastInit: null`**. That is not a `/health` false negative — **`config/config.ts` failed to import**, so Thalia continued with a bare default website.

## Evidence

### Boot log (`PORT=2000 bun dev smugmug`)

```text
Loading website "smugmug"
config.ts failed to load for smugmug
SyntaxError: Export named 'SmugMugUploader' not found in module '/usr/local/dev/Thalia/server/controllers.ts'.

…
Server running at http://localhost:2000 …
Thalia startup complete in 207ms (… website.smugmug.database:0ms …)
```

Note `database:0ms` — database/machines phase effectively skipped because site config (and thus `database.machines`) never merged in.

### `/health` (with `THALIA_HEALTH_TOKEN`)

```json
{
  "ok": false,
  "website": "smugmug",
  "checkedAt": "2026-07-24T13:41:52.231Z",
  "db": { "connected": false },
  "machines": [],
  "lastInit": null
}
```

This matches an empty shell: default controllers (`version`, `health`, …) only; no SmugMug machines, no Drizzle init from site config.

### Root cause

`websites/smugmug/config/config.ts` still imports the removed class:

```ts
import { CrudFactory, SmugMugUploader, parseForm } from 'thalia/controllers'
const smugMugUploader = new SmugMugUploader()
```

Framework now exports **`ThaliaImageUploader`** only (`server/images/image-uploader.ts`, re-exported from `thalia/controllers`). The named export `SmugMugUploader` is gone → dynamic `import(config.ts)` rejects.

### Framework behaviour that masks the failure

In `Website.loadConfig` (`server/website.ts`), a failed `config.ts` import is **logged** then **swallowed**:

```ts
(err) => {
  if (fs.existsSync(configPath)) {
    console.error('config.ts failed to load for', this.name)
    console.error(err)
  } else {
    console.error(`Website "${this.name}" does not have a config.ts file`)
  }
},
```

Boot then continues: partials load, server listens, `/health` and `/version` still work. Operators can easily miss the error in a busy log and assume the site is up.

Related framework work: async machine `init` / `MachineReport` / gated `/health` — see `npm_thalia/tmp/github_issue_async_machine_init.md` (consumer checklist: smugmug / doombox still on old uploader).

---

## Suggested fixes

### A. Site — migrate smugmug off `SmugMugUploader` (required)

1. Replace import/construction with `ThaliaImageUploader`, aligned with `example-auth`:

   ```ts
   import { CrudFactory, ThaliaImageUploader, parseForm } from 'thalia/controllers'

   const imageUploader = new ThaliaImageUploader({
     adapter: process.env.THALIA_IMAGE_ADAPTER === 'local-disk' ? 'local-disk' : 'smugmug',
     // localDisk / uploadThingSecret as needed
   })
   ```

2. Re-bind controllers that used `smugMugUploader` (`uploadPhoto`, `oauthCallback`, …) to the new instance.
3. Keep registering the machine under `database.machines` (key can stay `smugmug` or rename to `imageUpload` for clarity).
4. Ensure `config/secrets.js` (or env) supplies SmugMug consumer keys when `adapter: 'smugmug'`; otherwise expect **`degraded`** (soft fallback to local-disk) — that is intentional health signalling, not a load failure.
5. Update docs that still say `SmugMugUploader` (`smugmug_plan.md`, etc.).
6. Smoke: boot → no `config.ts failed to load` → `/health` shows machines + `db.connected: true` (with DB up) + `lastInit` populated.

Also check **doombox** (same old `SmugMugUploader` pattern historically).

### B. Framework — fail louder on config load failure (recommended)

**Prefer fail-fast in development / when config file exists but throws:**

| Option | Behaviour | Pros | Cons |
|--------|-----------|------|------|
| **B1. Abort boot** if `config.ts` exists but import throws | Don’t listen | Impossible to miss; matches “broken site” | Breaks any workflow that relied on “listen anyway” |
| **B2. Record error on `Website`** | `website.configLoadError = { message, stack? }` | `/health` and logs can surface it; listen still works | Still serves a hollow site unless ops check `/health` |
| **B3. Both** | Dev / `THALIA_STRICT_CONFIG=1` → abort; else record + continue | Safe default for prod experiments | Two modes to document |

Recommendation: **B3** — strict by default in `development`, record always; production can opt into strict via env.

### C. `/health` — should it shout about config failure?

**Yes — implemented in framework (2026-07-24):** `Website.configStatus` + `/health` field:

```json
"config": {
  "loaded": false,
  "source": "error",
  "error": "Export named 'SmugMugUploader' not found …"
}
```

- `loaded: false` → top-level `ok: false` (HTTP 503 with token).
- `source: 'file' | 'defaults' | 'error'` distinguishes intentional bare sites from hollow boots.
- Louder boot log: `website "…" is listening WITHOUT site config — /health will report config.loaded=false`.

Still outstanding: strict abort on config failure in development (`THALIA_STRICT_CONFIG`) — optional follow-up.

### D. Nexus / ops

Once `/health` exposes `config.loaded === false`, Nexus website checks with `THALIA=true` + health token can fail red immediately instead of only noticing missing features later.

---

## Reproduction

```bash
cd /usr/local/dev/Thalia
PORT=2000 bun dev smugmug
# Watch for: config.ts failed to load … SmugMugUploader …

curl -s -H "Authorization: Bearer $THALIA_HEALTH_TOKEN" http://127.0.0.1:2000/health | jq
# Expect today: ok:false, machines:[], lastInit:null, db.connected:false
```

---

## Acceptance (when fixed)

- [x] `config.ts` imports `ThaliaImageUploader` (or site builds); boot log has **no** `config.ts failed to load`
- [x] `/health` lists expected machines (`users`/`sessions`/… if security merged, albums/images, image uploader, …)
- [x] `lastInit` non-null after DB init
- [x] (Framework follow-up) `/health` includes `config.loaded` / `config.error` when load failed; preferably strict boot in development
  - `config.loaded` / `config.source` present (`loaded: true`, `source: "file"` after this fix). Strict abort still optional.

---

## Related

- Framework Machine async init + `/health` token gate: Thalia / npm_thalia issue draft `github_issue_async_machine_init.md`
- example-auth already on `ThaliaImageUploader` (default `local-disk` without secrets)
- Soft-fallback **`degraded`** for explicit SmugMug without secrets is correct behaviour *after* config loads — distinct from this bug
